import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../shared/types";
import { LiveRecorder } from "../server/core/LiveRecorder";
import { createRuntime } from "./helpers";

const started = () => [{ id: `s${Math.random()}`, timestamp: Date.now(), type: "stream_status", status: "started", title: "@amanda LIVE" }] as unknown as LiveEvent[];
const ended = () => [{ id: `e${Math.random()}`, timestamp: Date.now(), type: "stream_status", status: "ended" }] as unknown as LiveEvent[];
const msg = (text: string) => [{ type: "comment", id: `c${Math.random()}`, timestamp: Date.now(), viewer: { id: "v1", username: "fan" }, text }] as unknown as LiveEvent[];

function setup() {
  const { runtime } = createRuntime({ account: "amanda" });
  const waiting: string[] = [];
  const recorder = new LiveRecorder("amanda", runtime, { waiting: (d) => waiting.push(d), changed: () => undefined });
  return { runtime, recorder, waiting };
}

describe("Recording modes of a followed account", () => {
  it("auto: records every confirmed LIVE from start to end", async () => {
    const { runtime, recorder } = setup();
    expect(recorder.mode).toBe("auto");
    await recorder.push(started());
    await recorder.push(msg("hello"));
    expect(recorder.detected).toBe(true);
    expect(runtime.session?.status).toBe("live");
    expect(runtime.stats().messagesTotal).toBe(1);
    await recorder.push(ended());
    expect(recorder.detected).toBe(false);
    expect(runtime.session?.status).toBe("ended");
  });

  it("manual: detects the LIVE but records only after 'Start recording', until the LIVE ends", async () => {
    const { runtime, recorder, waiting } = setup();
    recorder.apply(true);
    await recorder.push(started());
    await recorder.push(msg("not recorded"));
    expect(recorder.detected).toBe(true);
    expect(runtime.session).toBeNull();
    expect(waiting.at(-1)).toBe("@amanda is LIVE — recording is manual");

    await recorder.setRecording(true);
    await recorder.push(msg("recorded"));
    expect(runtime.session?.status).toBe("live");
    expect(runtime.stats().messagesTotal).toBe(1);

    await recorder.push(ended());
    expect(runtime.session?.status).toBe("ended");
    // The next LIVE waits for the moderator again.
    await recorder.push(started());
    await recorder.push(msg("next live"));
    expect(runtime.session?.status).toBe("ended");
  });

  it("cannot start recording when the account is not LIVE", async () => {
    const { recorder } = setup();
    await expect(recorder.setRecording(true)).rejects.toThrow("not_live");
  });

  it("stopping by hand closes the session; switching modes applies to the running LIVE", async () => {
    const { runtime, recorder } = setup();
    await recorder.push(started());
    await recorder.setRecording(false);
    expect(runtime.session?.status).toBe("ended");
    await recorder.push(msg("after stop"));
    expect(runtime.session?.status).toBe("ended");

    // Switched to manual during a recorded LIVE: it keeps recording.
    await recorder.setRecording(true);
    recorder.apply(true);
    await recorder.push(msg("still recorded"));
    expect(runtime.session?.status).toBe("live");
    await recorder.push(ended());

    // Manual LIVE running unrecorded, switched to auto: recording starts right away.
    await recorder.push(started());
    expect(runtime.session?.status).toBe("ended");
    recorder.apply(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(runtime.session?.status).toBe("live");
  });
});
