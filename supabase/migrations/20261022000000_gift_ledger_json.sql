-- The donor ledger in one call: a single JSON value (one row per viewer, LIVE and gift), so the
-- server no longer reads it 1,000 rows at a time (each page re-sorted the whole ledger, which
-- stopped the donor rankings from loading once a space had tens of thousands of rows).
create or replace function public.gift_ledger_json(p_tenant text, p_since timestamptz default null, p_account text default null)
returns json
language sql
stable
set search_path = public
as $$
  select coalesce(json_agg(json_build_array(
    d.viewer_id, d.username, d.display_name, d.avatar_url, s.account, d.session_id, d.gift_name, d.gifts, d.diamonds,
    (extract(epoch from d.first_at) * 1000)::bigint, (extract(epoch from d.last_at) * 1000)::bigint
  )), '[]'::json)
  from public.donor_gifts d
  join public.live_sessions s on s.id = d.session_id
  where s.tenant = p_tenant
    and s.source <> 'demo'
    and (p_since is null or d.last_at >= p_since)
    and (p_account is null or s.account = p_account)
$$;

revoke all on function public.gift_ledger_json(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.gift_ledger_json(text, timestamptz, text) to service_role;
