-- Matched (couples game) — run once in Supabase → SQL Editor.
-- Uses public.is_admin() and public.admins from the Halloween schema (same Supabase project).
-- Guests never touch these tables directly; they go through the matched_* functions below.

-- ---------- Tables ----------
create table if not exists public.matched_games (
  id bigint generated always as identity primary key,
  slug text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  subtitle text not null default '',
  answers_open boolean not null default true,
  -- null = reveal not started; 0 = reveal started (intro); k = first k questions revealed;
  -- (number of questions + 1) = final leaderboard
  reveal_step int,
  created_at timestamptz not null default now()
);
create index if not exists matched_games_owner_idx on public.matched_games(owner_id);

create table if not exists public.matched_couples (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.matched_games(id) on delete cascade,
  sort int not null default 0
);
create table if not exists public.matched_players (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.matched_games(id) on delete cascade,
  couple_id bigint not null references public.matched_couples(id) on delete cascade,
  name text not null,
  sort int not null default 0
);
create table if not exists public.matched_questions (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.matched_games(id) on delete cascade,
  prompt text not null,
  options jsonb not null default '[]',      -- array of option strings
  sort int not null default 0
);
-- One entry per player, tied to the phone that submitted it (token_hash).
create table if not exists public.matched_entries (
  id bigint generated always as identity primary key,
  game_id bigint not null references public.matched_games(id) on delete cascade,
  player_id bigint not null unique references public.matched_players(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- own = the player's own answer, guess = what they think their partner answered (option indexes)
create table if not exists public.matched_answers (
  id bigint generated always as identity primary key,
  entry_id bigint not null references public.matched_entries(id) on delete cascade,
  question_id bigint not null references public.matched_questions(id) on delete cascade,
  own int not null,
  guess int not null,
  unique (entry_id, question_id)
);

-- ---------- Security: owner (or site admin) manages; guests use functions ----------
create or replace function public.owns_matched(p_game bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.matched_games where id = p_game and owner_id = auth.uid()) or public.is_admin()
$$;

alter table public.matched_games     enable row level security;
alter table public.matched_couples   enable row level security;
alter table public.matched_players   enable row level security;
alter table public.matched_questions enable row level security;
alter table public.matched_entries   enable row level security;
alter table public.matched_answers   enable row level security;

drop policy if exists "owner games" on public.matched_games;
drop policy if exists "owner couples" on public.matched_couples;
drop policy if exists "owner players" on public.matched_players;
drop policy if exists "owner questions" on public.matched_questions;
drop policy if exists "owner entries" on public.matched_entries;
drop policy if exists "owner answers" on public.matched_answers;
create policy "owner games" on public.matched_games for all to authenticated
  using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
create policy "owner couples" on public.matched_couples for all to authenticated
  using (public.owns_matched(game_id)) with check (public.owns_matched(game_id));
create policy "owner players" on public.matched_players for all to authenticated
  using (public.owns_matched(game_id)) with check (public.owns_matched(game_id));
create policy "owner questions" on public.matched_questions for all to authenticated
  using (public.owns_matched(game_id)) with check (public.owns_matched(game_id));
create policy "owner entries" on public.matched_entries for all to authenticated
  using (public.owns_matched(game_id)) with check (public.owns_matched(game_id));
create policy "owner answers" on public.matched_answers for all to authenticated
  using (exists (select 1 from public.matched_entries e where e.id = entry_id and public.owns_matched(e.game_id)))
  with check (exists (select 1 from public.matched_entries e where e.id = entry_id and public.owns_matched(e.game_id)));

grant select, insert, update, delete on public.matched_games, public.matched_couples, public.matched_players,
  public.matched_questions, public.matched_entries, public.matched_answers to authenticated;
grant execute on function public.owns_matched(bigint) to authenticated;

-- ---------- Guest functions ----------
create or replace function public.matched_get_game(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'game', json_build_object('id', g.id, 'slug', g.slug, 'name', g.name, 'subtitle', g.subtitle,
                              'answers_open', g.answers_open, 'reveal_step', g.reveal_step),
    'questions', coalesce((select json_agg(q order by q.sort, q.id) from
        (select id, prompt, options, sort from matched_questions where game_id = g.id) q), '[]'),
    'couples', coalesce((select json_agg(c order by c.sort, c.id) from
        (select c.id, c.sort, coalesce((select json_agg(p order by p.sort, p.id) from
            (select id, name, sort from matched_players where couple_id = c.id) p), '[]') as players
         from matched_couples c where c.game_id = g.id) c), '[]'),
    'submitted', coalesce((select json_agg(player_id) from matched_entries where game_id = g.id), '[]'))
  from matched_games g where g.slug = p_slug
$$;

create or replace function public.matched_get_mine(p_slug text, p_player bigint, p_token text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(a.question_id, json_build_object('own', a.own, 'guess', a.guess))
                  filter (where a.question_id is not null), '{}')
  from matched_entries e join matched_games g on g.id = e.game_id
  left join matched_answers a on a.entry_id = e.id
  where g.slug = p_slug and e.player_id = p_player
    and e.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  having count(e.id) > 0
$$;

-- p_answers: { "<question id>": { "own": <option index>, "guess": <option index> }, ... }
create or replace function public.matched_submit(p_slug text, p_player bigint, p_token text, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_game matched_games; v_entry matched_entries; k text; val jsonb; v_n int; v_own int; v_guess int;
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  if p_token is null or length(p_token) < 16 then raise exception 'Invalid device token'; end if;
  select * into v_game from matched_games where slug = p_slug;
  if not found then raise exception 'Game not found'; end if;
  if not v_game.answers_open or v_game.reveal_step is not null then raise exception 'ANSWERS_CLOSED'; end if;
  if not exists (select 1 from matched_players where id = p_player and game_id = v_game.id) then raise exception 'Unknown player'; end if;

  select * into v_entry from matched_entries where player_id = p_player for update;
  if found then
    if v_entry.token_hash <> v_hash then raise exception 'ALREADY_ANSWERED'; end if;
  else
    begin
      insert into matched_entries (game_id, player_id, token_hash) values (v_game.id, p_player, v_hash) returning * into v_entry;
    exception when unique_violation then raise exception 'ALREADY_ANSWERED';
    end;
  end if;

  for k, val in select key, value from jsonb_each(coalesce(p_answers, '{}'::jsonb)) loop
    select jsonb_array_length(options) into v_n from matched_questions where id = k::bigint and game_id = v_game.id;
    if v_n is null then raise exception 'Unknown question'; end if;
    v_own := (val ->> 'own')::int; v_guess := (val ->> 'guess')::int;
    if v_own is null or v_guess is null or v_own < 0 or v_guess < 0 or v_own >= v_n or v_guess >= v_n then
      raise exception 'Invalid answer';
    end if;
    insert into matched_answers (entry_id, question_id, own, guess) values (v_entry.id, k::bigint, v_own, v_guess)
      on conflict (entry_id, question_id) do update set own = excluded.own, guess = excluded.guess;
  end loop;
  update matched_entries set updated_at = now() where id = v_entry.id;
end $$;

-- Answers are only visible for questions the host has revealed (first reveal_step questions).
create or replace function public.matched_results(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  with g as (select * from matched_games where slug = p_slug),
  q as (select mq.id, row_number() over (order by mq.sort, mq.id) as n
        from matched_questions mq join g on mq.game_id = g.id)
  select json_build_object(
    'reveal_step', g.reveal_step,
    'question_count', (select count(*) from q),
    'submitted', (select count(*) from matched_entries e where e.game_id = g.id),
    'answers', coalesce((select json_agg(json_build_object('question_id', a.question_id, 'player_id', e.player_id,
                                                           'own', a.own, 'guess', a.guess))
        from matched_answers a join matched_entries e on e.id = a.entry_id join q on q.id = a.question_id
        where e.game_id = g.id and g.reveal_step is not null and q.n <= g.reveal_step), '[]'))
  from g
$$;

grant execute on function public.matched_get_game(text), public.matched_get_mine(text, bigint, text),
  public.matched_submit(text, bigint, text, jsonb), public.matched_results(text) to anon, authenticated;
