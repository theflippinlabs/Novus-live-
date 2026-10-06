-- LIVE safety events (TikTok warnings, restrictions, suspensions, removed comments…) are
-- stored as LIVE events of type 'safety' in live_events: same table, same row-level security
-- (server-only access), same idempotent upsert by event id (a resent event is not added twice).
-- The normalized event, its context snapshot and its analysis are in `payload`.
-- This small partial index keeps reading a LIVE's safety events instant.
create index concurrently if not exists live_events_safety on public.live_events (session_id, occurred_at) where type = 'safety';
