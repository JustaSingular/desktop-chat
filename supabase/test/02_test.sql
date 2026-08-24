-- Functional + RLS tests for 0001_init.sql, run against the throwaway container.
-- Any failed assertion aborts the script.
--
-- Roles are switched with SET ROLE + the request.jwt.claim.sub GUC, which is how
-- Supabase scopes auth.uid() per request.

-- Three users: alice and bob become friends, mallory stays a stranger.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');

do $$
declare n int;
begin
  select count(*) into n from public.profiles;
  if n <> 3 then raise exception 'expected 3 auto-created profiles, got %', n; end if;

  select count(distinct code) into n from public.profiles;
  if n <> 3 then raise exception 'friend codes are not unique'; end if;

  select count(*) into n from public.profiles where code !~ '^[2-9A-Z]{4}-[2-9A-Z]{4}$';
  if n <> 0 then raise exception 'a friend code is malformed'; end if;
  raise notice 'OK  profiles auto-created with unique well-formed codes';
end $$;

-- Codes stashed as superuser (RLS bypassed) so the tests can reference them
-- without reading them through a policy that is supposed to hide them.
create temp table fixtures as select id, code from public.profiles;
grant select on fixtures to authenticated;

-- ---- alice ------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n int;
begin
  select count(*) into n from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';
  if n <> 0 then raise exception 'RLS leak: stranger profile is visible'; end if;

  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'alice should see only herself, sees %', n; end if;
  raise notice 'OK  stranger profiles are not readable';
end $$;

do $$
declare bob_code text; got uuid; n int;
begin
  select code into bob_code from fixtures where id = '22222222-2222-2222-2222-222222222222';
  select a.id into got from public.add_friend(bob_code) a;
  if got <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'add_friend returned the wrong person: %', got;
  end if;

  select count(*) into n from public.friendships;
  if n <> 1 then raise exception 'expected 1 friendship row, got %', n; end if;

  select count(*) into n from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';
  if n <> 1 then raise exception 'friend profile still hidden after add'; end if;

  -- adding twice must not duplicate
  perform public.add_friend(bob_code);
  select count(*) into n from public.friendships;
  if n <> 1 then raise exception 'duplicate friendship created'; end if;
  raise notice 'OK  add_friend links the pair, reveals the profile, is idempotent';
end $$;

do $$
declare my_code text; ok boolean;
begin
  select code into my_code from fixtures where id = auth.uid();

  ok := false;
  begin perform public.add_friend(my_code);
  exception when others then ok := true; end;
  if not ok then raise exception 'adding your own code should fail'; end if;

  ok := false;
  begin perform public.add_friend('ZZZZ-ZZZZ');
  exception when others then ok := true; end;
  if not ok then raise exception 'unknown code should fail'; end if;
  raise notice 'OK  own code and unknown codes are rejected';
end $$;

-- ---- messaging --------------------------------------------------------------
insert into public.messages (sender_id, recipient_id, body)
values (auth.uid(), '22222222-2222-2222-2222-222222222222', 'hey bob');

do $$
declare ok boolean;
begin
  ok := false;
  begin
    insert into public.messages (sender_id, recipient_id, body)
    values (auth.uid(), '33333333-3333-3333-3333-333333333333', 'hi stranger');
  exception when others then ok := true; end;
  if not ok then raise exception 'RLS leak: sent a message to a non-friend'; end if;

  ok := false;
  begin
    insert into public.messages (sender_id, recipient_id, body)
    values ('22222222-2222-2222-2222-222222222222', auth.uid(), 'forged');
  exception when others then ok := true; end;
  if not ok then raise exception 'RLS leak: forged a sender'; end if;
  raise notice 'OK  cannot message non-friends or forge a sender';
end $$;

-- ---- bob --------------------------------------------------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare n int; u bigint;
begin
  select count(*) into n from public.messages;
  if n <> 1 then raise exception 'bob should see 1 message, sees %', n; end if;

  select f.unread into u from public.my_friends() f;
  if u <> 1 then raise exception 'bob unread should be 1, is %', u; end if;

  insert into public.messages (sender_id, recipient_id, body)
  values (auth.uid(), '11111111-1111-1111-1111-111111111111', 'hey alice');

  update public.messages set read_at = now()
   where sender_id = '11111111-1111-1111-1111-111111111111'
     and recipient_id = auth.uid();

  select f.unread into u from public.my_friends() f;
  if u <> 0 then raise exception 'bob unread should be 0 after read, is %', u; end if;
  raise notice 'OK  unread counts track read_at';
end $$;

do $$
declare b text;
begin
  update public.messages set body = 'tampered'
   where sender_id = '11111111-1111-1111-1111-111111111111';
  select body into b from public.messages
   where sender_id = '11111111-1111-1111-1111-111111111111';
  if b <> 'hey bob' then raise exception 'message body was mutated to %', b; end if;
  raise notice 'OK  message bodies are immutable';
end $$;

-- ---- mallory sees nothing ---------------------------------------------------
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

do $$
declare n int;
begin
  select count(*) into n from public.messages;
  if n <> 0 then raise exception 'RLS leak: stranger reads % messages', n; end if;

  select count(*) into n from public.friendships;
  if n <> 0 then raise exception 'RLS leak: stranger reads friendships'; end if;

  select count(*) into n from public.my_friends();
  if n <> 0 then raise exception 'RLS leak: my_friends returned rows for a stranger'; end if;

  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'stranger should see only self, sees %', n; end if;
  raise notice 'OK  a stranger sees nothing but themselves';
end $$;

-- ---- profile edits ----------------------------------------------------------
do $$
declare old_code text; new_code text; new_name text;
begin
  select code into old_code from public.profiles where id = auth.uid();
  update public.profiles set code = 'AAAA-AAAA', display_name = 'renamed'
   where id = auth.uid();
  select code, display_name into new_code, new_name
    from public.profiles where id = auth.uid();

  if new_code <> old_code then raise exception 'friend code was changed to %', new_code; end if;
  if new_name <> 'renamed' then raise exception 'display name did not change'; end if;
  raise notice 'OK  code is immutable, display name is editable';
end $$;

-- ---- an anon (not signed in) caller gets nothing ----------------------------
set role anon;
set request.jwt.claim.sub = '';

do $$
declare ok boolean;
begin
  ok := false;
  begin perform count(*) from public.messages;
  exception when others then ok := true; end;
  if not ok then raise exception 'anon could query messages'; end if;

  ok := false;
  begin perform public.my_friends();
  exception when others then ok := true; end;
  if not ok then raise exception 'anon could call my_friends'; end if;
  raise notice 'OK  anon role is locked out of the app tables';
end $$;

-- ---- keepalive: the single deliberate exception for anon ---------------------
do $$
declare n int; ok boolean;
begin
  select count(*) into n from public.keepalive;
  if n <> 1 then raise exception 'anon should read exactly 1 keepalive row, got %', n; end if;

  ok := false;
  begin update public.keepalive set pinged_at = now();
  exception when others then ok := true; end;
  if not ok then raise exception 'anon could write to keepalive'; end if;

  ok := false;
  begin insert into public.keepalive (id) values (2);
  exception when others then ok := true; end;
  if not ok then raise exception 'anon could insert into keepalive'; end if;

  ok := false;
  begin delete from public.keepalive;
  exception when others then ok := true; end;
  if not ok then raise exception 'anon could delete from keepalive'; end if;

  raise notice 'OK  anon can read keepalive, and only read it';
end $$;

reset role;
select 'ALL TESTS PASSED' as result;
