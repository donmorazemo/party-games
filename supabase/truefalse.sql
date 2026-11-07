-- True or False — run once in Supabase → SQL Editor.
-- One row per question set a host saves. Only the host (or a site admin) can see or change it;
-- there's no guest access at all: the kids just hop, the moderator reads from their phone.
create table if not exists public.tf_games (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  age int not null check (age between 3 and 18),
  topic text not null default '',
  questions jsonb not null default '[]',   -- [{ "statement", "answer": true|false, "level": "easy|medium|hard", "explain" }]
  plays int not null default 0,
  last_played_at timestamptz,
  host_tz text, host_locale text,
  created_at timestamptz not null default now()
);
create index if not exists tf_games_owner_idx on public.tf_games(owner_id);
alter table public.tf_games enable row level security;
drop policy if exists "owner tf games" on public.tf_games;
create policy "owner tf games" on public.tf_games for all to authenticated
  using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
revoke all on public.tf_games from anon;
grant select, insert, update, delete on public.tf_games to authenticated;
