import { useState, useEffect } from "react";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

const ENV_OPTIONS = [
  { value: "python", label: "Python 3.11" },
  { value: "node", label: "Node 20" },
  { value: "go", label: "Go 1.22" },
];

function formatTTL(expiresAt) {
  const secondsLeft = Math.max(
    0,
    Math.floor(expiresAt - Date.now() / 1000)
  );

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;

  return `${m}m ${s}s`;
}

function App() {
  const [environments, setEnvironments] = useState([]);
  const [creating, setCreating] = useState(false);
  const [envType, setEnvType] = useState("python");
  const [error, setError] = useState(null);

  const fetchEnvs = async () => {
    try {
      const res = await fetch(`${API_URL}/environments`);
      const data = await res.json();

      setEnvironments(data.environments || []);
      setError(null);
    } catch (err) {
      setError("Cannot reach API - make sure the backend is running");
    }
  };

  useEffect(() => {
    fetchEnvs();

    const interval = setInterval(fetchEnvs, 5000);

    return () => clearInterval(interval);
  }, []);

  const createEnv = async () => {
    setCreating(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/environments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          env_type: envType,
        }),
      });

      if (!res.ok) {
        throw new Error("Create failed");
      }

      await res.json();
      fetchEnvs();
    } catch (err) {
      setError("Failed to create environment");
    }

    setCreating(false);
  };

  const destroyEnv = async (userId) => {
    try {
      await fetch(`${API_URL}/environments/${userId}`, {
        method: "DELETE",
      });

      fetchEnvs();
    } catch (err) {
      setError("Failed to destroy environment");
    }
  };

  const copyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <h1 style={styles.heroTitle}>K8s Playground</h1>

        <p style={styles.heroSubtitle}>
          Spin up isolated Kubernetes environments instantly
        </p>

        <span style={styles.badge}>
          <span style={styles.badgeDot} />
          Running on EKS
        </span>
      </header>

      <main style={styles.main}>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>
            Create New Environment
          </h2>

          <div style={styles.createRow}>
            <select
              value={envType}
              onChange={(e) => setEnvType(e.target.value)}
              style={styles.select}
            >
              {ENV_OPTIONS.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                >
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              onClick={createEnv}
              disabled={creating}
              style={{
                ...styles.primaryButton,
                opacity: creating ? 0.6 : 1,
                cursor: creating
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              {creating
                ? "Creating..."
                : "Create Environment"}
            </button>
          </div>

          <p style={styles.hint}>
            Each environment gets its own namespace,
            CPU/memory limits, network isolation,
            and auto-deletes after 30 minutes.
          </p>

          {error && (
            <p style={styles.errorText}>
              {error}
            </p>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>
            Active Environments
            <span style={styles.countPill}>
              {environments.length}
            </span>
          </h2>

          {environments.length === 0 && (
            <p style={styles.emptyText}>
              No environments running yet.
              Create one above to get started.
            </p>
          )}
          
          {environments.map((env) => (
            <div
              key={env.user_id}
              style={styles.envRow}
            >
              <div style={styles.envHeader}>
                <span style={styles.envId}>
                  {env.user_id}
                </span>

                <span
                  style={
                    env.status === "Active"
                      ? {
                          ...styles.statusBadge,
                          ...styles.statusActive,
                        }
                      : {
                          ...styles.statusBadge,
                          ...styles.statusOther,
                        }
                  }
                >
                  {env.status}
                </span>

                <button
                  onClick={() =>
                    destroyEnv(env.user_id)
                  }
                  style={styles.destroyButton}
                >
                  Destroy
                </button>
              </div>

              <div style={styles.urlRow}>
                <input
                  readOnly
                  value={env.url}
                  style={styles.urlInput}
                  onFocus={(e) =>
                    e.target.select()
                  }
                />

                <button
                  onClick={() =>
                    copyUrl(env.url)
                  }
                  style={styles.copyButton}
                >
                  Copy
                </button>

                {/* FIXED */}
                <a
                  href={env.url}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.openButton}
                >
                  Open
                </a>
              </div>

              <div style={styles.metaRow}>
                <span style={styles.metaItem}>
                  TTL:{" "}
                  {env.ttl_expires_at
                    ? formatTTL(
                        Number(env.ttl_expires_at)
                      )
                    : "-"}
                </span>

                <span style={styles.metaItem}>
                  ISOLATED • Namespace •
                  NetworkPolicy • RBAC
                </span>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(180deg,#0b1120 0%,#111827 100%)",
    color: "#e5e7eb",
    fontFamily:
      "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  },

  hero: {
    textAlign: "center",
    padding: "64px 24px 40px",
    borderBottom: "1px solid #1f2937",
  },

  heroTitle: {
    fontSize: "42px",
    fontWeight: 800,
    margin: 0,
    background:
      "linear-gradient(90deg,#60a5fa,#a78bfa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },

  heroSubtitle: {
    color: "#9ca3af",
    fontSize: "16px",
    marginTop: "12px",
  },

  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "20px",
    padding: "6px 16px",
    borderRadius: "999px",
    background: "#1e293b",
    color: "#93c5fd",
    fontSize: "13px",
    fontWeight: 500,
  },

  badgeDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#34d399",
    display: "inline-block",
  },

  main: {
    maxWidth: "760px",
    margin: "0 auto",
    padding: "40px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },

  card: {
    background: "#161f32",
    border: "1px solid #1f2937",
    borderRadius: "16px",
    padding: "28px",
  },

  cardTitle: {
    fontSize: "18px",
    fontWeight: 700,
    marginTop: 0,
    marginBottom: "18px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },

  countPill: {
    background: "#2563eb",
    color: "#fff",
    fontSize: "12px",
    fontWeight: 700,
    padding: "2px 10px",
    borderRadius: "999px",
  },

  createRow: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
  },

  select: {
    flex: "1 1 220px",
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#e5e7eb",
    fontSize: "14px",
  },

  primaryButton: {
    padding: "12px 22px",
    borderRadius: "10px",
    border: "none",
    background:
      "linear-gradient(90deg,#2563eb,#7c3aed)",
    color: "#fff",
    fontWeight: 600,
    fontSize: "14px",
    cursor: "pointer",
  },

  hint: {
    color: "#6b7280",
    fontSize: "13px",
    marginTop: "16px",
    marginBottom: 0,
  },

  errorText: {
    color: "#f87171",
    fontSize: "13px",
    marginTop: "12px",
    marginBottom: 0,
  },

  emptyText: {
    color: "#6b7280",
    fontSize: "14px",
  },
    envRow: {
    borderTop: "1px solid #1f2937",
    paddingTop: "18px",
    marginTop: "18px",
  },

  envHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "12px",
  },

  envId: {
    fontFamily: "monospace",
    fontSize: "14px",
    color: "#93c5fd",
    fontWeight: 600,
  },

  statusBadge: {
    fontSize: "12px",
    fontWeight: 600,
    padding: "2px 10px",
    borderRadius: "999px",
  },

  statusActive: {
    background: "#064e3b",
    color: "#34d399",
  },

  statusOther: {
    background: "#3f2d1f",
    color: "#fbbf24",
  },

  destroyButton: {
    marginLeft: "auto",
    background: "transparent",
    border: "1px solid #7f1d1d",
    color: "#f87171",
    borderRadius: "8px",
    padding: "6px 12px",
    fontSize: "12px",
    cursor: "pointer",
  },

  urlRow: {
    display: "flex",
    gap: "8px",
    marginTop: "10px",
    flexWrap: "wrap",
  },

  urlInput: {
    flex: 1,
    minWidth: "250px",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#9ca3af",
    fontSize: "13px",
    fontFamily: "monospace",
  },

  copyButton: {
    padding: "10px 16px",
    borderRadius: "8px",
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#e5e7eb",
    fontSize: "13px",
    cursor: "pointer",
  },

  openButton: {
    padding: "10px 16px",
    borderRadius: "8px",
    border: "none",
    background: "#2563eb",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 600,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },

  metaRow: {
    display: "flex",
    gap: "16px",
    marginTop: "12px",
    flexWrap: "wrap",
  },

  metaItem: {
    fontSize: "12px",
    color: "#6b7280",
  },
};

export default App;
