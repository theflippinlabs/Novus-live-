-- LIVE video subtitles: one row per video and language (cues with times, in seconds from the start).
create table if not exists public.live_video_subtitles (
  tenant text not null,
  session_id text not null,
  lang text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant, session_id, lang)
);
-- Server only (service role); no client access.
alter table public.live_video_subtitles enable row level security;
