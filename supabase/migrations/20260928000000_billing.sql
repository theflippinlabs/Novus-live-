-- Billing: workspaces (one per customer space), usage counters, Stripe webhook
-- idempotency, billing/conversion events and admin configuration.
-- Additive only: no existing table is changed. Service role only (RLS on, no policies).
--
-- Down (manual, destroys billing data):
--   drop table if exists public.billing_config, public.billing_events,
--     public.stripe_events, public.usage_counters, public.workspaces;

create table if not exists public.workspaces (
  id text primary key,
  data jsonb not null,
  status text not null,
  plan text not null,
  billing_cycle text not null default 'month',
  stripe_customer_id text,
  stripe_subscription_id text,
  founding boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspaces_stripe_customer on public.workspaces (stripe_customer_id);
create index if not exists workspaces_stripe_subscription on public.workspaces (stripe_subscription_id);

create table if not exists public.usage_counters (
  workspace_id text not null,
  period text not null,
  metric text not null,
  value double precision not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, period, metric)
);
create index if not exists usage_counters_period on public.usage_counters (period);

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  id bigint generated always as identity primary key,
  type text not null,
  workspace_id text,
  plan text,
  billing_cycle text,
  source text,
  anon_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists billing_events_created on public.billing_events (created_at);
create index if not exists billing_events_type_created on public.billing_events (type, created_at);

create table if not exists public.billing_config (
  id text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;
alter table public.usage_counters enable row level security;
alter table public.stripe_events enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_config enable row level security;
revoke all on public.workspaces, public.usage_counters, public.stripe_events, public.billing_events, public.billing_config from anon, authenticated;
