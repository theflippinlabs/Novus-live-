# NOVUS LIVE

**Real‑time AI moderation and streamer‑assistant cockpit for TikTok LIVE.**
Part of the **Novarys / Pulse Engine** ecosystem.

Mobile‑first, installable PWA designed to sit next to TikTok on an iPhone during a fast LIVE:
obsidian interface, platinum type, restrained gold, one‑thumb moderation.

- **Live command center** — status, duration, messages/min, viewers, active chatters, alerts and AI status; a virtualized chat stream with per‑message risk level and reason chips; the worst open critical alert pinned above the chat with one‑thumb actions.
- **Two‑stage moderation engine** — fast local heuristics on every message, contextual AI review only for suspicious/ambiguous ones.
- **Alert queue** — critical first, merged per viewer, coordinated raids grouped into one alert; WATCH / WARN / MUTE / BLOCK / REPORT / DISMISS through a `ModerationActionAdapter` that never fakes success.
- **Viewer intelligence** — history, risk trend, categories, warnings, previous alerts, moderation history, Novus assessment; Trusted / Watchlist / Ignored.
- **Streamer assistant** — Chat Pulse, trending topics, top unanswered question, question clustering (EN/FR), repeated requests, sentiment + sudden shifts, important messages, spikes, and **CATCH ME UP**.
- **Analytics + post‑LIVE report** (Markdown download).
- **Demo LIVE** — one tap, realistic traffic at 1x / 5x / 20x. No credentials needed.

---

## Architecture

```
                ┌──────────────────────────── Node server (single process) ────────────────────────────┐
 Platform       │                                                                                       │
 adapters       │  normalize ─▶ Stage 1 heuristics ─▶ context update ─▶ Stage 2 AI (optional) ─▶ persist │
 ─────────      │  (zod)        (rules, repetition,   (per-viewer       (batched, budgeted,     (memory / │
 MockLive  ───▶ │               flooding, bursts,     history + room    only ambiguous msgs)    Supabase) │
 TikTok*   ───▶ │               escalation, links)    context)                  │                        │
 Connector ───▶ │                       │                                         ▼                        │
 (/api/ingest)  │                       └──────▶ alerts · viewer profiles · insights · analytics            │
                │                                              │                                        │
                │                                   RealtimeHub (SSE, 200 ms batches)                   │
                └──────────────────────────────────────────────┼────────────────────────────────────────┘
                                                               ▼
                                          PWA (React) — Live · Alerts · Viewers · Assistant · Analytics · Settings
```

\* `TikTokAdapter` exposes an isolated `TikTokEventSource` integration point — see [docs/TIKTOK_INTEGRATION.md](docs/TIKTOK_INTEGRATION.md).

**Key design decisions**

| Concern | Implementation |
| --- | --- |
| Platform independence | `LivePlatformAdapter` → normalized `LiveEvent` union (`LiveComment`, `LiveViewer`, `LiveGift`, `LiveFollow`, `LiveJoin`, `LiveModerationEvent`, stream status). The engine never imports platform code. |
| Contextual moderation | `ViewerContextStore` (10‑min per‑viewer history: repeats, flooding, hostility, warnings, flags) + `RoomContext` (60‑s room window: coordinated bursts, pile‑ons). A friendly echo ("when does it launch?" ×50) is *not* an attack; the same hostile line from 8 accounts is. |
| Cost control | Stage 2 only receives messages stage 1 marks ambiguous (contextual categories, low confidence, banter + insult, trusted viewers). `AIQueue` batches (default 8), caps calls/min, drops lowest‑risk items when saturated, and degrades gracefully to stage 1 on errors. |
| Structured analysis | Every message gets `{ riskScore, severity, categories, explanation, recommendedAction, confidence }` (+ reason chips, stage). |
| Honest actions | `ModerationActionAdapter` — `SimulatedActionAdapter` (demo, labelled *simulated*) and `TikTokManualActionAdapter` (*MANUAL ACTION REQUIRED* + exact steps + confirm). |
| Persistence | `Repository` interface — `MemoryRepository` (default, optional JSON file for settings/flags/reports) or `SupabaseRepository` (service role, server‑only). Writes are batched every 2 s. |
| Realtime & performance | Server‑Sent Events, 200 ms coalesced batches; client store with per‑slice references; chat virtualized with `@tanstack/react-virtual`, memoized rows (a batch renders only new rows), capped buffers. |
| Secrets | Browser only talks to the Novus server. Anthropic / Supabase / ingest secrets are server env vars. |

