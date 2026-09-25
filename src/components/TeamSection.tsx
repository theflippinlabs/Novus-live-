import { useEffect, useState } from "react";
import { PERMISSIONS, type Permission, type TeamMember, type TeamRole } from "../../shared/types";
import { api, ApiError, type MemberDraft } from "../api";
import { errorText, useLang } from "../i18n";
import { toast, useStore } from "../store";

const PERM_LABEL: Record<Permission, { en: string; fr: string; hintEn: string; hintFr: string }> = {
  moderate: { en: "Moderate", fr: "Modérer", hintEn: "Act on alerts and viewers (warn, mute…)", hintFr: "Agir sur les alertes et les spectateurs (avertir, mute…)" },
  send_chat: { en: "Send in chat", fr: "Envoyer dans le chat", hintEn: "Post suggested warnings with the connected TikTok account", hintFr: "Publier les avertissements avec le compte TikTok connecté" },
  manage_accounts: { en: "Manage streamers", fr: "Gérer les livers", hintEn: "Follow/unfollow, groups, auto/manual, recording", hintFr: "Suivre/retirer, groupes, auto/manuel, enregistrement" },
  settings: { en: "Moderation settings", fr: "Réglages de modération", hintEn: "Sensitivity, banned words, trusted users, AI", hintFr: "Sensibilité, mots interdits, utilisateurs de confiance, IA" },
  history: { en: "History & exports", fr: "Historique & exports", hintEn: "Past LIVEs, PDF reports, conversations", hintFr: "LIVE passés, rapports PDF, conversations" },
  team: { en: "Manage the team", fr: "Gérer l'équipe", hintEn: "Add members (never with more rights than their own)", hintFr: "Ajouter des membres (jamais avec plus de droits que les siens)" },
};

const ROLE_LABEL: Record<TeamRole, { en: string; fr: string }> = {
  director: { en: "Director", fr: "Directeur" },
  manager: { en: "Manager", fr: "Manager" },
  moderator: { en: "Moderator", fr: "Modérateur" },
};

const ROLE_PRESET: Record<TeamRole, Permission[]> = {
  director: ["moderate", "send_chat", "manage_accounts", "settings", "history", "team"],
  manager: ["moderate", "send_chat", "manage_accounts", "history"],
  moderator: ["moderate"],
};

const TX = {
  en: {
    intro: "Give your directors, managers and moderators their own access code. You choose what each one can do and which streamers they see. You (the founder) keep every right.",
    add: "Add a member",
    name: "Name",
    role: "Role",
    rights: "Permissions",
    streamers: "Streamers",
    allStreamers: "All streamers",
    someStreamers: "Only these streamers:",
    create: "Create the access",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    newCode: "New code",
    disable: "Suspend",
    enable: "Reactivate",
    remove: "Remove",
    suspended: "SUSPENDED",
    codeFor: (n: string) => `Access code for ${n} — give it to them now, it will not be shown again:`,
    copy: "Copy",
    copied: "Copied",
    done: "Done",
    confirmRemove: (n: string) => `Remove ${n} from the team? Their access stops immediately.`,
    confirmCode: (n: string) => `Create a new code for ${n}? The old code stops working and they are logged out.`,
    none: "No member yet.",
    noStreamer: "Follow streamers first (above) to limit a member to some of them.",
  },
  fr: {
    intro: "Donne à tes directeurs, managers et modérateurs leur propre code d'accès. Tu choisis ce que chacun peut faire et quels livers il voit. Toi (le fondateur), tu gardes tous les droits.",
    add: "Ajouter un membre",
    name: "Nom",
    role: "Rôle",
    rights: "Autorisations",
    streamers: "Livers",
    allStreamers: "Tous les livers",
    someStreamers: "Seulement ces livers :",
    create: "Créer l'accès",
    save: "Enregistrer",
    cancel: "Annuler",
    edit: "Modifier",
    newCode: "Nouveau code",
    disable: "Suspendre",
    enable: "Réactiver",
    remove: "Retirer",
    suspended: "SUSPENDU",
    codeFor: (n: string) => `Code d'accès de ${n} — donne-le-lui maintenant, il ne sera plus affiché :`,
    copy: "Copier",
    copied: "Copié",
    done: "OK",
    confirmRemove: (n: string) => `Retirer ${n} de l'équipe ? Son accès s'arrête immédiatement.`,
    confirmCode: (n: string) => `Créer un nouveau code pour ${n} ? L'ancien code ne marche plus et il est déconnecté.`,
    none: "Aucun membre pour l'instant.",
    noStreamer: "Suis d'abord des livers (plus haut) pour limiter un membre à certains d'entre eux.",
  },
};

