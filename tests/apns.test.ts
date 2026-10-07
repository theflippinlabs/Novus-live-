import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apnsPayload, providerToken, readP8, type ApnsMessage, type ApnsResult } from "../server/push/Apns";
import { PushService } from "../server/push/Push";
import { MemoryRepository } from "../server/persistence/MemoryRepository";
import { pushEndpointSchema, pushNativeSubscribeSchema } from "../shared/schemas";

const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("APNs (native iPhone app notifications)", () => {
  it("signs a valid ES256 provider token with the .p8 key (PEM or base64)", () => {
    const key = readP8(Buffer.from(pem).toString("base64"));
    const token = providerToken({ keyId: "ABC123DEFG", teamId: "TEAM123456" }, key, 1_800_000_000);
    const [head, claims, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    const ok = verify("sha256", Buffer.from(`${head}.${claims}`), { key: createPublicKey(readP8(pem)), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
  });

  it("puts the screen to open in the payload", () => {
    expect(JSON.parse(apnsPayload({ title: "T", body: "B", url: "/?view=alerts", tag: "alert-x", urgent: true, ttlSeconds: 60 }))).toEqual({ aps: { alert: { title: "T", body: "B" }, sound: "default", "thread-id": "alert-x" }, url: "/?view=alerts" });
  });

  it("validates native device registrations", () => {
    expect(pushNativeSubscribeSchema.safeParse({ token: "a".repeat(64) }).success).toBe(true);
    expect(pushNativeSubscribeSchema.safeParse({ token: "not-hex!" }).success).toBe(false);
    expect(pushEndpointSchema.safeParse({ endpoint: `apns:${"b".repeat(64)}` }).success).toBe(true);
    expect(pushEndpointSchema.safeParse({ endpoint: "apns:zz" }).success).toBe(false);
  });

  it("sends to native devices through APNs and web devices through web push; forgets removed apps", async () => {
    const repo = new MemoryRepository();
    const native: { token: string; msg: ApnsMessage }[] = [];
    const web: string[] = [];
    const push = new PushService({
      serverRepo: repo.scoped("owner"),
      spaceRepo: (t) => repo.scoped(t),
      subject: "https://novus.test",
      send: async (sub) => {
        web.push(sub.endpoint);
      },
      apns: {
        send: async (token, msg): Promise<ApnsResult> => {
          native.push({ token, msg });
          return token.startsWith("dead") ? "gone" : "sent";
        },
      },
    });
    await push.init();
    expect(push.nativeEnabled).toBe(true);
    await push.subscribeNative("s1", { kind: "founder" }, "A".repeat(64));
    await push.subscribeNative("s1", { kind: "founder" }, "dead" + "0".repeat(60));
    await push.subscribe("s1", { kind: "founder" }, { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } });
    const n = await push.notify("s1", { kind: "alerts", title: "⚠️", body: "x", url: "/?view=alerts", tag: "alert-a" });
    expect(n).toBe(2);
    expect(native.map((x) => x.token)).toEqual(["a".repeat(64), "dead" + "0".repeat(60)]);
    expect(native[0].msg.urgent).toBe(true);
    expect(web).toEqual(["https://web.push.apple.com/abc"]);
    // The removed app's device is forgotten.
    expect(await push.find("s1", `apns:dead${"0".repeat(60)}`)).toBeUndefined();
    expect(await push.find("s1", `apns:${"a".repeat(64)}`)).toBeDefined();
  });
});

describe("Privacy policy page", () => {
  it("is public and states what the app really does", async () => {
    const { privacyPage } = await import("../server/legal/privacy");
    const html = privacyPage({ supportEmail: "support@example.com", updated: "today" });
    expect(html).toContain("mailto:support@example.com");
    expect(html).toContain("ne propose aucun achat");
    expect(html).toContain("never identifies who reported a LIVE");
    expect(privacyPage({ updated: "x" })).not.toContain("mailto:");
  });
});
