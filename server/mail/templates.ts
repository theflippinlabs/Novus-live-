/** Lost founder code: the one-time link (valid 30 minutes). */
export function recoveryMail({ lang, workspace, link }: { lang: "fr" | "en"; workspace: string; link: string }) {
  const fr = lang === "fr";
  const subject = fr ? "NOVUS LIVE — nouveau code d'accès" : "NOVUS LIVE — new access code";
  const lines = fr
    ? [
        `Une demande de nouveau code d'accès a été faite pour l'espace « ${workspace} ».`,
        "Ouvre ce lien dans les 30 minutes pour recevoir ton nouveau code. L'ancien code cessera de fonctionner.",
        "Si ce n'est pas toi, ignore cet e-mail : ton code actuel reste valable.",
      ]
    : [
        `Someone asked for a new access code for the workspace "${workspace}".`,
        "Open this link within 30 minutes to get your new code. The old code will stop working.",
        "If this wasn't you, ignore this e-mail: your current code keeps working.",
      ];
  const button = fr ? "Obtenir mon nouveau code" : "Get my new code";
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<div style="background:#0b0b0d;padding:32px 20px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#ece6da">
<div style="max-width:480px;margin:0 auto">
<div style="letter-spacing:.3em;font-weight:700;color:#d4b483;margin-bottom:24px">NOVUS LIVE</div>
<p style="line-height:1.5">${esc(lines[0])}</p>
<p style="line-height:1.5">${esc(lines[1])}</p>
<p style="margin:28px 0"><a href="${esc(link)}" style="background:#d4b483;color:#141210;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">${esc(button)}</a></p>
<p style="line-height:1.5;color:#9a9285;font-size:13px">${esc(lines[2])}</p>
</div></div>`;
  const text = `${lines[0]}\n\n${lines[1]}\n${link}\n\n${lines[2]}\n`;
  return { subject, html, text };
}
