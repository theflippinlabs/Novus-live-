import type { DemoSpeed, DemoStatus } from "../../shared/types";
import { DemoTrafficGenerator } from "./demoTraffic";
import type { LiveEventHandler, LivePlatformAdapter } from "./LivePlatformAdapter";

/** Drives the demo generator in real time. Makes the whole app usable with zero credentials. */
export class MockLiveAdapter implements LivePlatformAdapter {
  readonly platform = "mock" as const;
  readonly displayName = "Demo LIVE (mock)";
  private timer: ReturnType<typeof setInterval> | null = null;
  private generator: DemoTrafficGenerator | null = null;
  private lastTick = 0;
  private speed: DemoSpeed = 1;

  constructor(
    private seed = Date.now() % 100_000,
    private tickMs = 100,
  ) {}

  setSpeed(speed: DemoSpeed): void {
    this.speed = speed;
    if (this.generator) this.generator.speed = speed;
  }

  async start(sessionId: string, emit: LiveEventHandler): Promise<void> {
    await this.stop();
    this.generator = new DemoTrafficGenerator({ seed: this.seed, speed: this.speed });
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.min(1000, now - this.lastTick);
      this.lastTick = now;
      for (const ev of this.generator!.advance(elapsed, sessionId, now)) emit(ev);
    }, this.tickMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  status(): DemoStatus {
    return { running: this.isRunning(), speed: this.speed, demoSecond: this.generator?.demoSecond ?? 0 };
  }
}
