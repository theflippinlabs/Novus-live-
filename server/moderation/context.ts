import type { Category, ViewerFlag } from "../../shared/types";

// Short-term contextual memory. Per-viewer history lets Novus judge a message
// against what that viewer said before; the room context detects bursts shared
// across many accounts (coordinated spam / pile-ons).

export const HOSTILE_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  "insult",
  "harassment",
  "threat",
  "hate",
  "sexual_harassment",
  "doxxing",
]);

export interface ContextMessage {
  id: string;
  t: number;
  text: string;
  fp: string;
  score: number;
  categories: Category[];
  hostile: boolean;
}

export interface ViewerContext {
  viewerId: string;
  username: string;
  recent: ContextMessage[];
  warnings: number;
  flag: ViewerFlag | null;
}

const VIEWER_WINDOW_MS = 10 * 60_000;
const VIEWER_MAX = 30;
const ROOM_WINDOW_MS = 60_000;

export class ViewerContextStore {
  private viewers = new Map<string, ViewerContext>();

  get(viewerId: string, username: string): ViewerContext {
    let ctx = this.viewers.get(viewerId);
    if (!ctx) {
      ctx = { viewerId, username, recent: [], warnings: 0, flag: null };
      this.viewers.set(viewerId, ctx);
    }
    return ctx;
  }

  peek(viewerId: string): ViewerContext | undefined {
    return this.viewers.get(viewerId);
  }

  record(ctx: ViewerContext, msg: ContextMessage): void {
    ctx.recent.push(msg);
    const cutoff = msg.t - VIEWER_WINDOW_MS;
    while (ctx.recent.length > VIEWER_MAX || (ctx.recent[0] && ctx.recent[0].t < cutoff)) ctx.recent.shift();
  }

  /** Update the stored score after AI refinement so escalation tracking uses the best estimate. */
  refine(viewerId: string, messageId: string, score: number, categories: Category[], hostile: boolean): void {
    const ctx = this.viewers.get(viewerId);
    const m = ctx?.recent.find((r) => r.id === messageId);
    if (m) {
      m.score = score;
      m.categories = categories;
      m.hostile = hostile;
    }
  }

  setFlag(viewerId: string, username: string, flag: ViewerFlag | null): void {
    this.get(viewerId, username).flag = flag;
  }

  addWarning(viewerId: string, username: string): void {
    this.get(viewerId, username).warnings += 1;
  }

  clear(): void {
    this.viewers.clear();
  }
}

interface RoomEntry {
  t: number;
  viewerId: string;
  fp: string;
  hostile: boolean;
}

export class RoomContext {
  private entries: RoomEntry[] = [];

  prune(now: number): void {
    const cutoff = now - ROOM_WINDOW_MS;
    let i = 0;
    while (i < this.entries.length && this.entries[i].t < cutoff) i++;
    if (i > 0) this.entries.splice(0, i);
  }

  add(entry: RoomEntry): void {
    this.entries.push(entry);
    if (this.entries.length > 5000) this.entries.splice(0, this.entries.length - 5000);
  }

  /** Distinct *other* accounts that posted the same fingerprint within windowMs. */
  sameMessageAccounts(fp: string, viewerId: string, now: number, windowMs = 30_000): number {
    const ids = new Set<string>();
    for (const e of this.entries) {
      if (e.t >= now - windowMs && e.fp === fp && e.viewerId !== viewerId) ids.add(e.viewerId);
    }
    return ids.size;
  }

  /** Accounts (viewer ids) that posted this fingerprint within windowMs. */
  accountsFor(fp: string, now: number, windowMs = 30_000): string[] {
    const ids = new Set<string>();
    for (const e of this.entries) if (e.t >= now - windowMs && e.fp === fp) ids.add(e.viewerId);
    return [...ids];
  }

  /** Distinct other accounts that posted hostile messages within windowMs. */
  hostileAccounts(viewerId: string, now: number, windowMs = 60_000): number {
    const ids = new Set<string>();
    for (const e of this.entries) {
      if (e.t >= now - windowMs && e.hostile && e.viewerId !== viewerId) ids.add(e.viewerId);
    }
    return ids.size;
  }

  clear(): void {
    this.entries = [];
  }
}
