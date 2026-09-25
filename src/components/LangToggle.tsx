import { setLanguage, useLang } from "../i18n";

export function LangToggle({ className = "" }: { className?: string }) {
  const lang = useLang();
  return (
    <div className={`lang-toggle ${className}`} role="radiogroup" aria-label={lang === "fr" ? "Langue" : "Language"}>
      {(["en", "fr"] as const).map((l) => (
        <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? "on" : ""} onClick={() => void setLanguage(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
