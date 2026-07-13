from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from kubernetes import client, config
import uuid, time, os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    config.load_incluster_config()
except Exception:
    config.load_kube_config()

v1 = client.CoreV1Api()
networking = client.NetworkingV1Api()
apps_v1 = client.AppsV1Api()
rbac = client.RbacAuthorizationV1Api()

LB_URL = os.environ.get("LB_URL", "")

IMAGES = {
    "python": "codercom/code-server:latest",
    "node": "codercom/code-server:latest",
    "go": "codercom/code-server:latest",
}

class EnvRequest(BaseModel):
    env_type: str

def get_env_url(user_id):
    if LB_URL:
        return f"http://{LB_URL}/env/{user_id}"
    return f"http://localhost:8888"

def create_namespace(user_id, ttl):
    v1.create_namespace(client.V1Namespace(
        metadata=client.V1ObjectMeta(
            name=user_id,
            labels={"managed-by": "playground", "ttl-expires-at": ttl}
        )
    ))

def create_quota(user_id):
    v1.create_namespaced_resource_quota(user_id, client.V1ResourceQuota(
        metadata=client.V1ObjectMeta(name="env-quota", namespace=user_id),
        spec=client.V1ResourceQuotaSpec(
            hard={
                "requests.cpu": "500m",
                "requests.memory": "512Mi",
                "limits.cpu": "1",
                "limits.memory": "1Gi",
                "pods": "5"
            }
        )
    ))

def create_network_policy(user_id):
    # allows same-namespace traffic + ingress-nginx namespace (required, else 504 timeouts)
    networking.create_namespaced_network_policy(user_id, client.V1NetworkPolicy(
        metadata=client.V1ObjectMeta(name="deny-cross-namespace", namespace=user_id),
        spec=client.V1NetworkPolicySpec(
            pod_selector=client.V1LabelSelector(),
            policy_types=["Ingress", "Egress"],
            ingress=[
                client.V1NetworkPolicyIngressRule(
                    _from=[client.V1NetworkPolicyPeer(pod_selector=client.V1LabelSelector())]
                ),
                client.V1NetworkPolicyIngressRule(
                    _from=[client.V1NetworkPolicyPeer(
                        namespace_selector=client.V1LabelSelector(
                            match_labels={"kubernetes.io/metadata.name": "ingress-nginx"}
                        )
                    )]
                )
            ],
            egress=[
                client.V1NetworkPolicyEgressRule(
                    to=[client.V1NetworkPolicyPeer(pod_selector=client.V1LabelSelector())]
                ),
                client.V1NetworkPolicyEgressRule(
                    to=[client.V1NetworkPolicyPeer(
                        namespace_selector=client.V1LabelSelector(
                            match_labels={"kubernetes.io/metadata.name": "kube-dns"}
                        )
                    )],
                    ports=[client.V1NetworkPolicyPort(port=53, protocol="UDP")]
                )
            ]
        )
    ))

def create_rbac(user_id):
    v1.create_namespaced_service_account(user_id, client.V1ServiceAccount(
        metadata=client.V1ObjectMeta(name="env-sa", namespace=user_id)
    ))
    rbac.create_namespaced_role(user_id, client.V1Role(
        metadata=client.V1ObjectMeta(name="env-role", namespace=user_id),
        rules=[client.V1PolicyRule(
            api_groups=[""],
            resources=["pods", "services", "configmaps"],
            verbs=["get", "list", "watch"]
        )]
    ))
    rbac.create_namespaced_role_binding(user_id, client.V1RoleBinding(
        metadata=client.V1ObjectMeta(name="env-rolebinding", namespace=user_id),
        role_ref=client.V1RoleRef(
            api_group="rbac.authorization.k8s.io",
            kind="Role",
            name="env-role"
        ),
        subjects=[client.RbacV1Subject(
            kind="ServiceAccount",
            name="env-sa",
            namespace=user_id
        )]
    ))

def create_pvc(user_id):
    v1.create_namespaced_persistent_volume_claim(user_id, client.V1PersistentVolumeClaim(
        metadata=client.V1ObjectMeta(name="env-pvc", namespace=user_id),
        spec=client.V1PersistentVolumeClaimSpec(
            access_modes=["ReadWriteOnce"],
            resources=client.V1VolumeResourceRequirements(
                requests={"storage": "1Gi"}
            )
        )
    ))

