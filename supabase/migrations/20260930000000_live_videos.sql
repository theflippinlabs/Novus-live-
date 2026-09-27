-- LIVE video (option): one row per recorded LIVE, pieces in the private "live-videos" bucket.
create table if not exists public.live_videos (
  tenant text not null,
  session_id text not null,
  data jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (tenant, session_id)
);
create index if not exists live_videos_expires_idx on public.live_videos (expires_at);
-- Server only (service role); no client access.
alter table public.live_videos enable row level security;

-- Private bucket: only the server writes; viewers get short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('live-videos', 'live-videos', false, 104857600, array['video/mp2t'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
