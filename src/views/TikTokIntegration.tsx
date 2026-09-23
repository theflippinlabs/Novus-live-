import { useEffect, useState } from "react";
import type { TikTokIntegrationState } from "../../shared/types";
import { api, ApiError } from "../api";
import { useT } from "../i18n";
import { ago } from "../format";
import { setState, toast, useStore } from "../store";

const STATES: TikTokIntegrationState[] = ["NOT_CONNECTED", "CONNECTOR_AVAILABLE", "CONNECTED", "LIVE_DETECTED", "LIVE_ENDED", "ERROR"];

const EXPLAIN: Record<TikTokIntegrationState, string> = {
  NOT_CONNECTED: "No authorized connector is configured on the server (INGEST_TOKEN not set). Demo mode works without it.",
  CONNECTOR_AVAILABLE: "The ingestion endpoint is enabled. Waiting for an authorized TikTok LIVE connector to send events.",
  CONNECTED: "A connector is sending heartbeats/events. No LIVE activity detected yet.",
  LIVE_DETECTED: "LIVE events are flowing into Novus in real time.",
  LIVE_ENDED: "The connector reported that the LIVE ended. A post-LIVE report was generated.",
  ERROR: "The connector sent invalid data or failed. Check the connector logs.",
};

export function TikTokIntegration() {
  const t = useT();
  const status = useStore((s) => s.tiktok);
  const [username, setUsername] = useState(status?.username ?? "");

  useEffect(() => {
    api
      .tiktok()
      .then((s) => setState({ tiktok: s }))
      .catch(() => undefined);
  }, []);

  if (!status) return <div className="card muted">…</div>;

  const connect = async () => {
    try {
      const s = await api.tiktokConnect(username);
      setState({ tiktok: s });
      toast(`@${s.username}`, "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.code : "Error", "warn");
    }
  };
  const disconnect = async () => {
    const s = await api.tiktokDisconnect();
    setState({ tiktok: s });
    setUsername("");
  };

  const tone = status.state === "LIVE_DETECTED" || status.state === "CONNECTED" ? "good" : status.state === "ERROR" ? "bad" : status.state === "CONNECTOR_AVAILABLE" ? "gold" : "";

  return (
    <div className="card">
      <div className="row wrap">
        <span className={`state-badge ${tone}`}>{status.state.replace(/_/g, " ")}</span>
        {status.lastEventAt ? <span className="small muted">last event {ago(status.lastEventAt, Date.now())} ago</span> : null}
      </div>
      <p className="small" style={{ color: "var(--text-2)" }}>
        {EXPLAIN[status.state]}
        {status.error ? ` (${status.error})` : ""}
      </p>
      <div className="chips" aria-label="Integration states">
        {STATES.map((s) => (
          <span key={s} className={`chip ${s === status.state ? "on" : ""}`} style={{ fontSize: 10.5 }}>
            {s.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      <div className="card-title" style={{ marginTop: 14 }}>
        TikTok account
      </div>
      <div className="row">
        <input className="input" placeholder="@yourhandle" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="TikTok username" autoCapitalize="off" autoCorrect="off" />
        {status.username ? (
          <button className="btn" onClick={disconnect}>
            {t("disconnect")}
          </button>
        ) : (
          <button className="btn gold" onClick={connect} disabled={username.trim().length < 2}>
            {t("connect")}
          </button>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        Novus never asks for your TikTok password and never calls undocumented TikTok endpoints. The account name tells an authorized connector which LIVE to follow.
      </div>

      <div className="card-title" style={{ marginTop: 14 }}>
        {t("capabilities")}
      </div>
      {status.capabilities.map((c) => (
        <div key={c.capability} className="list-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.capability}</div>
            <div className="small muted">{c.detail}</div>
          </div>
          <span className={`cap-status ${c.status}`}>{c.status.replace(/_/g, " ").toUpperCase()}</span>
        </div>
      ))}
      <div className="small muted" style={{ marginTop: 8 }}>
        Full details: docs/TIKTOK_INTEGRATION.md
      </div>
    </div>
  );
}
