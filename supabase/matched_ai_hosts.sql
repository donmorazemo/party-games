-- Matched AI: only approved hosts can use the ✨ AI buttons (they use the site owner's OpenRouter key).
-- Run once in Supabase → SQL Editor. Put your own email in the insert below (this repo is public,
-- so the real address isn't stored here). Add more rows to approve more hosts; delete a row to revoke.
create table if not exists public.ai_hosts ( email text primary key check (email = lower(email)) );
insert into public.ai_hosts (email) values (lower('YOUR-EMAIL@example.com')) on conflict do nothing;
alter table public.ai_hosts enable row level security;   -- no policies: only the server and the function below read it

-- Lets the host page ask "can I use AI?" without seeing the list.
create or replace function public.can_use_ai() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ai_hosts where email = lower(auth.jwt() ->> 'email'))
$$;
revoke execute on function public.can_use_ai() from public, anon;
grant execute on function public.can_use_ai() to authenticated;
