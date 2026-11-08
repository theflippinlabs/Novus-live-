-- LIVE safety events are stored as live_events of type 'safety' (20261007000000), but the
-- type check was never widened: every batch holding one was rejected (gifts, joins and
-- viewer counts of that batch included).
alter table public.live_events drop constraint if exists live_events_type_check;
alter table public.live_events add constraint live_events_type_check
  check (type in ('comment','viewer_count','gift','follow','join','moderation','stream_status','safety')) not valid;
alter table public.live_events validate constraint live_events_type_check;
