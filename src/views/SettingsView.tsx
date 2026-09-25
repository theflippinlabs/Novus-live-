import { useEffect, useState } from "react";
import { PRESET_THRESHOLDS } from "../../shared/settings";
import { CATEGORIES, type Sensitivity, type Settings, type Thresholds } from "../../shared/types";
import { api, ApiError } from "../api";
import { Segmented, Toggle } from "../components/ui";
import { categoryLabel, errorText, setLanguage, severityLabel, useLang, useT } from "../i18n";
import { getState, navigate, setState, toast, useStore } from "../store";
import { TikTokIntegration } from "./TikTokIntegration";
import { TeamSection } from "../components/TeamSection";
import { useCan, useIsFounder } from "../permissions";
import { BillingSection } from "../components/BillingSection";

async function save(patch: Partial<Settings>, okText: string) {
  try {
    const s = await api.saveSettings(patch);
    setState({ settings: s });
    toast(okText, "ok");
  } catch (e) {
    toast(errorText(e instanceof ApiError ? e.code : "save_failed", getState().settings.language), "warn");
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
              <button aria-label={`${t("remove")} ${i}`} onClick={() => onChange(items.filter((x) => x !== i))}>
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
  const lang = useLang();
  const [th, setTh] = useState(initial);
  const valid = th.watch < th.warning && th.warning < th.critical;
  const slider = (key: keyof Thresholds, color: string) => (
    <label className="row" style={{ marginTop: 8 }}>
      <span style={{ width: 110, fontSize: 12, fontWeight: 700, color }}>{severityLabel(key, lang)}</span>
      <input type="range" min={1} max={100} value={th[key]} onChange={(e) => setTh({ ...th, [key]: Number(e.target.value) })} style={{ flex: 1, accentColor: "#c9a55a" }} aria-label={`${t("thresholdOf")} ${severityLabel(key, lang)}`} />
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
        {valid ? t("save") : `${severityLabel("watch", lang)} < ${severityLabel("warning", lang)} < ${severityLabel("critical", lang)}`}
      </button>
    </div>
  );
}

/** A team member sees who they are logged in as and what they can do. */
function MeCard() {
  const lang = useLang();
  const me = useStore((s) => s.me);
  if (!me || me.kind !== "member" || !me.member) return null;
  const roles = { director: { en: "Director", fr: "Directeur" }, manager: { en: "Manager", fr: "Manager" }, moderator: { en: "Moderator", fr: "Modérateur" } };
  return (
    <div className="card" style={{ marginTop: 4 }}>
      <div className="card-title">{lang === "fr" ? "Mon accès" : "My access"}</div>
      <div style={{ fontWeight: 700 }}>
        {me.member.name} · {roles[me.member.role][lang]}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {lang === "fr"
          ? "Accès donné par le fondateur de l'agence. Certaines options sont masquées selon tes autorisations."
          : "Access given by the agency founder. Some options are hidden depending on your permissions."}
        {me.accounts ? ` ${lang === "fr" ? "Livers :" : "Streamers:"} ${me.accounts.map((a) => `@${a}`).join(", ")}` : ""}
      </div>
    </div>
  );
}

export function SettingsView() {
  const t = useT();
  const lang = useLang();
  const settings = useStore((s) => s.settings);
  const ai = useStore((s) => s.ai);
  const canSettings = useCan("settings");
  const canTeam = useCan("team");
  const isFounder = useIsFounder();
  const isAdmin = useStore((s) => Boolean(s.me?.admin));
  const teamEnabled = useStore((s) => s.me?.teamEnabled ?? false);
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
    { value: "low", label: t("sensLow").toUpperCase() },
    { value: "balanced", label: t("sensBalanced").toUpperCase() },
    { value: "strict", label: t("sensStrict").toUpperCase() },
    { value: "custom", label: t("custom").toUpperCase() },
  ];
  const presetInfo = settings.sensitivity !== "custom" ? PRESET_THRESHOLDS[settings.sensitivity] : settings.customThresholds;

  return (
    <div className="scroll">
      <div className="narrow">
        <MeCard />
        {isFounder ? (
          <>
            <div className="section-title" style={{ marginTop: 4 }}>
              {lang === "fr" ? "Abonnement" : "Subscription"}
            </div>
            <BillingSection />
          </>
        ) : null}
        {isAdmin ? (
          <button className="btn block" style={{ marginTop: 10 }} onClick={() => navigate("admin")}>
            {lang === "fr" ? "Tableau de bord admin" : "Admin dashboard"}
          </button>
        ) : null}
        {canSettings ? (
          <>
        <div className="section-title" style={{ marginTop: 4 }}>
          {t("sensitivity")}
        </div>
        <div className="card">
          <Segmented label={t("sensitivity")} value={settings.sensitivity} options={sensitivityOptions} gold onChange={(v) => (v === "custom" ? setState({ settings: { ...settings, sensitivity: "custom" } }) : save({ sensitivity: v }, ok))} />
          <div className="small muted" style={{ marginTop: 8 }}>
            {severityLabel("watch", lang).toLowerCase()} ≥ {presetInfo.watch} · {severityLabel("warning", lang).toLowerCase()} ≥ {presetInfo.warning} · {severityLabel("critical", lang).toLowerCase()} ≥ {presetInfo.critical}
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
        <ListEditor label={t("bannedPhrases")} items={settings.bannedPhrases} placeholder={t("bannedPlaceholder")} onChange={(v) => save({ bannedPhrases: v }, ok)} />

        <div className="section-title">{t("trustedUsers")}</div>
        <ListEditor label={t("trustedUsers")} items={settings.trustedUsers} placeholder={t("handlePlaceholder")} onChange={(v) => save({ trustedUsers: v }, ok)} />
        <div style={{ height: 12 }} />
        <ListEditor label={t("watchlist")} items={settings.watchlist} placeholder={t("handlePlaceholder")} onChange={(v) => save({ watchlist: v }, ok)} />

          </>
        ) : null}

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
            onChange={(v) => void setLanguage(v)}
          />
          <div className="small muted" style={{ marginTop: 8 }}>
            {t("languageHint")}
          </div>
          {canSettings ? (
            <>
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
            {t("streamerHint")}
          </div>
            </>
          ) : null}
        </div>

        {canSettings ? (
          <>
        <div className="section-title">{t("aiAnalysis")}</div>
        <div className="card">
          <div className="row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{ai.state === "local_only" ? t("aiLocalTitle") : `${ai.provider} · ${ai.model ?? ""}`}</div>
              <div className="small muted">
                {ai.state === "local_only" ? t("aiLocalHint2") : t("aiReviewHint").replace("{n}", String(ai.analyzed))}
                {ai.lastError ? ` ${t("lastError")} ${ai.lastError}` : ""}
              </div>
            </div>
            {ai.state !== "local_only" ? <Toggle label={t("aiAnalysis")} on={settings.aiEnabled} onChange={(v) => save({ aiEnabled: v }, ok)} /> : null}
          </div>
        </div>

          </>
        ) : null}

        <div className="section-title">{t("tiktokIntegration")}</div>
        <TikTokIntegration />

        {teamEnabled && canTeam ? (
          <>
            <div className="section-title">{lang === "fr" ? "Équipe" : "Team"}</div>
            <TeamSection />
          </>
        ) : null}

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
          NOVUS LIVE · {t("ecosystem")}
        </div>
      </div>
    </div>
  );
}
