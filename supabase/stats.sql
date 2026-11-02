-- Party Games usage stats — run once in Supabase → SQL Editor (after the Halloween and Matched schemas).
-- 1) Records an approximate region with each vote and each new game: the phone's time zone
--    (e.g. America/Los_Angeles) and language setting (e.g. en-US). No IP addresses, no third parties.
-- 2) Adds admin_usage(): one JSON snapshot for the Stats page, readable only by site admins (public.admins).

-- ---------- Region columns ----------
alter table public.ballots         add column if not exists tz text, add column if not exists locale text;
alter table public.matched_entries add column if not exists tz text, add column if not exists locale text;
alter table public.parties         add column if not exists host_tz text, add column if not exists host_locale text;
alter table public.matched_games   add column if not exists host_tz text, add column if not exists host_locale text;

-- ---------- Halloween: submit_ballot now also takes tz/locale (optional, so older pages keep working) ----------
drop function if exists public.submit_ballot(text, bigint, text, jsonb);
create or replace function public.submit_ballot(p_slug text, p_voter bigint, p_token text, p_picks jsonb,
                                                p_tz text default null, p_locale text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_party parties; v_ballot ballots; k text; val text;
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  if p_token is null or length(p_token) < 16 then raise exception 'Invalid device token'; end if;
  select * into v_party from parties where slug = p_slug;
  if not found then raise exception 'Party not found'; end if;
  if not v_party.voting_open then raise exception 'VOTING_CLOSED'; end if;
  if not exists (select 1 from guests where id = p_voter and party_id = v_party.id) then raise exception 'Unknown guest'; end if;

  select * into v_ballot from ballots where voter_guest_id = p_voter for update;
  if found then
    if v_ballot.token_hash <> v_hash then raise exception 'ALREADY_VOTED'; end if;
  else
    begin
      insert into ballots (party_id, voter_guest_id, token_hash) values (v_party.id, p_voter, v_hash) returning * into v_ballot;
    exception when unique_violation then raise exception 'ALREADY_VOTED';
    end;
  end if;

  for k, val in select key, value from jsonb_each_text(coalesce(p_picks, '{}'::jsonb)) loop
    if not exists (select 1 from awards where id = k::bigint and party_id = v_party.id) then raise exception 'Unknown award'; end if;
    if not exists (select 1 from guests where id = val::bigint and party_id = v_party.id) then raise exception 'Unknown nominee'; end if;
    insert into votes (ballot_id, award_id, nominee_id) values (v_ballot.id, k::bigint, val::bigint)
      on conflict (ballot_id, award_id) do update set nominee_id = excluded.nominee_id;
  end loop;
  update ballots set updated_at = now(), tz = coalesce(left(p_tz, 64), tz), locale = coalesce(left(p_locale, 20), locale)
    where id = v_ballot.id;
end $$;
grant execute on function public.submit_ballot(text, bigint, text, jsonb, text, text) to anon, authenticated;

-- ---------- Matched: matched_submit now also takes tz/locale ----------
drop function if exists public.matched_submit(text, bigint, text, jsonb);
create or replace function public.matched_submit(p_slug text, p_player bigint, p_token text, p_answers jsonb,
                                                 p_tz text default null, p_locale text default null) returns void
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
  update matched_entries set updated_at = now(), tz = coalesce(left(p_tz, 64), tz), locale = coalesce(left(p_locale, 20), locale)
    where id = v_entry.id;
end $$;
grant execute on function public.matched_submit(text, bigint, text, jsonb, text, text) to anon, authenticated;

-- ---------- admin_usage(): everything the Stats page shows, for site admins only ----------
create or replace function public.admin_usage() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  return json_build_object(
    'generated_at', now(),
    'hosts', coalesce((select json_agg(h order by h.last_sign_in_at desc nulls last) from (
        select u.id, u.email, u.created_at, u.last_sign_in_at,
               coalesce(u.raw_app_meta_data ->> 'provider', '') as provider,
               (select count(*) from parties p where p.owner_id = u.id) as halloween_games,
               (select count(*) from matched_games g where g.owner_id = u.id) as matched_games,
               (select count(*) from ai_usage a where a.user_id = u.id) as ai_requests,
               (select max(a.created_at) from ai_usage a where a.user_id = u.id) as ai_last
        from auth.users u) h), '[]'),
    'halloween', coalesce((select json_agg(x order by x.created_at desc) from (
        select p.id, p.name, p.created_at, p.owner_id, p.host_tz, p.host_locale, p.voting_open,
               (select count(*) from awards a where a.party_id = p.id) as questions,
               (select count(*) from guests g where g.party_id = p.id) as invited,
               (select count(*) from ballots b where b.party_id = p.id) as played,
               (select min(b.created_at) from ballots b where b.party_id = p.id) as first_play,
               (select max(b.updated_at) from ballots b where b.party_id = p.id) as last_play,
               coalesce((select json_agg(json_build_object('tz', t.tz, 'locale', t.locale, 'n', t.n)) from
                 (select tz, locale, count(*) as n from ballots b where b.party_id = p.id group by 1, 2) t), '[]') as places
        from parties p) x), '[]'),
    'matched', coalesce((select json_agg(x order by x.created_at desc) from (
        select g.id, g.name, g.created_at, g.owner_id, g.host_tz, g.host_locale, g.answers_open, g.reveal_step,
               (select count(*) from matched_questions q where q.game_id = g.id) as questions,
               (select count(*) from matched_couples c where c.game_id = g.id) as couples,
               (select count(*) from matched_players pl where pl.game_id = g.id) as invited,
               (select count(*) from matched_entries e where e.game_id = g.id) as played,
               (select count(*) from matched_couples c where c.game_id = g.id and
                  (select count(*) from matched_entries e join matched_players pl on pl.id = e.player_id
                   where pl.couple_id = c.id) = 2) as couples_complete,
               (select min(e.created_at) from matched_entries e where e.game_id = g.id) as first_play,
               (select max(e.updated_at) from matched_entries e where e.game_id = g.id) as last_play,
               coalesce((select json_agg(json_build_object('tz', t.tz, 'locale', t.locale, 'n', t.n)) from
                 (select tz, locale, count(*) as n from matched_entries e where e.game_id = g.id group by 1, 2) t), '[]') as places
        from matched_games g) x), '[]'),
    'ai_daily', coalesce((select json_agg(d order by d.day) from (
        select date_trunc('day', created_at)::date as day, count(*) as n from ai_usage
        where created_at > now() - interval '30 days' group by 1) d), '[]')
  );
end $$;
revoke execute on function public.admin_usage() from public, anon;
grant execute on function public.admin_usage() to authenticated;
