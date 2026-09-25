-- Server-only secrets (e.g. the "Send in chat" OAuth tokens of the moderator's TikTok account).
-- Read and written only by the server with the service role; RLS on with no policies,
-- so the anon/authenticated roles can never read them.
create table if not exists public.server_secrets (
  id text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.server_secrets enable row level security;
revoke all on public.server_secrets from anon, authenticated;