### Project layout

```
shared/                  platform-independent types, zod schemas, settings presets
server/
  platform/              LivePlatformAdapter, MockLiveAdapter + demo traffic, TikTokAdapter
  moderation/            stage-1 heuristics, patterns (EN/FR), context stores, language detection
  ai/                    AIProvider abstraction, AnthropicProvider, AIQueue (batching + budget)
  actions/               ModerationActionAdapter, simulated + TikTok manual adapters
  assistant/             InsightsEngine (questions, topics, sentiment…), Catch-me-up builder
  analytics/             per-minute rollups, post-LIVE report
  persistence/           Repository interface, memory + Supabase implementations
  realtime/              SSE hub with batching
  core/NovusRuntime.ts   the ingestion pipeline and read models
  http/ + app.ts         routes, validation, auth, rate limits, security headers
src/                     React PWA (views, components, store, i18n EN/FR)
supabase/migrations/     Postgres schema (RLS on, no public policies)
tests/                   Vitest suites
docs/TIKTOK_INTEGRATION.md
```

---

## Local setup

Requirements: **Node 20.12+** (22 recommended).

```bash
npm install
cp .env.example .env        # optional — everything works with no variables
npm run dev                 # API on :8787 + Vite on :5173 (proxied)
```

Open <http://localhost:5173> and tap **START DEMO LIVE**.

Production build locally:

```bash
npm run build
npm start                   # serves API + PWA on http://localhost:8787
```

Quality gates (all must pass):

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke               # optional: real-browser E2E at iPhone size against a running server
```

## Demo mode

**START DEMO LIVE** (Live tab) runs `MockLiveAdapter`, a deterministic generator that mixes normal
EN/FR conversation, emojis, questions and requests with a scripted incident timeline (every ~200 s of demo time):

| Incident | Expected Novus result |
| --- | --- |
| Spam bot repeating "follow me for free followers" | repetition + spam → CRITICAL, BLOCK |
| Friendly banter "lol you're such a clown 😂" | stays low (sent to AI for context when enabled) |
| Mild insult "you're kinda dumb" | WATCH/WARNING |
| Escalating harassment ending with "give me your address i'll come find you" | merged alert, escalation → CRITICAL, REPORT |
| Scam "FREE 10k coins … bit.ly/…" | scam + shortened link → CRITICAL, BLOCK |
| Address / phone number leak | doxxing → CRITICAL |
| 8‑account raid "L STREAM 💀💀 raid time" | ONE grouped coordinated‑attack alert listing all accounts |
| Look‑alike account "novarys_officiall" asking for gifts | impersonation → BLOCK |
| Sexual harassment, French threats, crypto scam with phone number | detected |
| Host answers "Release date is next Friday" | related questions marked answered |

Speed **1x / 5x / 20x** scales traffic volume (20x ≈ 25+ msg/s) — use it to see the UI stay smooth.
Actions in demo mode apply to the mock platform only and are labelled **simulated** (a simulated block silences that viewer in the demo).

## Environment variables

All variables are **server‑side only** (see [.env.example](.env.example)). `.env` is loaded automatically.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | HTTP listener |
| `TRUST_PROXY` | `false` | `true` behind a PaaS/reverse proxy (correct client IPs for rate limiting) |
| `APP_ACCESS_TOKEN` | — | Protects the whole app with an access key (≥ 12 chars). **Set it for any public deployment.** |
| `ANTHROPIC_API_KEY` | — | Enables stage‑2 contextual AI. Without it, local moderation only. |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model for stage 2 / Catch‑me‑up narrative |
| `ANTHROPIC_EFFORT` | `low` | `low` / `medium` / `high` |
| `AI_MAX_CALLS_PER_MINUTE` | `20` | Hard budget on AI calls |
| `AI_BATCH_SIZE` | `8` | Messages per AI call |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | — | Enables Postgres persistence |
| `DATA_DIR` | — | JSON persistence for settings / flags / reports when Supabase is not used |
| `INGEST_TOKEN` | — | Enables authorized connector ingestion (≥ 24 chars) |
| `API_RATE_LIMIT_PER_MINUTE` | `600` | Per‑IP API limit |
| `INGEST_RATE_LIMIT_PER_MINUTE` | `1200` | Per‑IP ingestion limit |

## Anthropic setup

1. Create an API key in the Anthropic Console.
2. Set `ANTHROPIC_API_KEY` on the server (never in the frontend).
3. Optional: `ANTHROPIC_MODEL` (default `claude-opus-5`; `claude-sonnet-5` or `claude-haiku-4-5` are cheaper per review) and `AI_MAX_CALLS_PER_MINUTE`.

The top bar shows **AI active**; Settings shows how many messages were reviewed. Stage 2 uses
structured outputs (validated with zod), treats chat text strictly as data (prompt‑injection
guarded), blends its verdict with stage 1, and can *clear* false positives (the alert is then
auto‑dismissed with a `novus-ai` history entry). Any API failure or refusal falls back to the
stage‑1 verdict and the status shows **AI degraded**.

## Supabase setup

> **Already done for this deployment:** project **“Novus live”** (`eqlisqcolmmioolagudh`, URL
> `https://eqlisqcolmmioolagudh.supabase.co`) exists with the full schema applied and RLS enabled.
> Only step left: copy its **secret / service_role key** (Dashboard → Project Settings → API Keys)
> into the server's `SUPABASE_SERVICE_ROLE_KEY`, and set `SUPABASE_URL` to the URL above.

