import { useEffect, useState, type ReactNode } from "react";
import { PRESET_THRESHOLDS } from "../../shared/settings";
import { CATEGORIES, type Sensitivity, type Settings, type Thresholds } from "../../shared/types";
import { api, ApiError } from "../api";
import { Segmented, Toggle } from "../components/ui";
import { categoryLabel, errorText, setLanguage, severityLabel, useLang, useT } from "../i18n";
import { getState, navigate, openSettings, setState, toast, useStore, type SettingsPage } from "../store";
import { TikTokIntegration } from "./TikTokIntegration";
import { TeamSection } from "../components/TeamSection";
import { ChangeFounderCode } from "../components/FounderCode";
import { IconBack, IconCard, IconChart, IconChevron, IconGlobe, IconList, IconLive, IconLogout, IconShield, IconSpark, IconUser, IconUsers } from "../components/Icons";
import { billingApi, PLAN_NAMES, refreshBilling } from "../billing";
import { PERM_LABEL, ROLE_LABEL, useCan, useIsFounder } from "../permissions";
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

// ---------------------------------------------------------------- menu & sub-pages

type Lang = "en" | "fr";
const PAGE_TITLE: Record<SettingsPage, Record<Lang, string>> = {
  profile: { en: "Profile", fr: "Profil" },
  billing: { en: "Subscription", fr: "Abonnement" },
  team: { en: "Team", fr: "Équipe" },
  moderation: { en: "Sensitivity & detection", fr: "Sensibilité & détection" },
  lists: { en: "Words & users", fr: "Mots & utilisateurs" },
  ai: { en: "AI analysis", fr: "Analyse IA" },
  tiktok: { en: "TikTok accounts", fr: "Comptes TikTok" },
  app: { en: "Language & app", fr: "Langue & application" },
};

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "N") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Who is logged in: the workspace name, the person's role and the plan. */
function useIdentity() {
  const lang = useLang();
  const me = useStore((s) => s.me);
  const billing = useStore((s) => s.billing);
  const member = me?.kind === "member" ? me.member : undefined;
  const name = member?.name ?? billing?.name ?? "NOVUS LIVE";
  const role = member ? ROLE_LABEL[member.role][lang] : lang === "fr" ? "Fondateur" : "Founder";
  const plan = billing ? PLAN_NAMES[billing.plan] : null;
  return { name, role, plan, member, billing, workspace: billing?.name };
}

function MenuRow({ icon, label, detail, onClick }: { icon: ReactNode; label: string; detail?: string; onClick: () => void }) {
  return (
    <button className="menu-row" onClick={onClick}>
      <span className="menu-icon">{icon}</span>
      <span className="menu-text">
        <span className="menu-label">{label}</span>
        {detail ? <span className="menu-detail">{detail}</span> : null}
      </span>
      <IconChevron className="menu-chevron" width={18} height={18} />
    </button>
  );
}

