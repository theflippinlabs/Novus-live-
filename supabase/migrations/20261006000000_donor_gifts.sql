-- Donor directory, fast: gifts summed per LIVE, donor and gift type, kept up to date by a
-- trigger as gifts arrive. Reading it no longer scans the 1.6M+ LIVE events (that took ~12 s).
create table if not exists public.donor_gifts (
  session_id text not null,
  viewer_id text not null,
  gift_name text not null,
  username text,
  display_name text,
  avatar_url text,
  gifts bigint not null default 0,
  diamonds bigint not null default 0,
  first_at timestamptz not null,
  last_at timestamptz not null,
  primary key (session_id, viewer_id, gift_name)
);
alter table public.donor_gifts enable row level security;

create or replace function public.donor_gifts_add() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payload->'viewer'->>'id' is null then
    return null;
  end if;
  insert into public.donor_gifts as d (session_id, viewer_id, gift_name, username, display_name, avatar_url, gifts, diamonds, first_at, last_at)
  values (
    new.session_id,
    new.payload->'viewer'->>'id',
    coalesce(new.payload->>'giftName', '?'),
    new.payload->'viewer'->>'username',
    new.payload->'viewer'->>'displayName',
    new.payload->'viewer'->>'avatarUrl',
    coalesce((new.payload->>'count')::bigint, 1),
    (coalesce((new.payload->>'value')::numeric, 0) * coalesce((new.payload->>'count')::numeric, 1))::bigint,
    new.occurred_at,
    new.occurred_at
  )
  on conflict (session_id, viewer_id, gift_name) do update set
    username = coalesce(excluded.username, d.username),
    display_name = coalesce(excluded.display_name, d.display_name),
    avatar_url = coalesce(excluded.avatar_url, d.avatar_url),
    gifts = d.gifts + excluded.gifts,
    diamonds = d.diamonds + excluded.diamonds,
    first_at = least(d.first_at, excluded.first_at),
    last_at = greatest(d.last_at, excluded.last_at);
  return null;
end;
$$;

-- Adds the gifts of [p_from, p_to) to the summary (fills it with the gifts recorded before
-- the trigger existed; applied in date chunks on a large base).
create or replace function public.donor_gifts_backfill(p_from timestamptz, p_to timestamptz) returns bigint
language sql
set search_path = public
as $$
  with ins as (
    insert into public.donor_gifts as d (session_id, viewer_id, gift_name, username, display_name, avatar_url, gifts, diamonds, first_at, last_at)
    select
      e.session_id,
      e.payload->'viewer'->>'id',
      coalesce(e.payload->>'giftName', '?'),
      max(e.payload->'viewer'->>'username'),
      max(e.payload->'viewer'->>'displayName'),
      max(e.payload->'viewer'->>'avatarUrl'),
      sum(coalesce((e.payload->>'count')::bigint, 1)),
      sum(coalesce((e.payload->>'value')::numeric, 0) * coalesce((e.payload->>'count')::numeric, 1))::bigint,
      min(e.occurred_at),
      max(e.occurred_at)
    from public.live_events e
    where e.type = 'gift' and e.occurred_at >= p_from and e.occurred_at < p_to and e.payload->'viewer'->>'id' is not null
    group by 1, 2, 3
    on conflict (session_id, viewer_id, gift_name) do update set
      gifts = d.gifts + excluded.gifts,
      diamonds = d.diamonds + excluded.diamonds,
      first_at = least(d.first_at, excluded.first_at),
      last_at = greatest(d.last_at, excluded.last_at)
    returning 1
  )
  select count(*) from ins
$$;

-- Only new rows count: a re-sent event is an update of the same row and is not added twice.
-- Created with the backfill in one transaction: inserts wait on the trigger's lock, so no gift
-- is missed or counted twice.
drop trigger if exists live_events_donor_gifts on public.live_events;
create trigger live_events_donor_gifts after insert on public.live_events
  for each row when (new.type = 'gift') execute function public.donor_gifts_add();
truncate public.donor_gifts;
select public.donor_gifts_backfill('-infinity', 'infinity');

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
  select d.viewer_id, d.username, d.display_name, d.avatar_url, s.account, d.session_id, d.gift_name, d.gifts, d.diamonds, d.first_at, d.last_at
  from public.donor_gifts d
  join public.live_sessions s on s.id = d.session_id
  where s.tenant = p_tenant
    and s.source <> 'demo'
    and (p_since is null or d.last_at >= p_since)
$$;