For a fresh project:

1. Create a Supabase project.
2. Apply the migration:
   ```bash
   supabase link --project-ref <ref>
   supabase db push                # applies supabase/migrations/*.sql
   ```
   (or paste `supabase/migrations/20260923000000_novus_live_init.sql` into the SQL editor).
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the **server**.

Tables: `live_sessions`, `live_events`, `live_comments`, `viewer_profiles`, `viewer_session_stats`,
`moderation_alerts`, `moderation_actions`, `viewer_flags`, `ai_analyses`, `stream_summaries`, `settings`.
RLS is enabled on every table with **no policies**, so the anon/public key can read nothing — only the
server's service role writes. If Supabase is unreachable at boot, Novus logs it and falls back to memory.

## TikTok integration status

**Live TikTok data:** by the owner's choice, an optional **unofficial, read-only** connector
(`tiktok-live-connector`) follows the accounts listed in Settings and streams each LIVE into Novus
automatically. It is not authorized by TikTok and can break; disable with `TIKTOK_LIVE_CONNECTOR=off`.

**Several accounts at once:** every followed account gets its own *room* (`server/core/Rooms.ts`) —
an independent runtime with its own session, chat, alerts, viewers and post-LIVE report — and all
of them are watched at the same time. The app switches rooms with the account bar at the top; API
calls carry an `X-Novus-Room` header (`?room=` for the realtime stream). The `main` room hosts Demo
LIVE and connector ingestion. Settings are shared by all rooms.

Also implemented: normalized event model, `TikTokAdapter` with the full state machine
(NOT CONNECTED · CONNECTOR AVAILABLE · CONNECTED · LIVE DETECTED · LIVE ENDED · ERROR), a token‑protected
ingestion API for an authorized connector, and manual‑action guidance for every moderator action.

Not implemented (by design): any direct TikTok API call. No undocumented endpoints are used.
The single remaining external dependency is **authorized access to your LIVE's events** (and, for
automated actions, an authorized moderation API). Details and integration points:
**[docs/TIKTOK_INTEGRATION.md](docs/TIKTOK_INTEGRATION.md)**.

## English / French

The whole app switches between English and French with the **EN | FR** switch in the header (also on
the login screen and in Settings); the choice is remembered on the device. Server-generated text is
stored once in English and translated where it is shown (`shared/i18n.ts`), so alerts, reasons,
history and exports read correctly in either language: heuristic and AI explanations are kept in
both languages, moderation actions carry both copies, and PDF/CSV exports take `?lang=en|fr`.

