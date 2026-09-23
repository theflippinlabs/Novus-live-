import { useEffect, useState } from "react";
import { PRESET_THRESHOLDS } from "../../shared/settings";
import { CATEGORIES, type Sensitivity, type Settings, type Thresholds } from "../../shared/types";
import { api, ApiError } from "../api";
import { Segmented, Toggle } from "../components/ui";
import { categoryLabel, useLang, useT } from "../i18n";
import { setState, toast, useStore } from "../store";
import { TikTokIntegration } from "./TikTokIntegration";

async function save(patch: Partial<Settings>, okText: string) {
  try {
    const s = await api.saveSettings(patch);
    setState({ settings: s });
    toast(okText, "ok");
  } catch (e) {
    toast(e instanceof ApiError ? e.code : "Save failed", "warn");
  }
}

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const t = useT();
  const [value, setValue] = useState("");
  const add = () => {
    const v = value.trim();
    if (!v || items.includes(v.toLowerCase())) return;
    onChange([...items, v]);
    setValue("");
  };
  return (
    <div className="card">
      <div className="card-title">{label}</div>
      <div className="row">
        <input
          className="input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label={label}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={80}
        />
        <button className="btn" onClick={add}>
          {t("add")}
        </button>
      </div>
      {items.length ? (
        <div className="chips" style={{ marginTop: 10 }}>
          {items.map((i) => (
            <span key={i} className="chip">
              {i}
              <button aria-label={`Remove ${i}`} onClick={() => onChange(items.filter((x) => x !== i))}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ThresholdEditor({ initial }: { initial: Thresholds }) {
  const t = useT();
  const [th, setTh] = useState(initial);
  const valid = th.watch < th.warning && th.warning < th.critical;
  const slider = (key: keyof Thresholds, color: string) => (
    <label className="row" style={{ marginTop: 8 }}>
      <span style={{ width: 80, fontSize: 13, fontWeight: 700, color }}>{key.toUpperCase()}</span>
      <input type="range" min={1} max={100} value={th[key]} onChange={(e) => setTh({ ...th, [key]: Number(e.target.value) })} style={{ flex: 1, accentColor: "#c9a55a" }} aria-label={`${key} threshold`} />
      <span className="mono" style={{ width: 32, textAlign: "right" }}>
        {th[key]}
      </span>
    </label>
  );
  return (
    <div style={{ marginTop: 12 }}>
      <div className="small muted">{t("thresholds")}</div>
      {slider("watch", "var(--r-watch)")}
      {slider("warning", "var(--r-warning)")}
      {slider("critical", "#ff8b98")}
      <button className="btn gold block" style={{ marginTop: 10 }} disabled={!valid} onClick={() => save({ sensitivity: "custom", customThresholds: th }, t("saved"))}>
        {valid ? t("save") : "watch < warning < critical"}
      </button>
    </div>
  );
}

export function SettingsView() {
  const t = useT();
  const lang = useLang();
  const settings = useStore((s) => s.settings);
  const ai = useStore((s) => s.ai);
  const [streamer, setStreamer] = useState(settings.streamerName);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setAuthRequired(s.required))
      .catch(() => undefined);
  }, []);

  const ok = t("saved");
  const sensitivityOptions: { value: Sensitivity; label: string }[] = [
    { value: "low", label: "LOW" },
    { value: "balanced", label: "BALANCED" },
    { value: "strict", label: "STRICT" },
    { value: "custom", label: t("custom").toUpperCase() },
  ];
  const presetInfo = settings.sensitivity !== "custom" ? PRESET_THRESHOLDS[settings.sensitivity] : settings.customThresholds;

  return (
    <div className="scroll">
      <div className="narrow">
        <div className="section-title" style={{ marginTop: 4 }}>
          {t("sensitivity")}
        </div>
        <div className="card">
          <Segmented label={t("sensitivity")} value={settings.sensitivity} options={sensitivityOptions} gold onChange={(v) => (v === "custom" ? setState({ settings: { ...settings, sensitivity: "custom" } }) : save({ sensitivity: v }, ok))} />
          <div className="small muted" style={{ marginTop: 8 }}>
            watch ≥ {presetInfo.watch} · warning ≥ {presetInfo.warning} · critical ≥ {presetInfo.critical}
          </div>
          {settings.sensitivity === "custom" ? <ThresholdEditor initial={settings.customThresholds} key={JSON.stringify(settings.customThresholds)} /> : null}
        </div>

        <div className="section-title">{t("detection")}</div>
        <div className="card" style={{ padding: "4px 14px" }}>
          {CATEGORIES.map((c) => (
            <div key={c} className="list-row">
              <span style={{ flex: 1 }}>{categoryLabel(c, lang)}</span>
              <Toggle label={categoryLabel(c, lang)} on={settings.categories[c]} onChange={(v) => save({ categories: { ...settings.categories, [c]: v } }, ok)} />
            </div>
          ))}
        </div>

        <div className="section-title">{t("bannedPhrases")}</div>
        <ListEditor label={t("bannedPhrases")} items={settings.bannedPhrases} placeholder="e.g. spoiler" onChange={(v) => save({ bannedPhrases: v }, ok)} />

        <div className="section-title">{t("trustedUsers")}</div>
        <ListEditor label={t("trustedUsers")} items={settings.trustedUsers} placeholder="@username" onChange={(v) => save({ trustedUsers: v }, ok)} />
        <div style={{ height: 12 }} />
        <ListEditor label={t("watchlist")} items={settings.watchlist} placeholder="@username" onChange={(v) => save({ watchlist: v }, ok)} />

        <div className="section-title">{t("language")}</div>
        <div className="card">
          <Segmented
            label={t("language")}
            value={settings.language}
            gold
            options={[
              { value: "en", label: "English" },
              { value: "fr", label: "Français" },
            ]}
            onChange={(v) => save({ language: v }, v === "fr" ? "Enregistré" : "Saved")}
          />
          <div className="small muted" style={{ marginTop: 8 }}>
            Chat languages are detected automatically (EN, FR, ES, DE, PT, IT, AR, RU, JA, KO, ZH…).
          </div>
          <div className="card-title" style={{ marginTop: 14 }}>
            {t("streamer")}
          </div>
          <div className="row">
            <input className="input" value={streamer} onChange={(e) => setStreamer(e.target.value)} aria-label={t("streamer")} autoCapitalize="off" autoCorrect="off" maxLength={64} />
            <button className="btn" onClick={() => save({ streamerName: streamer.replace(/^@/, "").trim() || settings.streamerName }, ok)}>
              {t("save")}
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            Used to spot look-alike impersonation accounts and to detect the host answering questions.
          </div>
        </div>

        <div className="section-title">{t("aiAnalysis")}</div>
        <div className="card">
          <div className="row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{ai.state === "local_only" ? "Local deterministic moderation" : `${ai.provider} · ${ai.model ?? ""}`}</div>
              <div className="small muted">
                {ai.state === "local_only"
                  ? "No ANTHROPIC_API_KEY on the server — stage 1 heuristics handle everything."
                  : `Only suspicious or ambiguous messages are sent for contextual review. Reviewed: ${ai.analyzed}.`}
                {ai.lastError ? ` Last error: ${ai.lastError}` : ""}
              </div>
            </div>
            {ai.state !== "local_only" ? <Toggle label={t("aiAnalysis")} on={settings.aiEnabled} onChange={(v) => save({ aiEnabled: v }, ok)} /> : null}
          </div>
        </div>

        <div className="section-title">{t("tiktokIntegration")}</div>
        <TikTokIntegration />

        <div className="section-title">{t("install")}</div>
        <div className="card">
          <div className="small">{t("installHint")}</div>
        </div>

        {authRequired ? (
          <button
            className="btn block"
            style={{ marginTop: 16 }}
            onClick={async () => {
              await api.logout();
              location.reload();
            }}
          >
            {t("logout")}
          </button>
        ) : null}
        <div className="small muted" style={{ textAlign: "center", margin: "24px 0 8px" }}>
          NOVUS LIVE · Part of the Novarys / Pulse Engine ecosystem
        </div>
      </div>
    </div>
  );
}
