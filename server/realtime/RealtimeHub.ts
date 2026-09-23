import type { ServerResponse } from "node:http";
import type { ActionRecord, AnalyzedComment, ModerationAlert, RealtimeBatch } from "../../shared/types";

// Server-Sent Events fan-out with batching: events are coalesced and flushed
// every `flushMs`, so a chat burst of 200 msgs/s becomes ~5 client updates/s.

type Extras = Omit<RealtimeBatch, "comments" | "commentUpdates" | "alerts" | "actions">;

export class RealtimeHub {
  private clients = new Set<ServerResponse>();
  private comments: AnalyzedComment[] = [];
  private updates = new Map<string, AnalyzedComment>();
  private alerts = new Map<string, ModerationAlert>();
  private actions: ActionRecord[] = [];
  private extras: Extras = {};
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private flushMs = 200,
    private extrasProvider: () => Extras = () => ({}),
  ) {}

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.flushMs);
    this.pingTimer = setInterval(() => this.broadcastRaw(": ping\n\n"), 15_000);
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.flushTimer = this.pingTimer = null;
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  addClient(res: ServerResponse, initial: unknown): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 2000\nevent: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  pushComment(c: AnalyzedComment): void {
    this.comments.push(c);
    // Keep bursts bounded — clients only render the tail anyway.
    if (this.comments.length > 600) this.comments.splice(0, this.comments.length - 600);
    this.dirty = true;
  }

  updateComment(c: AnalyzedComment): void {
    const pending = this.comments.findIndex((x) => x.id === c.id);
    if (pending >= 0) this.comments[pending] = c;
    else this.updates.set(c.id, c);
    this.dirty = true;
  }

  pushAlert(a: ModerationAlert): void {
    this.alerts.set(a.id, a);
    this.dirty = true;
  }

  pushAction(a: ActionRecord): void {
    this.actions.push(a);
    this.dirty = true;
  }

  pushExtras(extras: Extras): void {
    if (extras.reset) {
      // A new session supersedes anything still buffered from the previous one.
      this.comments = [];
      this.updates.clear();
      this.alerts.clear();
      this.actions = [];
    }
    this.extras = { ...this.extras, ...extras };
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const batch: RealtimeBatch = {
      ...this.extrasProvider(),
      ...this.extras,
      comments: this.comments,
      commentUpdates: [...this.updates.values()],
      alerts: [...this.alerts.values()],
      actions: this.actions,
    };
    this.comments = [];
    this.updates.clear();
    this.alerts.clear();
    this.actions = [];
    this.extras = {};
    if (this.clients.size) this.broadcastRaw(`event: batch\ndata: ${JSON.stringify(batch)}\n\n`);
  }

  private broadcastRaw(payload: string): void {
    for (const c of this.clients) c.write(payload);
  }
}
