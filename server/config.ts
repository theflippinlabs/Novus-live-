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
  if (ingestToken && ingestToken.length < 24) throw new Error("INGEST_TOKEN must be at least 24 characters");
  return {
    port: int("PORT", 8787, 1, 65535),
    host: str("HOST") ?? "0.0.0.0",
    production: process.env.NODE_ENV === "production",
    webDir: str("WEB_DIR") ?? "dist/web",
    trustProxy: process.env.TRUST_PROXY === "true" || process.env.TRUST_PROXY === "1",
    accessToken,
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
  };
}
