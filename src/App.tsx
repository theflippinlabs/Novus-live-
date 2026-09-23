import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { BottomNav } from "./components/BottomNav";
import { TopBar } from "./components/TopBar";
import { Logo } from "./components/ui";
import { ViewerSheet } from "./components/ViewerSheet";
import { useT } from "./i18n";
import { connectRealtime, useStore } from "./store";
import { AlertsView } from "./views/AlertsView";
import { AnalyticsView } from "./views/AnalyticsView";
import { AssistantView } from "./views/AssistantView";
import { LiveView } from "./views/LiveView";
import { SettingsView } from "./views/SettingsView";
import { ViewersView } from "./views/ViewersView";

function Login({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await api.login(key);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? "Too many attempts — wait a minute." : "Invalid key");
    }
  };
  return (
    <div className="login">
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <Logo size={64} />
        <h1 className="chrome-text" style={{ letterSpacing: "0.22em", fontSize: 22 }}>
          NOVUS LIVE
        </h1>
      </div>
      <div className="card">
        <div className="card-title">{t("loginTitle")}</div>
        <p className="small muted">{t("loginHint")}</p>
        <input className="input" type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} aria-label={t("loginTitle")} />
        {error ? (
          <div className="small" style={{ color: "#ff8b98", marginTop: 8 }}>
            {error}
          </div>
        ) : null}
        <button className="btn gold block" style={{ marginTop: 12 }} onClick={submit} disabled={!key}>
          {t("login")}
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const view = useStore((s) => s.view);
  const toast = useStore((s) => s.toast);
  return (
    <div className="app">
      <TopBar />
      <main className="view">
        {view === "live" ? <LiveView /> : null}
        {view === "alerts" ? <AlertsView /> : null}
        {view === "viewers" ? <ViewersView /> : null}
        {view === "assistant" ? <AssistantView /> : null}
        {view === "analytics" ? <AnalyticsView /> : null}
        {view === "settings" ? <SettingsView /> : null}
      </main>
      <BottomNav />
      <ViewerSheet />
      {toast ? (
        <div className={`toast ${toast.tone}`} role="status" key={toast.id}>
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<"checking" | "needed" | "ok">("checking");

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setAuth(s.required && !s.authenticated ? "needed" : "ok"))
      .catch(() => setAuth("ok"));
  }, []);

  useEffect(() => {
    if (auth !== "ok") return;
    return connectRealtime(() => setAuth("needed"));
  }, [auth]);

  if (auth === "checking") return null;
  if (auth === "needed") return <Login onDone={() => setAuth("ok")} />;
  return <Shell />;
}
