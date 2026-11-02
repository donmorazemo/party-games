-- Matched AI: usage log for the matched-ai server function (per-host hourly limit).
-- Run once in Supabase → SQL Editor. Only the server function (service role) reads or writes it.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_time_idx on public.ai_usage(user_id, created_at);
alter table public.ai_usage enable row level security;   -- no policies: hosts and guests can't read or write it
