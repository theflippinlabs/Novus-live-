import { z } from "zod";
import { ACTION_TYPES, CATEGORIES } from "./types";

// Input validation for everything that crosses the HTTP boundary.

const id = z.string().min(1).max(128);
const username = z.string().min(1).max(64);
const text = z.string().max(500);

export const viewerRefSchema = z.object({
  id,
  username,
  displayName: z.string().max(80).optional(),
  avatarUrl: z.string().url().max(500).startsWith("https://").optional(),
});

const base = {
  id: id.optional(),
  timestamp: z.number().int().positive().optional(),
};

/** Normalized events accepted from an external/authorized connector. */
export const ingestEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("comment"), viewer: viewerRefSchema, text: text.min(1) }),
  z.object({ ...base, type: z.literal("viewer_count"), count: z.number().int().min(0).max(100_000_000) }),
  z.object({
    ...base,
    type: z.literal("gift"),
    viewer: viewerRefSchema,
    giftName: z.string().min(1).max(64),
    count: z.number().int().min(1).max(100_000),
    value: z.number().min(0).max(10_000_000).optional(),
  }),
  z.object({ ...base, type: z.literal("follow"), viewer: viewerRefSchema }),
  z.object({ ...base, type: z.literal("join"), viewer: viewerRefSchema }),
  z.object({
    ...base,
    type: z.literal("moderation"),
    viewer: viewerRefSchema.optional(),
    action: z.string().min(1).max(32),
    detail: z.string().max(300).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("stream_status"),
    status: z.enum(["started", "ended"]),
    title: z.string().max(120).optional(),
  }),
]);

export const ingestBatchSchema = z.object({
  events: z.array(ingestEventSchema).min(1).max(200),
});

export const thresholdsSchema = z
  .object({
    watch: z.number().int().min(1).max(99),
    warning: z.number().int().min(2).max(99),
    critical: z.number().int().min(3).max(100),
  })
  .refine((t) => t.watch < t.warning && t.warning < t.critical, {
    message: "Thresholds must be strictly increasing: watch < warning < critical",
  });

const phrase = z.string().trim().min(1).max(80);
const handle = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((s) => s.replace(/^@/, "").toLowerCase());

/** Followed TikTok accounts per space (each one is watched continuously). */
export const MAX_PROFILES = 50;

const tiktokHandle = z
  .string()
  .trim()
  .max(64)
  .regex(/^@?[A-Za-z0-9._]*$/)
  .transform((s) => s.replace(/^@/, ""));

export const settingsPatchSchema = z
  .object({
    sensitivity: z.enum(["low", "balanced", "strict", "custom"]),
    customThresholds: thresholdsSchema,
    categories: z.partialRecord(z.enum(CATEGORIES), z.boolean()),
    bannedPhrases: z.array(phrase).max(200),
    trustedUsers: z.array(handle).max(500),
    watchlist: z.array(handle).max(500),
    language: z.enum(["en", "fr"]),
    streamerName: z.string().trim().min(1).max(64),
    aiEnabled: z.boolean(),
    tiktokUsername: tiktokHandle,
    tiktokProfiles: z
      .array(tiktokHandle.pipe(z.string().min(2)))
      .max(MAX_PROFILES)
      .transform((list) => [...new Set(list)]),
    tiktokManual: z
      .array(tiktokHandle.pipe(z.string().min(2)))
      .max(MAX_PROFILES)
      .transform((list) => [...new Set(list.map((u) => u.toLowerCase()))]),
    tiktokGroups: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
            name: z.string().trim().min(1).max(40),
            members: z
              .array(tiktokHandle.pipe(z.string().min(2)))
              .max(MAX_PROFILES)
              .transform((list) => [...new Set(list.map((u) => u.toLowerCase()))]),
          })
          .strict(),
      )
      .max(30)
      .transform((groups) => {
        // An account sits in one group only: the first group listing it keeps it.
        const seen = new Set<string>();
        return groups.map((g) => ({ ...g, members: g.members.filter((u) => !seen.has(u) && seen.add(u)) }));
      }),
  })
  .partial()
  .strict();

export const actionRequestSchema = z
  .object({
    action: z.enum(ACTION_TYPES as [string, ...string[]]),
    note: z.string().max(300).optional(),
  })
  .strict();

export const flagRequestSchema = z
  .object({ flag: z.enum(["trusted", "watchlist", "ignored"]).nullable() })
  .strict();

export const demoStartSchema = z
  .object({ speed: z.union([z.literal(1), z.literal(5), z.literal(20)]).optional(), seed: z.number().int().optional() })
  .strict();

export const demoSpeedSchema = z.object({ speed: z.union([z.literal(1), z.literal(5), z.literal(20)]) }).strict();

export const catchUpRequestSchema = z.object({ since: z.number().int().min(0).optional(), lang: z.enum(["en", "fr"]).optional() }).strict();

