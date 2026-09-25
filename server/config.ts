// All configuration comes from server-side environment variables.
// Nothing here is ever serialized to the client.

function int(name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

function str(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export interface Config {
  port: number;
  host: string;
  production: boolean;
  webDir: string;
  trustProxy: boolean;
  accessToken?: string;
  /** Extra access keys, each opening its own separate space: APP_ACCESS_TOKENS="name:key,name2:key2". */
  accessTokens?: string[];
  ingestToken?: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  anthropicEffort: "low" | "medium" | "high";
  aiMaxCallsPerMinute: number;
  aiBatchSize: number;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  dataDir?: string;
  apiRateLimitPerMinute: number;
  ingestRateLimitPerMinute: number;
  tiktokLiveConnector: boolean;
  eulerApiKey?: string;
  /** Euler Stream OAuth client for "Send in chat" (optional). */
  eulerClientId?: string;
  eulerClientSecret?: string;
  eulerOAuthAuthorizeUrl?: string;
  /** Public https origin of the app (OAuth redirect), e.g. https://novus-live-production.up.railway.app */
  publicUrl?: string;
  /** Time zone used for dates in LIVE reports and exports. */
  reportTimeZone: string;
}

export function loadConfig(): Config {
  // Load .env when present (Node >= 20.12). Real environment variables always win.
  try {
    process.loadEnvFile();
  } catch {
    /* no .env file */
  }
  const effort = str("ANTHROPIC_EFFORT") ?? "low";
  if (!["low", "medium", "high"].includes(effort)) throw new Error(`Invalid ANTHROPIC_EFFORT: ${effort}`);
  const accessToken = str("APP_ACCESS_TOKEN");
  const ingestToken = str("INGEST_TOKEN");
  if (accessToken && accessToken.length < 12) throw new Error("APP_ACCESS_TOKEN must be at least 12 characters");
  const accessTokens = (str("APP_ACCESS_TOKENS") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (accessTokens.some((k) => k.slice(k.indexOf(":") + 1).trim().length < 12)) throw new Error("Each APP_ACCESS_TOKENS key must be at least 12 characters");
  if (ingestToken && ingestToken.length < 24) throw new Error("INGEST_TOKEN must be at least 24 characters");
  return {
    port: int("PORT", 8787, 1, 65535),
    host: str("HOST") ?? "0.0.0.0",
    production: process.env.NODE_ENV === "production",
    webDir: str("WEB_DIR") ?? "dist/web",
    trustProxy: process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1",
    accessToken,
    accessTokens,
    ingestToken,
    anthropicApiKey: str("ANTHROPIC_API_KEY"),
    anthropicModel: str("ANTHROPIC_MODEL") ?? "claude-opus-5",
    anthropicEffort: effort as Config["anthropicEffort"],
    aiMaxCallsPerMinute: int("AI_MAX_CALLS_PER_MINUTE", 20, 1, 600),
    aiBatchSize: int("AI_BATCH_SIZE", 8, 1, 25),
    supabaseUrl: str("SUPABASE_URL"),
    supabaseServiceRoleKey: str("SUPABASE_SERVICE_ROLE_KEY"),
    dataDir: str("DATA_DIR"),
    apiRateLimitPerMinute: int("API_RATE_LIMIT_PER_MINUTE", 600, 10),
    ingestRateLimitPerMinute: int("INGEST_RATE_LIMIT_PER_MINUTE", 1200, 10),
    // Unofficial read-only TikTok LIVE connector (see docs/TIKTOK_INTEGRATION.md). On unless set to "off".
    tiktokLiveConnector: (process.env.TIKTOK_LIVE_CONNECTOR ?? "on").toLowerCase() !== "off",
    eulerApiKey: str("EULER_API_KEY"),
    eulerClientId: str("EULER_CLIENT_ID"),
    eulerClientSecret: str("EULER_CLIENT_SECRET"),
    eulerOAuthAuthorizeUrl: str("EULER_OAUTH_AUTHORIZE_URL"),
    publicUrl: str("PUBLIC_URL")?.replace(/\/+$/, ""),
    reportTimeZone: validTimeZone(str("REPORT_TIMEZONE")) ?? "Europe/Paris",
  };
}

function validTimeZone(tz?: string): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}
