import { useMemo, useState } from "react";
import { useCan, useScope } from "../permissions";
import type { TikTokGroup } from "../../shared/types";
import { api, ApiError } from "../api";
import { errorText, useLang } from "../i18n";
import { setState, switchRoom, toast, useStore } from "../store";

const TEXT = {
  en: {
    title: "Followed TikTok accounts",
    live: "LIVE",
    waiting: "WAITING",
    error: "RETRYING",
    open: "Open",
    current: "ON SCREEN",
    add: "Add",
    remove: "Remove",
    confirmRemove: (u: string) =>
      `Stop following @${u}? Its running LIVE session (if any) will be closed.`,
    placeholder: "@handle",
    empty: "No account yet — add the TikTok accounts you moderate.",
    hint: "Novus watches every account at the same time and joins each LIVE automatically. Each account has its own chat, alerts and report — switch with the bar at the top.",
    groups: "Groups",
    groupsHint:
      "Sort your streamers into groups (e.g. agency, friends, VIP). The top bar then shows one group at a time.",
    newGroup: "New group name",
    create: "Create",
    rename: "Rename",
    renamePrompt: "New name for this group:",
    deleteGroup: "Delete group",
    confirmDelete: (g: string) =>
      `Delete the group "${g}"? Its accounts stay followed, just without a group.`,
    noGroup: "No group",
    groupOf: (u: string) => `Group of @${u}`,
    emptyGroup: "Empty — pick this group next to an account below.",
    liveNotRecorded: "LIVE · NOT RECORDED",
    auto: "AUTO",
    manual: "MANUAL",
    modeTitle: (u: string, manual: boolean) =>
      manual
        ? `@${u}: manual — each LIVE is detected, recorded only when you start it. Tap for automatic.`
        : `@${u}: automatic — every LIVE is recorded, app open or not. Tap for manual.`,
    modesHint:
      "AUTO records every LIVE of the account from start to end, even with the app closed. MANUAL only detects the LIVE: you start the recording yourself from the LIVE screen.",
  },
  fr: {
    title: "Comptes TikTok suivis",
    live: "EN LIVE",
    waiting: "EN ATTENTE",
    error: "NOUVEL ESSAI",
    open: "Ouvrir",
    current: "À L'ÉCRAN",
    add: "Ajouter",
    remove: "Retirer",
    confirmRemove: (u: string) =>
      `Ne plus suivre @${u} ? Son LIVE en cours dans Novus (s'il y en a un) sera clôturé.`,
    placeholder: "@pseudo",
    empty: "Aucun compte — ajoute les comptes TikTok que tu modères.",
    hint: "Novus surveille tous les comptes en même temps et rejoint chaque LIVE automatiquement. Chaque compte a son propre chat, ses alertes et son rapport — passe de l'un à l'autre avec la barre en haut.",
    groups: "Groupes",
    groupsHint:
      "Range tes livers dans des groupes (ex. agence, potes, VIP). La barre du haut affiche alors un groupe à la fois.",
    newGroup: "Nom du nouveau groupe",
    create: "Créer",
    rename: "Renommer",
    renamePrompt: "Nouveau nom du groupe :",
    deleteGroup: "Supprimer le groupe",
    confirmDelete: (g: string) =>
      `Supprimer le groupe « ${g} » ? Ses comptes restent suivis, simplement sans groupe.`,
    noGroup: "Sans groupe",
    groupOf: (u: string) => `Groupe de @${u}`,
    emptyGroup: "Vide — choisis ce groupe à côté d'un compte ci-dessous.",
    liveNotRecorded: "EN LIVE · NON ENREGISTRÉ",
    auto: "AUTO",
    manual: "MANUEL",
    modeTitle: (u: string, manual: boolean) =>
      manual
        ? `@${u} : manuel — chaque LIVE est détecté, enregistré seulement quand tu le lances. Touche pour passer en automatique.`
        : `@${u} : automatique — chaque LIVE est enregistré, appli ouverte ou non. Touche pour passer en manuel.`,
    modesHint:
      "AUTO enregistre chaque LIVE du compte du début à la fin, même appli fermée. MANUEL détecte seulement le LIVE : tu lances l'enregistrement toi-même depuis l'écran du LIVE.",
  },
};

