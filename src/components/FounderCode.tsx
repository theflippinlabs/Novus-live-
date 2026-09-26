import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { billingApi, refreshBilling } from "../billing";
import { errorText, useLang } from "../i18n";
import { toast } from "../store";
import { BrandLogo, Sheet } from "./ui";
import { LangToggle } from "./LangToggle";

// Founder access code: lost-code recovery (login screen, e-mailed link) and changing it.

const TX = {
  en: {
    lost: "Lost your code?",
    lostTitle: "Recover your access",
    lostHint: "Enter the e-mail used to create your workspace. We'll send a link that gives you a new code (valid 30 minutes).",
    email: "E-mail",
    send: "Send the link",
    sent: "If a workspace uses this e-mail, a link is on its way. Check your inbox (and spam) — it's valid for 30 minutes.",
    manual: (s: string | null) =>
      s ? `E-mail recovery isn't available yet. Write to ${s} from the e-mail of your workspace: we'll check it's you and give you a new code.` : "E-mail recovery isn't available yet. Contact NOVUS LIVE from the e-mail of your workspace: we'll check it's you and give you a new code.",
    team: "Team member? Ask your founder: they can give you a new code from Settings › Team.",
    newCode: "Your new access code",
    newCodeHint: "Keep it somewhere safe: it's shown only once. Your old code no longer works.",
    copy: "Copy",
    copied: "Copied ✓",
    open: "Open NOVUS LIVE",
    working: "Creating your new code…",
    invalid: "This link has expired or was already used. Ask for a new one from the login screen.",
    backLogin: "Back to login",
    change: "Change my access code",
    changeHint: "Creates a new code. Every other device using the old code is logged out; this one stays connected.",
    confirm: "Create a new code?",
    yes: "Yes, new code",
    cancel: "Cancel",
    done: "Done",
  },
  fr: {
    lost: "Code perdu ?",
    lostTitle: "Récupérer ton accès",
    lostHint: "Saisis l'e-mail utilisé à la création de ton espace. On t'envoie un lien qui te donne un nouveau code (valable 30 minutes).",
    email: "E-mail",
    send: "Envoyer le lien",
    sent: "Si un espace utilise cet e-mail, un lien est en route. Regarde ta boîte de réception (et les spams) — il est valable 30 minutes.",
    manual: (s: string | null) =>
      s
        ? `La récupération par e-mail n'est pas encore disponible. Écris à ${s} depuis l'e-mail de ton espace : on vérifie que c'est bien toi et on te donne un nouveau code.`
        : "La récupération par e-mail n'est pas encore disponible. Contacte NOVUS LIVE depuis l'e-mail de ton espace : on vérifie que c'est bien toi et on te donne un nouveau code.",
    team: "Membre d'une équipe ? Demande à ton fondateur : il peut te donner un nouveau code dans Réglages › Équipe.",
    newCode: "Ton nouveau code d'accès",
    newCodeHint: "Garde-le en lieu sûr : il n'est affiché qu'une fois. L'ancien code ne fonctionne plus.",
    copy: "Copier",
    copied: "Copié ✓",
    open: "Ouvrir NOVUS LIVE",
    working: "Création de ton nouveau code…",
    invalid: "Ce lien a expiré ou a déjà servi. Redemande-en un depuis l'écran de connexion.",
    backLogin: "Retour à la connexion",
    change: "Changer mon code d'accès",
    changeHint: "Crée un nouveau code. Les autres appareils qui utilisent l'ancien sont déconnectés ; celui-ci reste connecté.",
    confirm: "Créer un nouveau code ?",
    yes: "Oui, nouveau code",
    cancel: "Annuler",
    done: "Terminé",
  },
};

