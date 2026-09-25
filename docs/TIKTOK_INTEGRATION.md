# TikTok LIVE integration — status and integration points

NOVUS LIVE is built so that **TikTok is a replaceable input**, not a dependency. The moderation
engine, streamer assistant, analytics and UI only ever see the platform‑independent event model
(`shared/types.ts`). TikTok enters the system only in these isolated places:

| Direction | Interface | File |
| --- | --- | --- |
| Events **in** (comments, viewers, gifts, follows, joins, stream start/end) | `TikTokEventSource` (used by `TikTokAdapter`), the token‑protected ingestion endpoint, and the optional unofficial `TikTokLiveWatcher` | `server/platform/TikTokAdapter.ts`, `server/app.ts` (`/api/ingest/*`), `server/platform/TikTokLiveWatcher.ts` |
| Actions **out** (warn, mute, block, report) | `ModerationActionAdapter` | `server/actions/ModerationActionAdapter.ts`, `server/actions/adapters.ts` |

## Ground rules this code follows

- **No invented endpoints.** Novus' own code calls no TikTok URL and never asks for a TikTok password
  or session cookie. The only exception is the optional unofficial live connector below, which the
  owner explicitly chose to enable and which can be switched off.
- **No fake success.** When there is no authorized API for an action, the action adapter returns
  `manual_required` and the UI shows **MANUAL ACTION REQUIRED** with the exact in‑app steps. The alert
  stays open until the moderator taps **Done in TikTok**; both the recommendation and the confirmation
  are stored in the moderation history (`moderation_actions`).