def create_deployment(user_id, image):
    apps_v1.create_namespaced_deployment(user_id, client.V1Deployment(
        metadata=client.V1ObjectMeta(name="env-deployment", namespace=user_id),
        spec=client.V1DeploymentSpec(
            replicas=1,
            selector=client.V1LabelSelector(match_labels={"app": "playground-env"}),
            template=client.V1PodTemplateSpec(
                metadata=client.V1ObjectMeta(labels={"app": "playground-env"}),
                spec=client.V1PodSpec(
                    service_account_name="env-sa",
                    containers=[client.V1Container(
                        name="env",
                        image=image,
                        args=["--auth", "none", "--bind-addr", "0.0.0.0:8080", "/home/coder"],
                        ports=[client.V1ContainerPort(container_port=8080)],
                        resources=client.V1ResourceRequirements(
                            requests={"cpu": "200m", "memory": "256Mi"},
                            limits={"cpu": "1", "memory": "1Gi"}
                        ),
                        volume_mounts=[client.V1VolumeMount(
                            mount_path="/home/coder",
                            name="workspace"
                        )]
                    )],
                    volumes=[client.V1Volume(
                        name="workspace",
                        persistent_volume_claim=client.V1PersistentVolumeClaimVolumeSource(
                            claim_name="env-pvc"
                        )
                    )]
                )
            )
        )
    ))

def create_service(user_id):
    v1.create_namespaced_service(user_id, client.V1Service(
        metadata=client.V1ObjectMeta(name="env-service", namespace=user_id),
        spec=client.V1ServiceSpec(
            selector={"app": "playground-env"},
            ports=[client.V1ServicePort(port=80, target_port=8080)]
        )
    ))

def create_ingress(user_id):
    # only Ingress in the system that needs regex+rewrite (pod needs prefix stripped).
    # host=LB_URL is REQUIRED or nginx puts this under the "_" catch-all server block
    # instead of the real hostname's block, and it silently never matches.
    networking.create_namespaced_ingress(user_id, client.V1Ingress(
        metadata=client.V1ObjectMeta(
            name="env-ingress",
            namespace=user_id,
            annotations={
                "nginx.ingress.kubernetes.io/rewrite-target": "/$2",
                "nginx.ingress.kubernetes.io/use-regex": "true"
            }
        ),
        spec=client.V1IngressSpec(
            ingress_class_name="nginx",
            rules=[client.V1IngressRule(
                host=os.environ.get("LB_URL", ""),
                http=client.V1HTTPIngressRuleValue(
                    paths=[client.V1HTTPIngressPath(
                        path=f"/env/{user_id}(/|$)(.*)",
                        path_type="ImplementationSpecific",
                        backend=client.V1IngressBackend(
                            service=client.V1IngressServiceBackend(
                                name="env-service",
                                port=client.V1ServiceBackendPort(number=80)
                            )
                        )
                    )]
                )
            )]
        )
    ))

@app.post("/api/environments")
def create_environment(req: EnvRequest):
    user_id = f"user-{uuid.uuid4().hex[:8]}"
    ttl = str(int(time.time()) + 1800)
    image = IMAGES.get(req.env_type, IMAGES["python"])

    create_namespace(user_id, ttl)
    create_quota(user_id)
    create_network_policy(user_id)
    create_rbac(user_id)
    create_pvc(user_id)
    create_deployment(user_id, image)
    create_service(user_id)
    create_ingress(user_id)

    return {
        "user_id": user_id,
        "ttl_expires_at": ttl,
        "url": get_env_url(user_id),
        "status": "created"
    }

@app.delete("/api/environments/{user_id}")
def delete_environment(user_id: str):
    try:
        v1.delete_namespace(user_id)
        return {"status": "deleted", "user_id": user_id}
    except client.exceptions.ApiException:
        raise HTTPException(status_code=404, detail="Environment not found")

@app.get("/api/environments")
def list_environments():
    ns_list = v1.list_namespace(label_selector="managed-by=playground")
    envs = []
    for ns in ns_list.items:
        uid = ns.metadata.name
        envs.append({
            "user_id": uid,
            "ttl_expires_at": ns.metadata.labels.get("ttl-expires-at"),
            "status": ns.status.phase,
            "url": get_env_url(uid)
        })
    return {"environments": envs}
