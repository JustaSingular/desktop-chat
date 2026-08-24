-- Gives the keepalive workflow something it is allowed to read.
--
-- Free Supabase projects pause after 7 days with no activity, and a paused
-- project means the app is simply down for everyone. .github/workflows/
-- keepalive.yml reads one row from this table on a schedule to reset that
-- clock.
--
-- Everything else in this schema is closed to `anon` on purpose — you have to
-- be signed in to touch profiles, friendships or messages. This table is the
-- single deliberate exception, so it holds nothing but a timestamp. Reading it
-- tells an anonymous caller only that the project is awake.
--
-- Paste into the SQL Editor and run. Safe to re-run.

create table if not exists public.keepalive (
  id        smallint primary key,
  pinged_at timestamptz not null default now(),
  constraint keepalive_single_row check (id = 1)
);

insert into public.keepalive (id) values (1) on conflict (id) do nothing;

alter table public.keepalive enable row level security;

-- Read-only, to everyone. No insert/update/delete policy exists, so the row
-- cannot be changed through the API by anon or by a signed-in user.
drop policy if exists keepalive_read on public.keepalive;
create policy keepalive_read on public.keepalive
  for select to anon, authenticated
  using (true);

grant usage on schema public to anon;
grant select on public.keepalive to anon, authenticated;
