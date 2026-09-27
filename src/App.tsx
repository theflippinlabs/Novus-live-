import { useEffect, useState } from "react";
import { api, ApiError, setPlanLimitHandler } from "./api";
import { BottomNav } from "./components/BottomNav";
import { TopBar } from "./components/TopBar";
import { BrandLogo } from "./components/ui";
import { LangToggle } from "./components/LangToggle";
import { ViewerSheet } from "./components/ViewerSheet";
import { useT } from "./i18n";
import { handleChatSenderReturn, refreshChatSender } from "./chatSender";
import { loadMe } from "./permissions";
import { connectRealtime, navigate, openSettings, switchRoom, useStore, type View } from "./store";
import { markNotificationsSeen } from "./push";
import { refreshBilling, showUpgrade } from "./billing";
import { BillingBanner, UpgradeSheet } from "./components/BillingSection";
import { AdminView } from "./views/AdminView";
import { AlertsView } from "./views/AlertsView";
import { AnalyticsView } from "./views/AnalyticsView";
import { AssistantView } from "./views/AssistantView";
import { LiveView } from "./views/LiveView";
import { SettingsView } from "./views/SettingsView";
import { ViewersView } from "./views/ViewersView";
import { PricingPage } from "./views/PricingPage";
import { LostCodeLink, RecoverPage } from "./components/FounderCode";

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
      setError(e instanceof ApiError && e.status === 429 ? t("tooManyAttempts") : t("invalidKey"));
    }
  };
  return (
    <div className="login">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <LangToggle />
      </div>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <BrandLogo />
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
        <LostCodeLink />
      </div>
      <a className="link-btn" href="/pricing?from=login" style={{ display: "block", textAlign: "center", marginTop: 16 }}>
        {t("noAccount")}
      </a>
    </div>
  );
}

const VIEWS: View[] = ["live", "alerts", "viewers", "assistant", "analytics", "settings"];

/** Open the screen (and TikTok room) a link or notification points to: /?view=alerts&room=tt:x */
function openFromUrl(href: string): void {
  const params = new URL(href, location.origin).searchParams;
  const view = params.get("view");
  const room = params.get("room");
  if (room && /^(main|tt:[\w.]{1,64})$/.test(room)) switchRoom(room);
  if (view === "billing") openSettings("billing");
  else if (view === "settings") openSettings(null);
  else if (view && (VIEWS as string[]).includes(view)) navigate(view as View);
}

function Shell() {
  const view = useStore((s) => s.view);
  const toast = useStore((s) => s.toast);
  return (
    <div className="app">
      <BillingBanner />
      <TopBar />
      <main className="view">
        {view === "live" ? <LiveView /> : null}
        {view === "alerts" ? <AlertsView /> : null}
        {view === "viewers" ? <ViewersView /> : null}
        {view === "assistant" ? <AssistantView /> : null}
        {view === "analytics" ? <AnalyticsView /> : null}
        {view === "settings" ? <SettingsView /> : null}
        {view === "admin" ? <AdminView /> : null}
      </main>
      <BottomNav />
      <ViewerSheet />
      <UpgradeSheet />
      {toast ? (
        <div className={`toast ${toast.tone}`} role="status" key={toast.id}>
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  // Public pages (no login): pricing and the post-checkout confirmation.
  const path = location.pathname;
  if (path.startsWith("/pricing")) return <PricingPage />;
  if (path.startsWith("/billing/success")) return <PricingPage success />;
  if (path.startsWith("/recover")) return <RecoverPage />;
  return <AppAuthed />;
}

function AppAuthed() {
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

  // "Send in chat": pick up the TikTok connection, also when coming back from its sign-in page.
  useEffect(() => {
    if (auth !== "ok") return;
    handleChatSenderReturn();
    void refreshChatSender();
    void loadMe();
    void refreshBilling();
    setPlanLimitHandler(showUpgrade);
    // Back from the billing portal or a plan change, or opened from a notification.
    if (new URLSearchParams(location.search).get("view")) {
      openFromUrl(location.href);
      history.replaceState(null, "", "/");
    }
    markNotificationsSeen();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshChatSender();
      void refreshBilling();
      markNotificationsSeen();
    };
    // A notification tapped while the app was already open.
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "novus:open" && typeof e.data.url === "string") openFromUrl(e.data.url);
    };
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [auth]);

  if (auth === "checking") return null;
  if (auth === "needed") return <Login onDone={() => setAuth("ok")} />;
  return <Shell />;
}
