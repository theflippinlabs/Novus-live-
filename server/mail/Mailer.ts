/*
 * Transactional e-mail (founder code recovery) through Resend's HTTP API.
 * Disabled unless RESEND_API_KEY and MAIL_FROM are set: callers must check `enabled`.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  readonly enabled: boolean;
  send(msg: MailMessage): Promise<void>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class ResendMailer implements Mailer {
  readonly enabled: boolean;

  constructor(
    private readonly opts: { apiKey?: string; from?: string },
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {
    this.enabled = Boolean(opts.apiKey && opts.from);
  }

  async send(msg: MailMessage): Promise<void> {
    if (!this.enabled) throw new Error("mail_disabled");
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.opts.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
