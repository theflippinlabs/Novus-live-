import webpush from "web-push";
import type { Repository } from "../persistence/Repository";

/*
 * Web Push (iPhone home-screen app since iOS 16.4, Android, desktop): a LIVE starting,
 * critical alerts and the end-of-LIVE summary, sent to the devices that turned them on.
 * The VAPID keys are generated once and kept server-side; subscriptions are stored per space.
 */

export type PushKind = "live" | "alerts" | "summary";
export interface PushPrefs {
  live: boolean;
  alerts: boolean;
  summary: boolean;
}
export const DEFAULT_PREFS: PushPrefs = { live: true, alerts: true, summary: true };

/** Who owns a device: the space founder or one team member. */
export type PushOwner = { kind: "founder" } | { kind: "member"; id: string };

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  owner: PushOwner;
  prefs: PushPrefs;
  createdAt: number;
}

export interface PushMessage {
  kind: PushKind;
  /** TikTok account concerned (members only get their own streamers). */
  account?: string;
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** Same tag = replaces the previous notification instead of piling up. */
  tag: string;
}

/** Decides whether a device's owner may receive a message (permissions, streamer scope). */
export type Audience = (spaceId: string, owner: PushOwner, msg: PushMessage) => boolean;

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: webpush.RequestOptions) => Promise<unknown>;

const SUBS = "push_subscriptions";
const VAPID = "push_vapid";
const MAX_PER_SPACE = 200;

export class PushService {
  private vapid: { publicKey: string; privateKey: string } | null = null;
  private subs = new Map<string, StoredSubscription[]>();
  private audience: Audience = () => true;

  constructor(
    private deps: {
      /** Server-level secret storage (the owner's), for the VAPID keys. */
      serverRepo: Pick<Repository, "loadSecret" | "saveSecret">;
      /** A space's own storage, for its devices. */
      spaceRepo: (spaceId: string) => Pick<Repository, "loadSecret" | "saveSecret">;
      subject: string;
      send?: Sender;
      log?: (m: string) => void;
    },
  ) {}

  async init(): Promise<void> {
    const saved = (await this.deps.serverRepo.loadSecret(VAPID).catch(() => null)) as { publicKey?: string; privateKey?: string } | null;
    if (saved?.publicKey && saved.privateKey) this.vapid = { publicKey: saved.publicKey, privateKey: saved.privateKey };
    else {
      this.vapid = webpush.generateVAPIDKeys();
      await this.deps.serverRepo.saveSecret(VAPID, this.vapid);
    }
  }

  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  setAudience(fn: Audience): void {
    this.audience = fn;
  }

  private async list(spaceId: string): Promise<StoredSubscription[]> {
    let list = this.subs.get(spaceId);
    if (!list) {
      const stored = (await this.deps.spaceRepo(spaceId).loadSecret(SUBS).catch(() => null)) as { subs?: StoredSubscription[] } | null;
      list = Array.isArray(stored?.subs) ? stored.subs : [];
      this.subs.set(spaceId, list);
    }
    return list;
  }

  private async save(spaceId: string, list: StoredSubscription[]): Promise<void> {
    this.subs.set(spaceId, list);
    await this.deps.spaceRepo(spaceId).saveSecret(SUBS, { subs: list });
  }

  /** Register (or refresh) this device for its owner. */
  async subscribe(spaceId: string, owner: PushOwner, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, prefs: PushPrefs = DEFAULT_PREFS): Promise<StoredSubscription> {
    const list = (await this.list(spaceId)).filter((s) => s.endpoint !== sub.endpoint);
    const entry: StoredSubscription = { endpoint: sub.endpoint, keys: sub.keys, owner, prefs, createdAt: Date.now() };
    list.push(entry);
    await this.save(spaceId, list.slice(-MAX_PER_SPACE));
    return entry;
  }

  async find(spaceId: string, endpoint: string): Promise<StoredSubscription | undefined> {
    return (await this.list(spaceId)).find((s) => s.endpoint === endpoint);
  }

  async setPrefs(spaceId: string, endpoint: string, prefs: PushPrefs): Promise<boolean> {
    const list = await this.list(spaceId);
    const s = list.find((x) => x.endpoint === endpoint);
    if (!s) return false;
    s.prefs = prefs;
    await this.save(spaceId, list);
    return true;
  }

  async unsubscribe(spaceId: string, endpoint: string): Promise<void> {
    const list = await this.list(spaceId);
    if (list.some((s) => s.endpoint === endpoint)) await this.save(spaceId, list.filter((s) => s.endpoint !== endpoint));
  }

  /** Send to one device (the "test" button). */
  async sendTo(spaceId: string, endpoint: string, msg: PushMessage): Promise<boolean> {
    const s = await this.find(spaceId, endpoint);
    return s ? this.deliver(spaceId, [s], msg).then((n) => n > 0) : false;
  }

  /** Send to every device of the space that wants this kind of message and may see it. */
  async notify(spaceId: string, msg: PushMessage): Promise<number> {
    const list = await this.list(spaceId);
    const targets = list.filter((s) => s.prefs[msg.kind] && this.audience(spaceId, s.owner, msg));
    return this.deliver(spaceId, targets, msg);
  }

  private async deliver(spaceId: string, targets: StoredSubscription[], msg: PushMessage): Promise<number> {
    if (!this.vapid || !targets.length) return 0;
    const send: Sender = this.deps.send ?? ((sub, payload, opts) => webpush.sendNotification(sub, payload, opts));
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag, kind: msg.kind });
    const gone: string[] = [];
    let sent = 0;
    await Promise.all(
      targets.map(async (s) => {
        try {
          await send({ endpoint: s.endpoint, keys: s.keys }, payload, {
            vapidDetails: { subject: this.deps.subject, publicKey: this.vapid!.publicKey, privateKey: this.vapid!.privateKey },
            TTL: msg.kind === "summary" ? 24 * 3600 : 3600,
            urgency: msg.kind === "alerts" ? "high" : "normal",
            topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
          });
          sent += 1;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          // The device unsubscribed or the app was removed: forget it.
          if (status === 404 || status === 410) gone.push(s.endpoint);
          else this.deps.log?.(`[push] send failed (${status ?? "network"})`);
        }
      }),
    );
    if (gone.length) await this.save(spaceId, (await this.list(spaceId)).filter((s) => !gone.includes(s.endpoint)));
    return sent;
  }
}

/**
 * Critical alerts arrive in bursts: at most one notification per streamer every few minutes;
 * the next one says how many were grouped.
 */
export class AlertThrottle {
  private last = new Map<string, number>();
  private held = new Map<string, number>();

  constructor(
    private windowMs = 3 * 60_000,
    private now: () => number = Date.now,
  ) {}

  /** null = hold this one; otherwise the number of alerts it stands for. */
  take(key: string): number | null {
    const t = this.now();
    const held = (this.held.get(key) ?? 0) + 1;
    const last = this.last.get(key);
    if (last !== undefined && t - last < this.windowMs) {
      this.held.set(key, held);
      return null;
    }
    this.last.set(key, t);
    this.held.set(key, 0);
    return held;
  }
}