const NO_PROFILES: string[] = [];
const NO_GROUPS: TikTokGroup[] = [];
const NO_MANUAL: string[] = [];
const clean = (s: string) => s.trim().replace(/^@/, "");
const valid = (s: string) => /^[A-Za-z0-9._]{2,64}$/.test(s);
const newId = () =>
  `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Profile manager (Settings › TikTok Integration): add / open / remove followed accounts, sorted into groups. */
export function TikTokProfiles() {
  const lang = useLang();
  const tx = TEXT[lang];
  const allProfiles = useStore((s) => s.settings.tiktokProfiles) ?? NO_PROFILES;
  const scope = useScope();
  const canManage = useCan("manage_accounts");
  // Adding/removing streamers and groups needs every streamer; a limited member only switches modes.
  const fullControl = canManage && !scope;
  const profiles = useMemo(
    () =>
      scope
        ? allProfiles.filter((p) => scope.includes(p.toLowerCase()))
        : allProfiles,
    [allProfiles, scope],
  );
  const groups = useStore((s) => s.settings.tiktokGroups) ?? NO_GROUPS;
  const manualList = useStore((s) => s.settings.tiktokManual) ?? NO_MANUAL;
  const rooms = useStore((s) => s.rooms);
  const current = useStore((s) => s.room);
  const [draft, setDraft] = useState("");
  const [groupDraft, setGroupDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(
        errorText(e instanceof ApiError ? e.code : "internal_error", lang),
        "warn",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveGroups = (next: TikTokGroup[]) =>
    run(async () => {
      setState({ settings: await api.saveSettings({ tiktokGroups: next }) });
    });

  const add = () =>
    run(async () => {
      const name = clean(draft);
      if (!valid(name)) return;
      setDraft("");
      const res = await api.tiktokConnect(name);
      setState({
        settings: await api.settings(),
        rooms: (await api.rooms()).rooms,
      });
      toast(`@${name}`, "ok");
      if (res.room !== current) switchRoom(res.room);
    });

  const remove = (name: string) => {
    if (!window.confirm(tx.confirmRemove(name))) return;
    void run(async () => {
      const next = profiles.filter(
        (p) => p.toLowerCase() !== name.toLowerCase(),
      );
      setState({
        settings: await api.saveSettings({ tiktokProfiles: next }),
        rooms: (await api.rooms()).rooms,
      });
      if (current === `tt:${name.toLowerCase()}`) switchRoom("main");
    });
  };

  const createGroup = () => {
    const name = groupDraft.trim().slice(0, 40);
    if (!name) return;
    setGroupDraft("");
    void saveGroups([...groups, { id: newId(), name, members: [] }]);
  };

  const renameGroup = (g: TikTokGroup) => {
    const name = window.prompt(tx.renamePrompt, g.name)?.trim().slice(0, 40);
    if (!name || name === g.name) return;
    void saveGroups(groups.map((x) => (x.id === g.id ? { ...x, name } : x)));
  };

  const deleteGroup = (g: TikTokGroup) => {
    if (!window.confirm(tx.confirmDelete(g.name))) return;
    void saveGroups(groups.filter((x) => x.id !== g.id));
  };

  /** Move an account into a group ("" = no group). */
  const moveTo = (username: string, groupId: string) => {
    const u = username.toLowerCase();
    void saveGroups(
      groups.map((g) => ({
        ...g,
        members:
          g.id === groupId
            ? [...g.members.filter((m) => m !== u), u]
            : g.members.filter((m) => m !== u),
      })),
    );
  };

  const isManual = (username: string) =>
    manualList.includes(username.toLowerCase());
  const toggleMode = (username: string) =>
    run(async () => {
      const u = username.toLowerCase();
      const next = isManual(u)
        ? manualList.filter((x) => x !== u)
        : [...manualList, u];
      setState({
        settings: await api.saveSettings({ tiktokManual: next }),
        rooms: (await api.rooms()).rooms,
      });
    });

  const groupOf = (username: string) =>
    groups.find((g) => g.members.includes(username.toLowerCase()))?.id ?? "";

  const row = (p: string) => {
    const id = `tt:${p.toLowerCase()}`;
    const room = rooms.find((r) => r.id === id);
    const badge = room?.live
      ? { cls: "bad", text: tx.live }
      : room?.detected
        ? { cls: "bad", text: tx.liveNotRecorded }
        : room?.state === "ERROR"
          ? { cls: "bad", text: tx.error }
          : { cls: "gold", text: tx.waiting };
    const manual = isManual(p);
    return (
      <div key={p} className="list-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            @{p}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <span
              className={`state-badge ${badge.cls}`}
              style={{ fontSize: 10, whiteSpace: "nowrap", flex: "none" }}
            >
              {badge.text}
            </span>
            <button
              className={`mode-toggle ${manual ? "manual" : ""}`}
              onClick={() => void toggleMode(p)}
              disabled={busy || !canManage}
              title={tx.modeTitle(p, manual)}
              aria-label={tx.modeTitle(p, manual)}
            >
              {manual ? `✋ ${tx.manual}` : `⟳ ${tx.auto}`}
            </button>
            {groups.length && fullControl ? (
              <select
                className="group-select"
                value={groupOf(p)}
                onChange={(e) => moveTo(p, e.target.value)}
                disabled={busy}
                aria-label={tx.groupOf(p)}
              >
                <option value="">{tx.noGroup}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
        {id === current ? (
          <span className="small muted">{tx.current}</span>
        ) : (
          <button
            className="btn sm gold"
            disabled={busy || !room}
            onClick={() => switchRoom(id)}
          >
            {tx.open}
          </button>
        )}
        {fullControl ? (
          <button
            className="btn sm ghost"
            disabled={busy}
            onClick={() => remove(p)}
            aria-label={`${tx.remove} @${p}`}
            title={tx.remove}
          >
            ✕
          </button>
        ) : null}
      </div>
    );
  };

  // Accounts listed under their group, then the ones without a group.
  const byGroup = groups
    .map((g) => ({
      g,
      list: profiles.filter((p) => g.members.includes(p.toLowerCase())),
    }))
    .filter((x) => fullControl || x.list.length);
  const loose = profiles.filter((p) => !groupOf(p));

  return (
    <>
      <div className="card-title" style={{ marginTop: 14 }}>
        {tx.title}
      </div>
      {profiles.length === 0 ? (
        <div className="small muted">{tx.empty}</div>
      ) : null}
      {byGroup.map(({ g, list }) => (
        <div key={g.id} className="group-block">
          <div className="group-head">
            <span className="group-name">{g.name}</span>
            <span className="small muted">{list.length}</span>
            <span className="spacer" />
            {fullControl ? (
              <>
                <button
                  className="btn sm ghost"
                  onClick={() => renameGroup(g)}
                  disabled={busy}
                  title={tx.rename}
                  aria-label={`${tx.rename} ${g.name}`}
                >
                  ✎
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => deleteGroup(g)}
                  disabled={busy}
                  title={tx.deleteGroup}
                  aria-label={`${tx.deleteGroup} ${g.name}`}
                >
                  ✕
                </button>
              </>
            ) : null}
          </div>
          {list.length ? (
            list.map(row)
          ) : (
            <div className="small muted" style={{ padding: "4px 0 8px" }}>
              {tx.emptyGroup}
            </div>
          )}
        </div>
      ))}
      {groups.length && loose.length ? (
        <div className="group-head">
          <span className="group-name muted">{tx.noGroup}</span>
          <span className="small muted">{loose.length}</span>
        </div>
      ) : null}
      {loose.map(row)}
      {fullControl ? (
        <div className="row" style={{ marginTop: 10 }}>
          <input
            className="input"
            placeholder={tx.placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            aria-label="TikTok username"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button
            className="btn"
            onClick={add}
            disabled={busy || !valid(clean(draft))}
          >
            + {tx.add}
          </button>
        </div>
      ) : null}
      <div className="small muted" style={{ marginTop: 6 }}>
        {tx.hint}
        <br />
        {tx.modesHint}
      </div>

      {fullControl ? (
        <>
          <div className="card-title" style={{ marginTop: 14 }}>
            {tx.groups}
          </div>
          <div className="row">
            <input
              className="input"
              placeholder={tx.newGroup}
              value={groupDraft}
              maxLength={40}
              onChange={(e) => setGroupDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createGroup();
              }}
              aria-label={tx.newGroup}
            />
            <button
              className="btn"
              onClick={createGroup}
              disabled={busy || !groupDraft.trim() || groups.length >= 30}
            >
              + {tx.create}
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {tx.groupsHint}
          </div>
        </>
      ) : null}
    </>
  );
}
