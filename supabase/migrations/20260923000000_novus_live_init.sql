-- NOVUS LIVE — initial schema
-- All tables have RLS enabled with NO policies: only the server (service role)
-- can read/write. The browser never talks to Supabase directly.

create table if not exists public.live_sessions (
  id text primary key,
  platform text not null check (platform in ('mock', 'tiktok', 'external')),
  source text not null check (source in ('demo', 'tiktok', 'external')),
  title text not null default '',
  status text not null check (status in ('idle', 'live', 'ended')),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.live_events (
  id text primary key,
  session_id text not null references public.live_sessions(id) on delete cascade,
  platform text not null,
  type text not null check (type in ('comment','viewer_count','gift','follow','join','moderation','stream_status')),
  payload jsonb not null,
  occurred_at timestamptz not null
);
create index if not exists live_events_session_time on public.live_events (session_id, occurred_at);

create table if not exists public.viewer_profiles (
  id text primary key,
  username text not null,
  display_name text,
  avatar_url text,
  first_seen timestamptz not null,
  last_seen timestamptz not null
);
create index if not exists viewer_profiles_username on public.viewer_profiles (lower(username));

create table if not exists public.live_comments (
  id text primary key,
  session_id text not null references public.live_sessions(id) on delete cascade,
  viewer_id text not null,
  username text not null,
  text text not null,
  language text,
  risk_score smallint not null check (risk_score between 0 and 100),
  severity text not null check (severity in ('normal','watch','warning','critical')),
  categories text[] not null default '{}',
  reasons text[] not null default '{}',
  stage text not null check (stage in ('heuristic','ai')),
  occurred_at timestamptz not null
);
create index if not exists live_comments_session_time on public.live_comments (session_id, occurred_at);
create index if not exists live_comments_viewer on public.live_comments (viewer_id, occurred_at);
create index if not exists live_comments_severity on public.live_comments (session_id, severity) where severity <> 'normal';

create table if not exists public.viewer_session_stats (
  session_id text not null references public.live_sessions(id) on delete cascade,
  viewer_id text not null,
  messages integer not null default 0,
  warnings integer not null default 0,
  alerts integer not null default 0,
  max_risk smallint not null default 0,
  categories jsonb not null default '{}'::jsonb,
  flag text check (flag in ('trusted','watchlist','ignored')),
  updated_at timestamptz not null default now(),
  primary key (session_id, viewer_id)
);

create table if not exists public.moderation_alerts (
  id text primary key,
  session_id text not null references public.live_sessions(id) on delete cascade,
  viewer_id text not null,
  username text not null,
  comment_id text not null,
  text text not null,
  risk_score smallint not null check (risk_score between 0 and 100),
  severity text not null check (severity in ('normal','watch','warning','critical')),
  categories text[] not null default '{}',
  reasons text[] not null default '{}',
  explanation text not null default '',
  recommended_action text not null check (recommended_action in ('none','watch','warn','mute','block','report')),
  confidence real not null,
  status text not null check (status in ('open','watching','resolved','dismissed')),
  occurrences integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists moderation_alerts_open on public.moderation_alerts (session_id, status, severity);

create table if not exists public.moderation_actions (
  id text primary key,
  session_id text not null references public.live_sessions(id) on delete cascade,
  alert_id text references public.moderation_alerts(id) on delete set null,
  viewer_id text not null,
  username text not null,
  action text not null check (action in ('watch','warn','mute','block','report','dismiss')),
  status text not null check (status in ('executed','simulated','manual_required','recorded','failed')),
  adapter text not null,
  message text not null,
  instructions text[],
  note text,
  response_time_ms integer,
  performed_at timestamptz not null,
  confirmed_at timestamptz
);
create index if not exists moderation_actions_session on public.moderation_actions (session_id, performed_at);

create table if not exists public.viewer_flags (
  username text primary key,
  flag text not null check (flag in ('trusted','watchlist','ignored')),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_analyses (
  id bigint generated always as identity primary key,
  session_id text not null references public.live_sessions(id) on delete cascade,
  comment_id text not null,
  provider text not null,
  model text,
  risk_score smallint not null,
  severity text not null,
  categories text[] not null default '{}',
  explanation text not null,
  recommended_action text not null,
  confidence real not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_analyses_comment on public.ai_analyses (comment_id);

create table if not exists public.stream_summaries (
  session_id text primary key references public.live_sessions(id) on delete cascade,
  generated_at timestamptz not null,
  analytics jsonb not null,
  markdown text not null
);

create table if not exists public.settings (
  id text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.live_sessions enable row level security;
alter table public.live_events enable row level security;
alter table public.viewer_profiles enable row level security;
alter table public.live_comments enable row level security;
alter table public.viewer_session_stats enable row level security;
alter table public.moderation_alerts enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.viewer_flags enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.stream_summaries enable row level security;
alter table public.settings enable row level security;
