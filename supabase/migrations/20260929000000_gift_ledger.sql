-- Donor directory: gifts per donor, LIVE, followed account and gift type, for one space.
-- Read by the server only (service role); demos are left out.
create or replace function public.gift_ledger(p_tenant text, p_since timestamptz default null)
returns table (
  viewer_id text,
  username text,
  display_name text,
  avatar_url text,
  account text,
  session_id text,
  gift_name text,
  gifts bigint,
  diamonds bigint,
  first_at timestamptz,
  last_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    e.payload->'viewer'->>'id',
    max(e.payload->'viewer'->>'username'),
    max(e.payload->'viewer'->>'displayName'),
    max(e.payload->'viewer'->>'avatarUrl'),
    s.account,
    e.session_id,
    coalesce(e.payload->>'giftName', '?'),
    sum(coalesce((e.payload->>'count')::bigint, 1)),
    sum(coalesce((e.payload->>'value')::numeric, 0) * coalesce((e.payload->>'count')::numeric, 1))::bigint,
    min(e.occurred_at),
    max(e.occurred_at)
  from public.live_events e
  join public.live_sessions s on s.id = e.session_id
  where e.type = 'gift'
    and s.tenant = p_tenant
    and s.source <> 'demo'
    and (p_since is null or e.occurred_at >= p_since)
    and e.payload->'viewer'->>'id' is not null
  group by e.payload->'viewer'->>'id', s.account, e.session_id, coalesce(e.payload->>'giftName', '?')
$$;

revoke all on function public.gift_ledger(text, timestamptz) from public, anon, authenticated;
create index if not exists live_events_type_time on public.live_events (type, occurred_at);
