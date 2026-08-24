-- desktop chat :: initial schema
-- Paste this whole file into the Supabase SQL Editor and run it.
-- Safe to re-run.

-- ---------------------------------------------------------------- profiles --
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  code         text not null unique,
  display_name text not null,
  created_at   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

-- 8 chars from a look-alike-free alphabet, formatted ABCD-1234.
create or replace function public.gen_friend_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    candidate := substr(candidate, 1, 4) || '-' || substr(candidate, 5, 4);
    exit when not exists (select 1 from public.profiles where code = candidate);
  end loop;
  return candidate;
end;
$$;

-- Every new (anonymous) auth user automatically gets a profile + friend code.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c text;
begin
  c := public.gen_friend_code();
  insert into public.profiles (id, code, display_name)
  values (new.id, c, 'friend ' || split_part(c, '-', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The friend code and id are immutable; only the display name is yours to change.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  new.id         := old.id;
  new.code       := old.code;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ------------------------------------------------------------ friendships --
-- One row per pair, stored with the smaller uuid first so it cannot duplicate.
create table if not exists public.friendships (
  user_a     uuid not null references public.profiles(id) on delete cascade,
  user_b     uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendships_ordered check (user_a < user_b)
);

-- security definer so RLS policies can call it without recursing into the table
create or replace function public.are_friends(u1 uuid, u2 uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships
    where user_a = least(u1, u2) and user_b = greatest(u1, u2)
  );
$$;

-- --------------------------------------------------------------- messages --
create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);
create index if not exists messages_pair_idx      on public.messages (sender_id, recipient_id, created_at desc);

-- A message is a fact: once sent, only read_at may change.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  new.id           := old.id;
  new.sender_id    := old.sender_id;
  new.recipient_id := old.recipient_id;
  new.body         := old.body;
  new.created_at   := old.created_at;
  return new;
end;
$$;

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard
  before update on public.messages
  for each row execute function public.guard_message_update();

-- -------------------------------------------------------------------- RLS --
alter table public.profiles    enable row level security;
alter table public.friendships enable row level security;
alter table public.messages    enable row level security;

-- profiles: yourself, and people you are actually friends with. Nobody can
-- enumerate the table to harvest friend codes.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.are_friends((select auth.uid()), id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- friendships: readable and removable by either side. Inserts go through
-- add_friend() only, so a code lookup is the single way in.
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- messages: only the two people in the conversation, and you can only send to
-- an existing friend. Recipients mark read; the guard trigger blocks edits.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.are_friends((select auth.uid()), recipient_id)
  );

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- ----------------------------------------------------------------- grants --
-- Supabase grants these by default; stating them keeps the schema portable and
-- makes the intent explicit. Note what is absent: no insert on friendships
-- (add_friend only), no insert on profiles (the signup trigger only), and
-- nothing at all for anon — you must be signed in.
grant usage on schema public to anon, authenticated;
grant select, update         on public.profiles    to authenticated;
grant select, delete         on public.friendships to authenticated;
grant select, insert, update on public.messages    to authenticated;

revoke all on function public.gen_friend_code() from public, anon, authenticated;

-- -------------------------------------------------------------- add_friend --
-- Instant add: knowing the code is the permission. Returns the new friend.
create or replace function public.add_friend(friend_code text)
returns table (id uuid, display_name text, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  f  public.profiles;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  select * into f from public.profiles p
  where p.code = upper(trim(friend_code));

  if f.id is null then
    raise exception 'no one has that code';
  end if;
  if f.id = me then
    raise exception 'that is your own code';
  end if;

  insert into public.friendships (user_a, user_b)
  values (least(me, f.id), greatest(me, f.id))
  on conflict do nothing;

  return query select f.id, f.display_name, f.code;
end;
$$;

-- Friend list with unread counts, in one round trip.
create or replace function public.my_friends()
returns table (id uuid, display_name text, code text, unread bigint, last_ts timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as uid),
  pals as (
    select case when f.user_a = me.uid then f.user_b else f.user_a end as friend_id
    from public.friendships f, me
    where me.uid in (f.user_a, f.user_b)
  )
  select
    p.id,
    p.display_name,
    p.code,
    (select count(*) from public.messages m, me
      where m.sender_id = p.id and m.recipient_id = me.uid and m.read_at is null),
    (select max(m.created_at) from public.messages m, me
      where (m.sender_id = p.id and m.recipient_id = me.uid)
         or (m.sender_id = me.uid and m.recipient_id = p.id))
  from pals join public.profiles p on p.id = pals.friend_id
  order by 5 desc nulls last;
$$;

revoke all on function public.add_friend(text) from public, anon;
revoke all on function public.my_friends()     from public, anon;
grant execute on function public.add_friend(text) to authenticated;
grant execute on function public.my_friends()     to authenticated;

-- ---------------------------------------------------------------- realtime --
-- Idempotent: adding a table twice to a publication is an error.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end;
$$;