## LIVE history and exports

Every LIVE (followed TikTok accounts and demos) is kept in **Analytics › History**: audience
(peak / average viewers, joins, follows), gifts (total, diamonds, top donors, by gift), chat
activity per minute, questions, topics and moderation. A running LIVE's report is re-saved every
minute, so a server restart keeps the stats up to that point (the LIVE is then shown as
*interrupted*). Each LIVE exports to a **PDF report** (with the full chat transcript as an appendix)
and a **CSV of all messages**:

- `GET /api/history` · `GET /api/history/:sessionId`
- `GET /api/history/:sessionId/report.pdf` · `GET /api/history/:sessionId/messages.csv`

Monitoring runs on the server: closing the app on the phone does not stop it.

## Deployment

Novus is a **stateful, long‑running Node process** (live context in memory + SSE stream). Deploy it
as a container or Node service — not as serverless functions.

**Docker (any host)**

```bash
docker build -t novus-live .
docker run -p 8787:8787 \
  -e APP_ACCESS_TOKEN=change-me-to-a-long-secret \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v novus-data:/app/data \
  novus-live
```

**Railway**

```bash
npm i -g @railway/cli
railway login
railway init                      # create project
railway up                        # builds the Dockerfile
railway variables --set APP_ACCESS_TOKEN=... --set ANTHROPIC_API_KEY=... --set TRUST_PROXY=true
railway domain                    # public HTTPS URL → open on iPhone → Share → Add to Home Screen
```

**Render / Fly.io** — create a Web Service from this repo using the Dockerfile (Render) or
`fly launch --dockerfile Dockerfile && fly secrets set APP_ACCESS_TOKEN=... ANTHROPIC_API_KEY=...` (Fly).
Keep a single instance (the live session state lives in that process); attach a volume at `/app/data`
or configure Supabase for durable history.

HTTPS is required for PWA installation on iPhone (all the hosts above provide it).

## Security notes

- **Secrets stay server‑side.** The browser never receives the Anthropic key, Supabase service role, ingest token or access token (tests assert the state payload contains none of them).
- **Access control:** set `APP_ACCESS_TOKEN` for public deployments. Login is rate‑limited (10/min/IP), compared in constant time, and yields an HMAC‑derived `HttpOnly; SameSite=Strict` (and `Secure` in production) cookie — the token itself is never stored in the browser.
- **CSRF:** SameSite=Strict cookie + mutating requests must be `application/json` (HTML forms cannot send it).
- **Input validation:** every body/param is validated with zod (strict objects, length limits, enum values, https‑only avatar URLs, 64 KB body cap, 200 events per ingest call, connector timestamps clamped).
- **Rate limiting:** per‑IP limits on the API, ingestion and login.
- **Headers:** strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), `nosniff`, `no-referrer`, COOP, restrictive Permissions‑Policy.
- **Prompt injection:** chat text is sent to the model as JSON data inside delimiters with explicit instructions to ignore embedded instructions; model output is schema‑validated and blended with deterministic scores.
- **No fake enforcement:** actions without an authorized platform API are recorded as `manual_required`, never as executed.
- **Least privilege DB:** RLS enabled with no public policies.
- The ingestion endpoint is disabled unless `INGEST_TOKEN` is set.

## Tests

`npm test` runs Vitest suites covering: risk scoring and the analysis contract, repetition and
near‑duplicate detection, flooding, coordinated spam bursts vs. benign echoes, contextual escalation,
trusted/watchlist thresholds and sensitivity presets, alert creation/merging/grouping, moderation
action states (simulated, manual‑required → confirmed, watch, dismiss), stage‑2 AI routing, false‑positive
clearing and failure fallback, the demo generator (determinism, incident coverage, speed scaling,
end‑to‑end detection), the assistant (question clustering EN/FR, answers, trends, sentiment, Catch‑me‑up),
and the HTTP layer (validation, ingest auth, TikTok state machine, access key, rate limiting, full flow).

`npm run smoke` drives the real PWA in Chromium at 390×844 (iPhone) through every tab: demo start,
critical alert surfacing, action, viewer panel, catch‑up, analytics, settings, and checks for
console errors and horizontal overflow.
