import { defaultSettings } from "../shared/settings";
import type { LiveComment, Settings } from "../shared/types";
import type { AIProvider, AIReviewItem, AIVerdict } from "../server/ai/AIProvider";
import { NullAIProvider } from "../server/ai/AIProvider";
import { NovusRuntime } from "../server/core/NovusRuntime";
import { RoomContext, ViewerContextStore } from "../server/moderation/context";
import { analyzeStage1 } from "../server/moderation/heuristics";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import { MockLiveAdapter } from "../server/platform/MockLiveAdapter";
import { TikTokAdapter } from "../server/platform/TikTokAdapter";

/** A tiny harness that runs stage 1 exactly like the runtime does (context recorded after each message). */
export function createAnalyzer(settings: Settings = defaultSettings()) {
  const store = new ViewerContextStore();
  const room = new RoomContext();
  let t = 1_000_000;
  return {
    store,
    room,
    settings,
    advance(ms: number) {
      t += ms;
    },
    analyze(username: string, text: string, opts: { at?: number; flag?: "trusted" | "watchlist" | null } = {}) {
      t = opts.at ?? t + 1500;
      const ctx = store.get(`v:${username}`, username);
      if (opts.flag !== undefined) ctx.flag = opts.flag;
      room.prune(t);
      const r = analyzeStage1({ text, username, timestamp: t, viewer: ctx, room, settings });
      store.record(ctx, { id: `m${t}`, t, text, fp: r.fp, score: r.analysis.riskScore, categories: r.analysis.categories, hostile: r.hostile });
      room.add({ t, viewerId: ctx.viewerId, fp: r.fp, hostile: r.hostile });
      return r;
    },
  };
}

let seq = 0;
export function comment(sessionId: string, username: string, text: string, timestamp = Date.now()): LiveComment {
  seq += 1;
  return { type: "comment", id: `c${seq}`, sessionId, platform: "mock", timestamp, viewer: { id: `v:${username}`, username }, text };
}

export class FakeAIProvider implements AIProvider {
  readonly name = "fake";
  readonly model = "fake-model";
  calls: AIReviewItem[][] = [];
  constructor(private verdict: (item: AIReviewItem) => AIVerdict) {}
  available() {
    return true;
  }
  async reviewBatch(items: AIReviewItem[]) {
    this.calls.push(items);
    return new Map(items.map((i) => [i.id, this.verdict(i)]));
  }
}

export function createRuntime(opts: { ai?: AIProvider; connector?: boolean; clock?: () => number } = {}) {
  const tiktok = new TikTokAdapter(opts.connector ?? false);
  const mock = new MockLiveAdapter(7, 50);
  const runtime = new NovusRuntime({
    repo: new MemoryRepository(),
    ai: opts.ai ?? new NullAIProvider(),
    tiktok,
    mock,
    clock: opts.clock,
    aiQueueOptions: { batchSize: 1, flushMs: 1, maxCallsPerMinute: 100, maxQueue: 64 },
  });
  return { runtime, tiktok, mock };
}
