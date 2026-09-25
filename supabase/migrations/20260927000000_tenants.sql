-- Separate spaces per access key (owner + testers): each has its own followed accounts,
-- settings, viewer flags, "Send in chat" connection and LIVE history.
-- Everything recorded before this migration belongs to the owner.
alter table public.live_sessions add column if not exists tenant text not null default 'owner';
create index if not exists live_sessions_tenant_started on public.live_sessions (tenant, started_at desc);

alter table public.viewer_flags add column if not exists tenant text not null default 'owner';
alter table public.viewer_flags drop constraint if exists viewer_flags_pkey;
alter table public.viewer_flags add constraint viewer_flags_pkey primary key (tenant, username);
