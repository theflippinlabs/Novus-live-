# TikTok LIVE integration — status and integration points

NOVUS LIVE is built so that **TikTok is a replaceable input**, not a dependency. The moderation
engine, streamer assistant, analytics and UI only ever see the platform‑independent event model
(`shared/types.ts`). TikTok enters the system in exactly two isolated places:

| Direction | Interface | File |
| --- | --- | --- |
| Events **in** (comments, viewers, gifts, follows, joins, stream start/end) | `TikTokEventSource` (used by `TikTokAdapter`) and the token‑protected ingestion endpoint | `server/platform/TikTokAdapter.ts`, `server/app.ts` (`/api/ingest/*`) |
| Actions **out** (warn, mute, block, report) | `ModerationActionAdapter` | `server/actions/ModerationActionAdapter.ts`, `server/actions/adapters.ts` |

## Ground rules this code follows

- **No invented endpoints.** Novus does not call any TikTok URL. It contains no reverse‑engineered
  protocol, no scraping, no private/undocumented API, and never asks for a TikTok password or session cookie.
- **No fake success.** When there is no authorized API for an action, the action adapter returns
  `manual_required` and the UI shows **MANUAL ACTION REQUIRED** with the exact in‑app steps. The alert
  stays open until the moderator taps **Done in TikTok**; both the recommendation and the confirmation
  are stored in the moderation history (`moderation_actions`).
- At the time of writing we are **not aware of a generally available, publicly documented TikTok API**
  that gives a third‑party app (a) a real‑time stream of LIVE chat comments for a LIVE, or (b) the
  ability to mute/block/report viewers on a moderator's behalf. TikTok's public developer products
  (see <https://developers.tiktok.com>) change over time — check them, and any partner program you have
  access to, before implementing a source. Unofficial community libraries that reverse‑engineer TikTok's
  web client exist; Novus deliberately does **not** bundle or recommend them because they are not
  authorized by TikTok, can break at any time and may violate TikTok's Terms of Service.

## Capability matrix

| Capability | Status | Notes |
| --- | --- | --- |
| Normalized event model (`LiveComment`, `LiveViewer`, `LiveGift`, `LiveFollow`, `LiveJoin`, `LiveModerationEvent`, stream status) | ✅ Implemented | `shared/types.ts`, validated by `shared/schemas.ts` |
| Authorized connector ingestion (`POST /api/ingest/events`, `POST /api/ingest/heartbeat`) | ✅ Implemented | Bearer `INGEST_TOKEN`, rate‑limited, zod‑validated, max 200 events/request, timestamps clamped |
| Integration state machine (NOT CONNECTED → CONNECTOR AVAILABLE → CONNECTED → LIVE DETECTED → LIVE ENDED / ERROR) | ✅ Implemented | `TikTokAdapter.state()`, shown in Settings › TikTok Integration |
| Automatic session start/stop from `stream_status` events + post‑LIVE report | ✅ Implemented | `NovusRuntime.ingestExternal()` |
| Target TikTok account name (which LIVE a connector should follow) | ✅ Implemented | `POST /api/integrations/tiktok/connect` — stored only, no TikTok call |
| Reading LIVE comments directly from TikTok | ⛔ Requires authorized access | Implement `TikTokEventSource` once you have approved access |
| Warn viewer | 🟨 Manual | Novus prepares the exact text to paste in chat |
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
