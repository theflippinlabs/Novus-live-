import { describe, expect, it } from "vitest";
import { securityHeaders } from "../server/http/security";

const run = (origins: string[]) => {
  const headers: Record<string, string> = {};
  let called = false;
  securityHeaders(origins)({} as never, { setHeader: (k: string, v: string) => (headers[k] = v) } as never, () => (called = true));
  return { csp: headers["Content-Security-Policy"], called };
};

describe("Content-Security-Policy", () => {
  it("lets the video player read pieces from the storage host", () => {
    const { csp, called } = run(["https://abc.supabase.co"]);
    expect(called).toBe(true);
    expect(csp).toContain("media-src 'self' blob: https://abc.supabase.co");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co");
    expect(csp).toContain("script-src 'self';");
  });

  it("stays same-origin without storage (the LIVE itself is relayed by the app)", () => {
    const { csp } = run([]);
    expect(csp).toContain("media-src 'self' blob:;");
    expect(csp).toContain("connect-src 'self';");
  });
});