function SettingsMenu() {
  const t = useT();
  const lang = useLang();
  const fr = lang === "fr";
  const settings = useStore((s) => s.settings);
  const rooms = useStore((s) => s.rooms);
  const ai = useStore((s) => s.ai);
  const canSettings = useCan("settings");
  const canTeam = useCan("team");
  const isFounder = useIsFounder();
  const isAdmin = useStore((s) => Boolean(s.me?.admin));
  const teamEnabled = useStore((s) => s.me?.teamEnabled ?? false);
  const id = useIdentity();
  const b = id.billing;
  const followed = rooms.filter((r) => r.kind === "tiktok").length;
  const sens = { low: t("sensLow"), balanced: t("sensBalanced"), strict: t("sensStrict"), custom: t("custom") }[settings.sensitivity];
  const icon = { width: 20, height: 20 };
  const statusText = b ? (b.comped ? (fr ? "Accès offert" : "Complimentary") : b.status === "trialing" ? (fr ? "Essai" : "Trial") : b.status === "active" ? (fr ? "Actif" : "Active") : b.status) : "";

  return (
    <>
      <button className="profile-head" onClick={() => openSettings("profile")}>
        <span className="profile-avatar">{initials(id.name)}</span>
        <span className="menu-text">
          <span className="profile-name">{id.name}</span>
          <span className="menu-detail">
            {id.role}
            {id.plan ? ` · ${id.plan}` : ""}
          </span>
        </span>
        <IconChevron className="menu-chevron" width={18} height={18} />
      </button>

      <div className="menu-group-title">{fr ? "Compte" : "Account"}</div>
      <div className="menu-group">
        <MenuRow icon={<IconUser {...icon} />} label={PAGE_TITLE.profile[lang]} detail={fr ? "Nom, e-mail, code d'accès" : "Name, e-mail, access code"} onClick={() => openSettings("profile")} />
        {isFounder ? <MenuRow icon={<IconCard {...icon} />} label={PAGE_TITLE.billing[lang]} detail={[id.plan, statusText].filter(Boolean).join(" · ")} onClick={() => openSettings("billing")} /> : null}
        {teamEnabled && canTeam ? <MenuRow icon={<IconUsers {...icon} />} label={PAGE_TITLE.team[lang]} detail={fr ? "Membres et autorisations" : "Members and permissions"} onClick={() => openSettings("team")} /> : null}
        {isAdmin ? <MenuRow icon={<IconChart {...icon} />} label={fr ? "Tableau de bord admin" : "Admin dashboard"} detail={fr ? "Clients, revenus, coûts" : "Customers, revenue, costs"} onClick={() => navigate("admin")} /> : null}
      </div>

      <div className="menu-group-title">TikTok</div>
      <div className="menu-group">
        <MenuRow
          icon={<IconLive {...icon} />}
          label={PAGE_TITLE.tiktok[lang]}
          detail={followed ? (fr ? `${followed} compte${followed > 1 ? "s" : ""} suivi${followed > 1 ? "s" : ""} · groupes · envoi dans le chat` : `${followed} followed · groups · send in chat`) : fr ? "Ajouter les livers à surveiller" : "Add the streamers to watch"}
          onClick={() => openSettings("tiktok")}
        />
      </div>

      {canSettings ? (
        <>
          <div className="menu-group-title">{fr ? "Modération" : "Moderation"}</div>
          <div className="menu-group">
            <MenuRow icon={<IconShield {...icon} />} label={PAGE_TITLE.moderation[lang]} detail={sens} onClick={() => openSettings("moderation")} />
            <MenuRow
              icon={<IconList {...icon} />}
              label={PAGE_TITLE.lists[lang]}
              detail={fr ? `${settings.bannedPhrases.length} mots interdits · ${settings.trustedUsers.length} de confiance` : `${settings.bannedPhrases.length} banned · ${settings.trustedUsers.length} trusted`}
              onClick={() => openSettings("lists")}
            />
            <MenuRow icon={<IconSpark {...icon} />} label={PAGE_TITLE.ai[lang]} detail={ai.state === "local_only" ? t("aiLocalTitle") : settings.aiEnabled ? (fr ? "Activée" : "On") : fr ? "Désactivée" : "Off"} onClick={() => openSettings("ai")} />
          </div>
        </>
      ) : null}

      <div className="menu-group-title">{fr ? "Application" : "App"}</div>
      <div className="menu-group">
        <MenuRow icon={<IconGlobe {...icon} />} label={PAGE_TITLE.app[lang]} detail={`${settings.language === "fr" ? "Français" : "English"} · ${t("install")}`} onClick={() => openSettings("app")} />
      </div>

      <LogoutButton />
      <div className="small muted" style={{ textAlign: "center", margin: "24px 0 8px" }}>
        NOVUS LIVE · {t("ecosystem")}
      </div>
    </>
  );
}

function LogoutButton() {
  const t = useT();
  const [authRequired, setAuthRequired] = useState(false);
  useEffect(() => {
    api
      .authStatus()
      .then((s) => setAuthRequired(s.required))
      .catch(() => undefined);
  }, []);
  if (!authRequired) return null;
  return (
    <button
      className="btn block"
      style={{ marginTop: 20 }}
      onClick={async () => {
        await api.logout();
        location.reload();
      }}
    >
      <IconLogout width={18} height={18} /> {t("logout")}
    </button>
  );
}