- At the time of writing we are **not aware of a generally available, publicly documented TikTok API**
  that gives a third‑party app (a) a real‑time stream of LIVE chat comments for a LIVE, or (b) the
  ability to mute/block/report viewers on a moderator's behalf. TikTok's public developer products
  (see <https://developers.tiktok.com>) change over time — check them, and any partner program you have
  access to, before implementing a source. Unofficial community libraries that reverse‑engineer TikTok's
  web client exist; they are not authorized by TikTok, can break at any time and may violate TikTok's
  Terms of Service. Novus includes one only as an opt‑in, read‑only source (next section).

## Unofficial live connector (enabled by the owner)

At the owner's explicit request, Novus also ships an **optional, read-only** source based on the
community library [`tiktok-live-connector`](https://www.npmjs.com/package/tiktok-live-connector)
(`server/platform/TikTokLiveWatcher.ts`, mapping in `server/platform/tiktokMapping.ts`).

- **What it does:** follows the TikTok account set in *Settings › TikTok Integration*, checks every
  minute whether it is LIVE, joins automatically, and streams comments, gifts, joins, follows and
  viewer counts into Novus. When the LIVE ends, the session closes and its report is generated.
- **What it never does:** log in, ask for a password or cookie, post messages, or perform any
  moderation action. Mute / block / report stay **MANUAL ACTION REQUIRED**.
- **Risks (accepted by the owner):** the library reverse-engineers TikTok's web client and relies
  on a third-party signing service (Euler Stream). It is **not authorized by TikTok**, may conflict
  with TikTok's Terms of Service, and can stop working at any time. An optional `EULER_API_KEY`
  raises the signing service's rate limits.
- **Turn it off:** set `TIKTOK_LIVE_CONNECTOR=off` on the server.

### Optional: "Send in chat" (Euler Stream OAuth)

- The moderator connects their own TikTok account once (Settings › TikTok Integration ›
  *Send in chat*) through Euler Stream's OAuth page (scope `webcast:chat`). Novus never sees the
  TikTok password; the OAuth tokens are stored server-side only (`server_secrets`, service role).
- A **Send in chat** button then appears next to each suggested warning, in a followed account's
  room while it is LIVE. One tap posts that text in the LIVE chat as the moderator
  (`POST https://tiktok.eulerstream.com/webcast/rooms/{room_id}/chat`). Nothing is sent
  automatically.
- If Euler refuses (401/403: the plan does not include chat sending) or the account is not LIVE,
  Novus says so and nothing is marked as sent. A sent warning resolves its alert.
- Server variables: `EULER_API_KEY`, `EULER_CLIENT_ID`, `EULER_CLIENT_SECRET`, `PUBLIC_URL`,
  optional `EULER_OAUTH_AUTHORIZE_URL`. Same risks as the connector: unofficial, not authorized
  by TikTok. Mute / block / report stay manual.

## Capability matrix

| Capability | Status | Notes |
| --- | --- | --- |
| Normalized event model (`LiveComment`, `LiveViewer`, `LiveGift`, `LiveFollow`, `LiveJoin`, `LiveModerationEvent`, stream status) | ✅ Implemented | `shared/types.ts`, validated by `shared/schemas.ts` |
| Authorized connector ingestion (`POST /api/ingest/events`, `POST /api/ingest/heartbeat`) | ✅ Implemented | Bearer `INGEST_TOKEN`, rate‑limited, zod‑validated, max 200 events/request, timestamps clamped |
| Integration state machine (NOT CONNECTED → CONNECTOR AVAILABLE → CONNECTED → LIVE DETECTED → LIVE ENDED / ERROR) | ✅ Implemented | `TikTokAdapter.state()`, shown in Settings › TikTok Integration |
| Automatic session start/stop from `stream_status` events + post‑LIVE report | ✅ Implemented | `NovusRuntime.ingestExternal()` |
| Target TikTok account name (which LIVE a connector should follow) | ✅ Implemented | `POST /api/integrations/tiktok/connect` — stored only, no TikTok call |
| Reading LIVE comments, gifts, joins, follows, viewers | 🟧 Via the unofficial connector (opt-in) | Not authorized by TikTok; for an approved source implement `TikTokEventSource` |
| Warn viewer | 🟨 Manual, or one tap | Novus prepares the exact text; optional "Send in chat" posts it via Euler OAuth |
| Mute viewer | 🟨 Manual | Exact in‑app steps; confirmation logged |
| Block / remove viewer | 🟨 Manual | Exact in‑app steps; confirmation logged |
| Report viewer | 🟨 Manual | Suggested report category from Novus' reasons |
| Automated platform actions | ⛔ Not available | Requires an authorized moderation API → new `ModerationActionAdapter` |

## Option A — push events from an authorized connector (available today)

Any process that has **legitimate** access to your LIVE's events (an approved TikTok partner
integration, a TikTok‑provided tool, or your own compliant bridge) can push normalized events:

```bash
# server
INGEST_TOKEN=$(openssl rand -hex 32)   # set the same value on the connector

# connector → Novus
curl -X POST https://novus.example.com/api/ingest/heartbeat \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" -d '{}'

curl -X POST https://novus.example.com/api/ingest/events \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -H "X-Novus-Platform: tiktok" \
  -d '{"events":[
        {"type":"stream_status","status":"started","title":"Launch night"},
        {"type":"comment","viewer":{"id":"123","username":"someone"},"text":"hello!"},
        {"type":"viewer_count","count":412},
        {"type":"gift","viewer":{"id":"123","username":"someone"},"giftName":"Rose","count":3}
      ]}'
```

Event shapes (all fields validated server‑side; `id` and `timestamp` are optional):

| `type` | Required fields |
| --- | --- |
| `comment` | `viewer {id, username, displayName?, avatarUrl? (https)}`, `text` (1–500 chars) |
| `viewer_count` | `count` |
| `gift` | `viewer`, `giftName`, `count`, `value?` |
| `follow` / `join` | `viewer` |
| `moderation` | `action`, `viewer?`, `detail?` |
| `stream_status` | `status: "started" \| "ended"`, `title?` |

A runnable example that exercises this contract (without talking to TikTok):
`NOVUS_URL=http://localhost:8787 INGEST_TOKEN=… node scripts/connector-example.mjs`

## Option B — implement `TikTokEventSource` inside the server

When you have approved programmatic access, implement:

```ts
export interface TikTokEventSource {
  readonly id: string;
  connect(username: string, emit: (event: Omit<LiveEvent, "sessionId">) => void): Promise<void>;
  disconnect(): Promise<void>;
}
```

and pass it to `new TikTokAdapter(connectorConfigured, source)` in `server/index.ts`. Map each
platform payload to a normalized `LiveEvent` inside the source — nothing else in the app changes.
Keep credentials in server environment variables only.

## Automated actions (when an authorized moderation API exists)

Create a new adapter implementing `ModerationActionAdapter` (`warn`, `mute`, `block`, `report`,
`dismiss`, `watch`), return `status: "executed"` **only** when the platform confirms the action, and
return `failed` with the platform's error otherwise. Select it in `NovusRuntime.actionAdapter()` for
TikTok sessions. The UI, alert queue, history and analytics already handle `executed` results.

## The single remaining external dependency

Everything in Novus is complete and testable today via Demo LIVE and the connector endpoint.
The only missing piece for live TikTok data is **authorized access to your LIVE's events**
(and, for automated actions, an authorized moderation API). Until then, Novus runs alongside
TikTok as a co‑pilot: it analyzes what a connector sends, and tells the moderator exactly what to do in the TikTok app.