/** A code shown once, with a copy button. */
export function CodeReveal({ code, title, hint, onDone }: { code: string; title: string; hint?: string; onDone?: () => void }) {
  const tx = TX[useLang()];
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-box" role="status">
      <div className="small">{title}</div>
      <div className="code">{code}</div>
      {hint ? <div className="small muted">{hint}</div> : null}
      <div className="row">
        <button
          className="btn sm gold"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              /* select by hand */
            }
          }}
        >
          {copied ? tx.copied : tx.copy}
        </button>
        {onDone ? (
          <button className="btn sm ghost" onClick={onDone}>
            {tx.done}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** "Lost your code?" on the login screen. */
export function LostCodeLink() {
  const lang = useLang();
  const tx = TX[lang];
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ email: boolean; support: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setResult(null);
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await billingApi.recover(email, lang));
    } catch (e) {
      // The login screen has no toast area: show it in the sheet.
      setError(errorText(e instanceof ApiError ? (e.status === 429 ? "rate_limited" : e.code) : "internal_error", lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="link-btn" style={{ display: "block", margin: "14px auto 0" }} onClick={() => setOpen(true)}>
        {tx.lost}
      </button>
      {open ? (
        <Sheet onClose={close} label={tx.lostTitle}>
          <div className="card-title">{tx.lostTitle}</div>
          {result ? (
            <p className="small">{result.email ? tx.sent : tx.manual(result.support)}</p>
          ) : (
            <>
              <p className="small muted">{tx.lostHint}</p>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={tx.email}
                aria-label={tx.email}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && /\S+@\S+\.\S+/.test(email) && !busy && send()}
              />
              {error ? (
                <div className="small" style={{ color: "#ff8b98", marginTop: 8 }}>
                  {error}
                </div>
              ) : null}
              <button className="btn gold block" style={{ marginTop: 12 }} disabled={busy || !/\S+@\S+\.\S+/.test(email)} onClick={send}>
                {busy ? "…" : tx.send}
              </button>
            </>
          )}
          <p className="small muted" style={{ marginTop: 14 }}>
            {tx.team}
          </p>
        </Sheet>
      ) : null}
    </>
  );
}

/** /recover#<token>: the e-mailed link. Gives a new code and logs in. */
export function RecoverPage() {
  const tx = TX[useLang()];
  const [state, setStateLocal] = useState<{ code: string; name: string } | "working" | "invalid">("working");
  useEffect(() => {
    const token = location.hash.slice(1);
    // The token leaves the address bar (and history) right away.
    history.replaceState(null, "", "/recover");
    if (!token) return setStateLocal("invalid");
    billingApi.recoverComplete(token).then(setStateLocal, () => setStateLocal("invalid"));
  }, []);
  return (
    <div className="login">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <LangToggle />
      </div>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <BrandLogo />
      </div>
      <div className="card">
        {state === "working" ? <p className="small muted">{tx.working}</p> : null}
        {state === "invalid" ? (
          <>
            <p className="small">{tx.invalid}</p>
            <a className="btn block" href="/">
              {tx.backLogin}
            </a>
          </>
        ) : null}
        {typeof state === "object" ? (
          <>
            <div className="card-title">{state.name}</div>
            <CodeReveal code={state.code} title={tx.newCode} hint={tx.newCodeHint} />
            <a className="btn gold block" style={{ marginTop: 12 }} href="/">
              {tx.open}
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Settings › Subscription: the founder of a self-serve workspace changes their code. */
export function ChangeFounderCode() {
  const lang = useLang();
  const tx = TX[lang];
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [code, setCode] = useState<string | null>(null);
  const run = async () => {
    setStep("busy");
    try {
      setCode((await billingApi.changeFounderCode()).code);
      void refreshBilling();
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "internal_error", lang), "warn");
    } finally {
      setStep("idle");
    }
  };
  if (code) return <CodeReveal code={code} title={tx.newCode} hint={tx.newCodeHint} onDone={() => setCode(null)} />;
  return (
    <div style={{ marginTop: 14 }}>
      {step === "idle" ? (
        <button className="link-btn" onClick={() => setStep("confirm")}>
          {tx.change}
        </button>
      ) : (
        <div className="code-box">
          <div className="small">
            <b>{tx.confirm}</b> {tx.changeHint}
          </div>
          <div className="row">
            <button className="btn sm gold" disabled={step === "busy"} onClick={run}>
              {step === "busy" ? "…" : tx.yes}
            </button>
            <button className="btn sm ghost" disabled={step === "busy"} onClick={() => setStep("idle")}>
              {tx.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