function ProfilePage() {
  const lang = useLang();
  const fr = lang === "fr";
  const me = useStore((s) => s.me);
  const isFounder = useIsFounder();
  const id = useIdentity();
  const b = id.billing;
  const [name, setName] = useState(b?.name ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(b?.name ?? ""), [b?.name]);

  const rename = async () => {
    setBusy(true);
    try {
      await billingApi.rename(name.trim());
      await refreshBilling();
      toast(fr ? "Enregistré" : "Saved", "ok");
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "save_failed", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="profile-card">
        <span className="profile-avatar lg">{initials(id.name)}</span>
        <div className="profile-name">{id.name}</div>
        <div className="menu-detail">
          {id.role}
          {id.member && id.workspace ? ` · ${id.workspace}` : ""}
        </div>
        {id.plan ? <span className="state-badge gold" style={{ marginTop: 8 }}>{id.plan.toUpperCase()}</span> : null}
      </div>

      {isFounder ? (
        <div className="card">
          <div className="card-title">{fr ? "Nom de l'espace" : "Workspace name"}</div>
          <div className="row">
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={fr ? "Nom de l'espace" : "Workspace name"} />
            <button className="btn" disabled={busy || name.trim().length < 2 || name.trim() === b?.name} onClick={rename}>
              {fr ? "Enregistrer" : "Save"}
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {fr ? "Le nom de ton agence ou de ta chaîne, affiché dans l'app et sur tes rapports." : "Your agency or channel name, shown in the app and on your reports."}
          </div>
          {b?.email ? (
            <>
              <div className="card-title" style={{ marginTop: 14 }}>
                E-mail
              </div>
              <div>{b.email}</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {fr ? "Sert à récupérer ton code d'accès si tu le perds." : "Used to recover your access code if you lose it."}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {id.member && me ? (
        <div className="card">
          <div className="card-title">{fr ? "Mes autorisations" : "My permissions"}</div>
          {me.permissions.length ? (
            me.permissions.map((p) => (
              <div key={p} className="list-row">
                <span style={{ flex: 1 }}>{PERM_LABEL[p][lang]}</span>
                <span className="small muted">✓</span>
              </div>
            ))
          ) : (
            <div className="small muted">{fr ? "Lecture seule" : "Read only"}</div>
          )}
          <div className="small muted" style={{ marginTop: 8 }}>
            {me.accounts ? `${fr ? "Livers :" : "Streamers:"} ${me.accounts.map((a) => `@${a}`).join(", ")}` : fr ? "Tous les livers de l'agence." : "Every streamer of the agency."}{" "}
            {fr ? "Ces accès sont donnés par le fondateur de l'agence." : "Access is given by the agency founder."}
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">{fr ? "Code d'accès" : "Access code"}</div>
        <div className="small muted">
          {id.member
            ? fr
              ? "Ton code personnel t'a été donné par ton fondateur. S'il est perdu, il peut t'en créer un nouveau dans Réglages › Équipe."
              : "Your personal code was given by your founder. If it's lost, they can create a new one in Settings › Team."
            : b?.ownCode
              ? fr
                ? "C'est le code qui ouvre ton espace. Garde-le pour toi."
                : "This code opens your workspace. Keep it to yourself."
              : fr
                ? "Ton code d'accès est fourni directement par NOVUS LIVE."
                : "Your access code is provided directly by NOVUS LIVE."}
        </div>
        {b?.ownCode ? <ChangeFounderCode /> : null}
      </div>

      <LogoutButton />
    </>
  );
}

function ModerationPage() {
  const t = useT();
  const lang = useLang();
  const settings = useStore((s) => s.settings);
  const ok = t("saved");
  const sensitivityOptions: { value: Sensitivity; label: string }[] = [
    { value: "low", label: t("sensLow").toUpperCase() },
    { value: "balanced", label: t("sensBalanced").toUpperCase() },
    { value: "strict", label: t("sensStrict").toUpperCase() },
    { value: "custom", label: t("custom").toUpperCase() },
  ];
  const presetInfo = settings.sensitivity !== "custom" ? PRESET_THRESHOLDS[settings.sensitivity] : settings.customThresholds;
  return (
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
    </>
  );
}

function ListsPage() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const ok = t("saved");
  return (
    <>
      <ListEditor label={t("bannedPhrases")} items={settings.bannedPhrases} placeholder={t("bannedPlaceholder")} onChange={(v) => save({ bannedPhrases: v }, ok)} />
      <div style={{ height: 12 }} />
      <ListEditor label={t("trustedUsers")} items={settings.trustedUsers} placeholder={t("handlePlaceholder")} onChange={(v) => save({ trustedUsers: v }, ok)} />
      <div style={{ height: 12 }} />
      <ListEditor label={t("watchlist")} items={settings.watchlist} placeholder={t("handlePlaceholder")} onChange={(v) => save({ watchlist: v }, ok)} />
    </>
  );
}

function AIPage() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const ai = useStore((s) => s.ai);
  return (
    <div className="card">
      <div className="row">
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{ai.state === "local_only" ? t("aiLocalTitle") : `${ai.provider} · ${ai.model ?? ""}`}</div>
          <div className="small muted">
            {ai.state === "local_only" ? t("aiLocalHint2") : t("aiReviewHint").replace("{n}", String(ai.analyzed))}
            {ai.lastError ? ` ${t("lastError")} ${ai.lastError}` : ""}
          </div>
        </div>
        {ai.state !== "local_only" ? <Toggle label={t("aiAnalysis")} on={settings.aiEnabled} onChange={(v) => save({ aiEnabled: v }, t("saved"))} /> : null}
      </div>
    </div>
  );
}

function AppPage() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const canSettings = useCan("settings");
  const [streamer, setStreamer] = useState(settings.streamerName);
  return (
    <>
      <div className="section-title" style={{ marginTop: 4 }}>
        {t("language")}
      </div>
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
      </div>
      {canSettings ? (
        <>
          <div className="section-title">{t("streamer")}</div>
          <div className="card">
            <div className="row">
              <input className="input" value={streamer} onChange={(e) => setStreamer(e.target.value)} aria-label={t("streamer")} autoCapitalize="off" autoCorrect="off" maxLength={64} />
              <button className="btn" onClick={() => save({ streamerName: streamer.replace(/^@/, "").trim() || settings.streamerName }, t("saved"))}>
                {t("save")}
              </button>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {t("streamerHint")}
            </div>
          </div>
        </>
      ) : null}
      <div className="section-title">{t("install")}</div>
      <div className="card">
        <div className="small">{t("installHint")}</div>
      </div>
    </>
  );
}

export function SettingsView() {
  const lang = useLang();
  const page = useStore((s) => s.settingsPage);
  const canSettings = useCan("settings");
  const canTeam = useCan("team");
  const isFounder = useIsFounder();
  const teamEnabled = useStore((s) => s.me?.teamEnabled ?? false);
  // A page this person may not open (permissions changed, old link) falls back to the menu.
  const allowed =
    page === null ||
    page === "profile" ||
    page === "tiktok" ||
    page === "app" ||
    (page === "billing" && isFounder) ||
    (page === "team" && teamEnabled && canTeam) ||
    ((page === "moderation" || page === "lists" || page === "ai") && canSettings);
  const shown = allowed ? page : null;

  return (
    <div className="scroll" key={shown ?? "menu"}>
      <div className="narrow">
        {shown ? (
          <>
            <div className="subpage-head">
              <button className="subpage-back" onClick={() => openSettings(null)}>
                <IconBack width={20} height={20} />
                {lang === "fr" ? "Réglages" : "Settings"}
              </button>
              <h2 className="subpage-title">{PAGE_TITLE[shown][lang]}</h2>
            </div>
            {shown === "profile" ? <ProfilePage /> : null}
            {shown === "billing" ? <BillingSection /> : null}
            {shown === "team" ? <TeamSection /> : null}
            {shown === "moderation" ? <ModerationPage /> : null}
            {shown === "lists" ? <ListsPage /> : null}
            {shown === "ai" ? <AIPage /> : null}
            {shown === "tiktok" ? <TikTokIntegration /> : null}
            {shown === "app" ? <AppPage /> : null}
          </>
        ) : (
          <SettingsMenu />
        )}
      </div>
    </div>
  );
}
