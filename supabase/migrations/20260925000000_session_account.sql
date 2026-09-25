-- LIVE history per followed account: each session records the TikTok account it belongs to.
alter table public.live_sessions add column if not exists account text;
create index if not exists live_sessions_account_started on public.live_sessions (account, started_at desc);

-- Backfill sessions recorded before this column existed ("@handle LIVE" titles).
update public.live_sessions
set account = lower(substring(title from '^@([A-Za-z0-9._]+) LIVE$'))
where account is null and source = 'tiktok' and title ~ '^@[A-Za-z0-9._]+ LIVE$';
