import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";

/*
 * Native iPhone notifications (the App Store app): Apple Push Notification service, token-based
 * (a .p8 key from the Apple Developer account, server-side only). Devices of the native app are
 * stored like web-push ones, with the endpoint "apns:<device token>".
 */

export const APNS_PREFIX = "apns:";

export interface ApnsConfig {
  /** Key ID of the APNs key (10 characters). */
  keyId: string;
  /** Apple Developer Team ID (10 characters). */
  teamId: string;
  /** The .p8 key: PEM text, or the same in base64. */
  key: string;
  /** The app's bundle identifier (the APNs "topic"). */
  bundleId: string;
  /** Development (Xcode builds) instead of production (TestFlight / App Store). */
  sandbox?: boolean;
}

export interface ApnsMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  urgent: boolean;
  ttlSeconds: number;
}

/** "sent", or why not: "gone" (forget this device) or "failed". */
export type ApnsResult = "sent" | "gone" | "failed";

export function readP8(key: string): KeyObject {
  const text = key.includes("BEGIN PRIVATE KEY") ? key : Buffer.from(key, "base64").toString("utf8");
  return createPrivateKey(text.replace(/\\n/g, "\n"));
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** The provider token: a JWT signed with the .p8 key (ES256), valid up to an hour; renewed every 50 min. */
export function providerToken(cfg: Pick<ApnsConfig, "keyId" | "teamId">, key: KeyObject, nowSec: number): string {
  const head = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: nowSec }));
  const signature = sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${claims}.${b64url(signature)}`;
}

export function apnsPayload(msg: ApnsMessage): string {
  return JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default", "thread-id": msg.tag.slice(0, 64) }, url: msg.url });
}

export class ApnsSender {
  private key: KeyObject;
  private token: { value: string; at: number } | null = null;
  private session: ClientHttp2Session | null = null;

  constructor(
    private cfg: ApnsConfig,
    private log?: (m: string) => void,
  ) {
    this.key = readP8(cfg.key);
  }

  private bearer(): string {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || now - this.token.at > 50 * 60) this.token = { value: providerToken(this.cfg, this.key, now), at: now };
    return this.token.value;
  }

  private connection(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const s = connect(this.cfg.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
    s.on("error", () => undefined);
    s.on("goaway", () => s.close());
    // Close when idle so the server does not keep a socket open between LIVEs.
    s.setTimeout(5 * 60_000, () => s.close());
    this.session = s;
    return s;
  }

  async send(deviceToken: string, msg: ApnsMessage): Promise<ApnsResult> {
    if (!/^[0-9a-f]{32,200}$/i.test(deviceToken)) return "gone";
    const body = apnsPayload(msg);
    return new Promise<ApnsResult>((resolve) => {
      let req;
      try {
        req = this.connection().request({
          [constants.HTTP2_HEADER_METHOD]: "POST",
          [constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
          authorization: `bearer ${this.bearer()}`,
          "apns-topic": this.cfg.bundleId,
          "apns-push-type": "alert",
          "apns-priority": msg.urgent ? "10" : "5",
          "apns-expiration": String(Math.floor(Date.now() / 1000) + msg.ttlSeconds),
          "apns-collapse-id": msg.tag.slice(0, 64),
          "content-type": "application/json",
        });
      } catch {
        resolve("failed");
        return;
      }
      let status = 0;
      let reply = "";
      req.setTimeout(10_000, () => req.close());
      req.on("response", (h) => (status = Number(h[constants.HTTP2_HEADER_STATUS]) || 0));
      req.on("data", (c: Buffer) => (reply += c.toString()));
      req.on("error", () => resolve("failed"));
      req.on("close", () => {
        if (status === 200) return resolve("sent");
        const reason = /"reason"\s*:\s*"([^"]+)"/.exec(reply)?.[1] ?? "";
        // The app was removed or the token is not for this app: forget the device.
        if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic") return resolve("gone");
        this.log?.(`[push] APNs ${status || "network"} ${reason}`.trim());
        resolve("failed");
      });
      req.end(body);
    });
  }
}
