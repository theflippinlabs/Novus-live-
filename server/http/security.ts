import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

/** Fixed-window rate limiter keyed by client IP (+ bucket name). */
export function rateLimit(name: string, perMinute: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  let lastSweep = Date.now();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      lastSweep = now;
    }
    const key = `${name}:${req.ip ?? "unknown"}`;
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + 60_000 };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader("RateLimit-Limit", String(perMinute));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, perMinute - entry.count)));
    if (entry.count > perMinute) {
      res.setHeader("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const AUTH_COOKIE = "novus_auth";

export function sessionCookieValue(accessToken: string): string {
  return createHmac("sha256", accessToken).update("novus-live-session-v1").digest("base64url");
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** An access key and the space (tenant) it opens. */
export interface AccessKey {
  key: string;
  tenant: string;
}

const TENANT_RE = /^[a-z0-9_-]{1,32}$/;

/**
 * Every access key that opens the app. APP_ACCESS_TOKEN opens the owner's space; each
 * APP_ACCESS_TOKENS entry ("name:key", or a bare key) opens its own separate space.
 * Empty: open access (single space).
 */
export function accessKeys(primary?: string, extra: string[] = [], owner = "owner"): AccessKey[] {
  const out: AccessKey[] = primary ? [{ key: primary, tenant: owner }] : [];
  for (const raw of extra) {
    const i = raw.indexOf(":");
    const name = i > 0 ? raw.slice(0, i).trim().toLowerCase() : "";
    const key = i > 0 ? raw.slice(i + 1).trim() : raw.trim();
    if (!key) continue;
    const tenant = TENANT_RE.test(name) && name !== owner ? name : `k${createHash("sha256").update(key).digest("hex").slice(0, 10)}`;
    out.push({ key, tenant });
  }
  return out;
}

/** The key behind the session cookie. The cookie is tied to one key: removing a key logs out only whoever used it. */
export function authKey(req: Request, keys: AccessKey[]): AccessKey | undefined {
  const cookie = readCookie(req, AUTH_COOKIE);
  if (!cookie) return undefined;
  let found: AccessKey | undefined;
  for (const k of keys) if (safeEqual(cookie, sessionCookieValue(k.key))) found = k;
  return found;
}

export function isAuthenticated(req: Request, keys: AccessKey[]): boolean {
  return !keys.length || Boolean(authKey(req, keys));
}

/** The key matching what was typed at login, if any. */
export function matchKey(input: string, keys: AccessKey[]): AccessKey | undefined {
  let found: AccessKey | undefined;
  // Compare against every key (no early exit) to keep timing uniform.
  for (const k of keys) if (safeEqual(input, k.key)) found = k;
  return found;
}

/** Mutating requests must be JSON: blocks cross-site HTML form posts (CSRF) in addition to SameSite=Strict. */
export function requireJson(req: Request, res: Response, next: NextFunction): void {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !req.is("application/json")) {
    res.status(415).json({ error: "content_type_must_be_json" });
    return;
  }
  next();
}