const NO_PROFILES: string[] = [];

function MemberForm({ initial, onSubmit, onCancel, submitLabel }: { initial: MemberDraft; onSubmit: (d: MemberDraft) => Promise<void>; onCancel?: () => void; submitLabel: string }) {
  const lang = useLang();
  const tx = TX[lang];
  const me = useStore((s) => s.me);
  const profiles = useStore((s) => s.settings.tiktokProfiles) ?? NO_PROFILES;
  const [d, setD] = useState<MemberDraft>(initial);
  const [busy, setBusy] = useState(false);
  // A delegating member can only hand out what they have.
  const grantable = PERMISSIONS.filter((p) => !me || me.permissions.includes(p));
  const myScope = me?.accounts ?? null;
  const pickable = (myScope ?? profiles.map((p) => p.toLowerCase())).slice().sort();

  const setRole = (role: TeamRole) => setD({ ...d, role, permissions: ROLE_PRESET[role].filter((p) => grantable.includes(p)) });
  const togglePerm = (p: Permission) => setD({ ...d, permissions: d.permissions.includes(p) ? d.permissions.filter((x) => x !== p) : [...d.permissions, p] });
  const toggleAccount = (u: string) => {
    const list = d.accounts ?? [];
    setD({ ...d, accounts: list.includes(u) ? list.filter((x) => x !== u) : [...list, u] });
  };

  const submit = async () => {
    if (!d.name.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ ...d, name: d.name.trim() });
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="team-form">
      <label className="small muted">{tx.name}</label>
      <input className="input" value={d.name} maxLength={40} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label={tx.name} />
      <label className="small muted">{tx.role}</label>
      <div className="chips">
        {(Object.keys(ROLE_LABEL) as TeamRole[]).map((r) => (
          <button key={r} className={`chip ${d.role === r ? "on" : ""}`} onClick={() => setRole(r)} aria-pressed={d.role === r}>
            {ROLE_LABEL[r][lang]}
          </button>
        ))}
      </div>
      <label className="small muted">{tx.rights}</label>
      {grantable.map((p) => (
        <label key={p} className="check-row">
          <input type="checkbox" checked={d.permissions.includes(p)} onChange={() => togglePerm(p)} />
          <span>
            <b>{PERM_LABEL[p][lang]}</b>
            <span className="small muted"> — {lang === "fr" ? PERM_LABEL[p].hintFr : PERM_LABEL[p].hintEn}</span>
          </span>
        </label>
      ))}
      <label className="small muted">{tx.streamers}</label>
      {!myScope ? (
        <label className="check-row">
          <input type="checkbox" checked={d.accounts === null} onChange={() => setD({ ...d, accounts: d.accounts === null ? [] : null })} />
          <span>{tx.allStreamers}</span>
        </label>
      ) : null}
      {d.accounts !== null ? (
        pickable.length ? (
          <>
            <div className="small muted">{tx.someStreamers}</div>
            <div className="chips">
              {pickable.map((u) => (
                <button key={u} className={`chip ${d.accounts?.includes(u) ? "on" : ""}`} onClick={() => toggleAccount(u)} aria-pressed={d.accounts?.includes(u)}>
                  @{u}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="small muted">{tx.noStreamer}</div>
        )
      ) : null}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn gold" onClick={submit} disabled={busy || !d.name.trim()}>
          {busy ? "…" : submitLabel}
        </button>
        {onCancel ? (
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            {tx.cancel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Settings › Team: the founder (or a delegated director) manages members and their rights. */
export function TeamSection() {
  const lang = useLang();
  const tx = TX[lang];
  const me = useStore((s) => s.me);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [shown, setShown] = useState<{ name: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    api
      .team()
      .then((r) => setMembers(r.members))
      .catch((e) => {
        setMembers([]);
        if (e instanceof ApiError && e.code !== "forbidden") toast(errorText(e.code, lang), "warn");
      });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    }
  };

  const scopeText = (m: TeamMember) => (m.accounts === null ? tx.allStreamers : m.accounts.length ? m.accounts.map((a) => `@${a}`).join(", ") : "—");
  const blank: MemberDraft = { name: "", role: "moderator", permissions: ROLE_PRESET.moderator, accounts: me?.accounts ? [] : null };

  return (
    <div className="card">
      <div className="small muted" style={{ marginBottom: 10 }}>
        {tx.intro}
      </div>

      {shown ? (
        <div className="code-box" role="status">
          <div className="small">{tx.codeFor(shown.name)}</div>
          <div className="code">{shown.code}</div>
          <div className="row">
            <button
              className="btn sm gold"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shown.code);
                  setCopied(true);
                } catch {
                  /* select by hand */
                }
              }}
            >
              {copied ? tx.copied : tx.copy}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                setShown(null);
                setCopied(false);
              }}
            >
              {tx.done}
            </button>
          </div>
        </div>
      ) : null}

      {members === null ? <div className="small muted">…</div> : members.length === 0 ? <div className="small muted">{tx.none}</div> : null}
      {members?.map((m) =>
        editing === m.id ? (
          <MemberForm
            key={m.id}
            initial={{ name: m.name, role: m.role, permissions: m.permissions, accounts: m.accounts }}
            submitLabel={tx.save}
            onCancel={() => setEditing(null)}
            onSubmit={async (d) => {
              await api.updateMember(m.id, d);
              setEditing(null);
              await load();
            }}
          />
        ) : (
          <div key={m.id} className="member-row">
            <div className="row" style={{ gap: 8 }}>
              <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</b>
              <span className="state-badge gold" style={{ fontSize: 10 }}>
                {ROLE_LABEL[m.role][lang].toUpperCase()}
              </span>
              {m.disabled ? (
                <span className="state-badge bad" style={{ fontSize: 10 }}>
                  {tx.suspended}
                </span>
              ) : null}
            </div>
            <div className="chips" style={{ marginTop: 6 }}>
              {m.permissions.map((p) => (
                <span key={p} className="chip on" style={{ fontSize: 10.5 }}>
                  {PERM_LABEL[p][lang]}
                </span>
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {tx.streamers} : {scopeText(m)}
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              <button className="btn sm" onClick={() => setEditing(m.id)}>
                {tx.edit}
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  if (!window.confirm(tx.confirmCode(m.name))) return;
                  void act(async () => {
                    const r = await api.newMemberCode(m.id);
                    setShown({ name: m.name, code: r.code });
                  });
                }}
              >
                {tx.newCode}
              </button>
              <button className="btn sm ghost" onClick={() => void act(async () => void (await api.updateMember(m.id, { disabled: !m.disabled })))}>
                {m.disabled ? tx.enable : tx.disable}
              </button>
              <button
                className="btn sm ghost"
                onClick={() => {
                  if (!window.confirm(tx.confirmRemove(m.name))) return;
                  void act(async () => void (await api.removeMember(m.id)));
                }}
              >
                {tx.remove}
              </button>
            </div>
          </div>
        ),
      )}

      {adding ? (
        <MemberForm
          initial={blank}
          submitLabel={tx.create}
          onCancel={() => setAdding(false)}
          onSubmit={async (d) => {
            const r = await api.addMember(d);
            setAdding(false);
            setShown({ name: r.member.name, code: r.code });
            await load();
          }}
        />
      ) : (
        <button className="btn gold block" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
          + {tx.add}
        </button>
      )}
    </div>
  );
}