export const tiktokConnectSchema = z
  .object({ username: z.string().trim().min(2).max(64).regex(/^@?[A-Za-z0-9._]+$/) })
  .strict();

export const loginSchema = z.object({ key: z.string().min(1).max(256) }).strict();

/** "Send in chat": the text shown to the moderator (TikTok chat messages are short). */
export const sendChatSchema = z
  .object({
    text: z.string().trim().min(1).max(150),
  })
  .strict();

export const recordingSchema = z.object({ action: z.enum(["start", "stop"]) }).strict();

const memberFields = {
  name: z.string().trim().min(1).max(40),
  role: z.enum(["director", "manager", "moderator"]),
  permissions: z.array(z.enum(["moderate", "send_chat", "manage_accounts", "settings", "history", "team"])).max(6),
  accounts: z.array(tiktokHandle.pipe(z.string().min(2))).max(MAX_PROFILES).nullable(),
};
export const memberCreateSchema = z.object(memberFields).strict();
export const memberUpdateSchema = z
  .object({ ...memberFields, disabled: z.boolean() })
  .partial()
  .strict();

// ---------------------------------------------------------------- billing
const planId = z.enum(["moderator_pro", "creator_pro", "agency", "agency_pro", "enterprise"]);
const selfServePlan = z.enum(["moderator_pro", "creator_pro", "agency", "agency_pro"]);
const cycle = z.enum(["month", "year"]);
const anon = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/).optional();

export const trackSchema = z
  .object({
    type: z.string().max(40),
    plan: planId.optional(),
    cycle: cycle.optional(),
    source: z.string().max(40).optional(),
    anonId: anon,
  })
  .strict();

export const profileSchema = z.object({ name: z.string().trim().min(2).max(60) }).strict();

export const recoverSchema = z.object({ email: z.string().trim().max(120).email(), lang: z.enum(["en", "fr"]).optional() }).strict();
export const recoverCompleteSchema = z.object({ token: z.string().regex(/^[\w-]{20,100}$/) }).strict();

export const signupSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    email: z.string().trim().max(120).email(),
    plan: selfServePlan,
    cycle,
    founding: z.boolean().default(false),
    source: z.string().max(40).optional(),
    anonId: anon,
  })
  .strict();

export const checkoutSchema = z
  .object({
    plan: selfServePlan,
    cycle,
    founding: z.boolean().default(false),
    source: z.string().max(40).optional(),
    anonId: anon,
  })
  .strict();

export const changePlanSchema = z.object({ plan: selfServePlan, cycle }).strict();

export const leadSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().max(120).email(),
    company: z.string().trim().min(1).max(120),
    creators: z.number().int().min(0).max(100000),
    message: z.string().trim().max(1000).optional(),
  })
  .strict();

const entitlementPatch = z
  .object({
    creator_limit: z.number().int().min(0),
    team_seat_limit: z.number().int().min(0),
    ai_requests: z.number().int().min(0),
    ai_tokens: z.number().int().min(0),
    live_monitoring_hours: z.number().min(0),
    recording_hours: z.number().min(0),
    video_storage_gb: z.number().min(0),
    video_retention_days: z.number().int().min(0),
    screenshot_limit: z.number().int().min(0),
    history_retention_days: z.number().int().min(1),
    exports_limit: z.number().int().min(0),
    advanced_analytics: z.boolean(),
    agency_dashboard: z.boolean(),
    team_roles: z.boolean(),
    recording: z.boolean(),
    screenshots: z.boolean(),
    priority_support: z.boolean(),
    api_access: z.boolean(),
    white_label: z.boolean(),
  })
  .partial()
  .strict();

/** Admin overrides (limits, trials, founding offer, costs, margin thresholds) — prices stay in Stripe. */
export const adminConfigSchema = z
  .object({
    plans: z.partialRecord(planId, z.object({ available: z.boolean(), trialDays: z.number().int().min(0).max(60), entitlements: entitlementPatch, trial: entitlementPatch }).partial().strict()),
    founding: z.object({ enabled: z.boolean(), capacity: z.number().int().min(0).max(1000) }).partial().strict(),
    costs: z
      .object({
        per_1m_input_tokens: z.number().min(0),
        per_1m_output_tokens: z.number().min(0),
        per_provider_request: z.number().min(0),
        per_live_hour: z.number().min(0),
        per_recording_hour: z.number().min(0),
        per_storage_gb_month: z.number().min(0),
        per_1000_screenshots: z.number().min(0),
        per_workspace_month: z.number().min(0),
        usd_to_eur: z.number().min(0.1).max(10),
      })
      .partial()
      .strict(),
    margins: z.object({ target: z.number().min(0).max(100), watch: z.number().min(0).max(100) }).partial().strict(),
  })
  .partial()
  .strict();
