-- Behavioural tests for the schema and RLS. Any failed assertion aborts the run.
\set ON_ERROR_STOP on

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.fail(msg text) returns void language plpgsql as $$
begin raise exception 'TEST FAILED: %', msg; end $$;

-- Runs `sql` as the current role and requires it to fail with `expected` SQLSTATE.
create function tests.expect_error(label text, sql text, expected text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'TEST FAILED: % -> expected % but got % (%)', label, expected, sqlstate, sqlerrm;
  end;
  raise exception 'TEST FAILED: % -> statement unexpectedly succeeded', label;
end $$;

-- Runs a DML statement as the current role and returns the affected row count.
create function tests.rows_affected(sql text) returns bigint language plpgsql as $$
declare n bigint;
begin execute sql; get diagnostics n = row_count; return n; end $$;

create function tests.count_rows(tbl text) returns bigint language plpgsql as $$
declare n bigint;
begin execute format('select count(*) from %s', tbl) into n; return n; end $$;

create function tests.login(uid uuid, anonymous boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', anonymous)::text, true);
end $$;

grant execute on all functions in schema tests to anon, authenticated;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b');

-- ------------------------------------------------------------ invariants
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    perform tests.fail('RLS is not enabled on public.' || t);
  end loop;

  if has_table_privilege('anon', 'public.wishlists', 'select')
     or has_table_privilege('anon', 'public.wishlist_items', 'select')
     or has_table_privilege('anon', 'public.reservations', 'select') then
    perform tests.fail('anon must not have table privileges');
  end if;
  if has_table_privilege('authenticated', 'public.reservations', 'select')
     or has_table_privilege('authenticated', 'public.reservations', 'insert')
     or has_table_privilege('authenticated', 'public.reservations', 'delete') then
    perform tests.fail('authenticated must not access reservations directly');
  end if;
  if has_column_privilege('authenticated', 'public.wishlists', 'share_token', 'update')
     or has_column_privilege('authenticated', 'public.wishlists', 'share_token', 'insert')
     or has_column_privilege('authenticated', 'public.wishlists', 'owner_id', 'update')
     or has_column_privilege('authenticated', 'public.wishlist_items', 'wishlist_id', 'update') then
    perform tests.fail('protected columns must not be client-writable');
  end if;
end $$;

-- ------------------------------------------------- anon cannot read or write
do $$
begin
  set local role anon;
  perform tests.expect_error('anon select wishlists', 'select * from public.wishlists', '42501');
  perform tests.expect_error('anon select items', 'select * from public.wishlist_items', '42501');
  perform tests.expect_error('anon select reservations', 'select * from public.reservations', '42501');
  perform tests.expect_error('anon insert wishlist',
    $q$insert into public.wishlists (owner_id, title) values ('00000000-0000-0000-0000-00000000000a', 'x')$q$, '42501');
  reset role;
end $$;

-- ---------------------------------------------------------------- owner A
do $$
declare a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b';
        list_a uuid; tok text;
begin
  set local role authenticated;
  perform tests.login(a);

  insert into public.wishlists (owner_id, title, description) values (a, 'Birthday', 'Things I like')
    returning id, share_token into list_a, tok;
  if length(tok) < 32 then perform tests.fail('share token too short'); end if;
  if (select count(*) from public.wishlists where share_token = tok) <> 1 then
    perform tests.fail('owner cannot read own list');
  end if;

  perform tests.expect_error('insert for another owner',
    format('insert into public.wishlists (owner_id, title) values (%L, ''x'')', b), '42501');
  perform tests.expect_error('client-chosen share token',
    format('insert into public.wishlists (owner_id, title, share_token) values (%L, ''x'', ''weak'')', a), '42501');
  perform tests.expect_error('update share token',
    format('update public.wishlists set share_token = ''weak'' where id = %L', list_a), '42501');
  perform tests.expect_error('reassign owner',
    format('update public.wishlists set owner_id = %L where id = %L', b, list_a), '42501');
  perform tests.expect_error('empty title',
    format('insert into public.wishlists (owner_id, title) values (%L, '''')', a), '23514');
  perform tests.expect_error('untrimmed title',
    format('insert into public.wishlists (owner_id, title) values (%L, '' padded '')', a), '23514');
  perform tests.expect_error('title too long',
    format('insert into public.wishlists (owner_id, title) values (%L, %L)', a, repeat('x', 101)), '23514');

  insert into public.wishlist_items (wishlist_id, title, price, currency, product_url)
    values (list_a, 'Headphones', 99.90, 'EUR', 'https://example.com/p?id=1&v=2');
  insert into public.wishlist_items (wishlist_id, title) values (list_a, 'Book');

  perform tests.expect_error('empty item title',
    format('insert into public.wishlist_items (wishlist_id, title) values (%L, '''')', list_a), '23514');
  perform tests.expect_error('negative price',
    format('insert into public.wishlist_items (wishlist_id, title, price) values (%L, ''x'', -1)', list_a), '23514');
  perform tests.expect_error('javascript url',
    format('insert into public.wishlist_items (wishlist_id, title, product_url) values (%L, ''x'', ''javascript:alert(1)'')', list_a), '23514');
  perform tests.expect_error('bad image url',
    format('insert into public.wishlist_items (wishlist_id, title, image_url) values (%L, ''x'', ''ftp://x/y.png'')', list_a), '23514');
  perform tests.expect_error('bad currency',
    format('insert into public.wishlist_items (wishlist_id, title, currency) values (%L, ''x'', ''eu'')', list_a), '23514');
  perform tests.expect_error('item reassigned to another list',
    format('update public.wishlist_items set wishlist_id = gen_random_uuid() where wishlist_id = %L', list_a), '42501');
  perform tests.expect_error('owner reads reservations',
    'select * from public.reservations', '42501');
  reset role;
end $$;

-- Owner B has a list and an item of their own.
do $$
declare b uuid := '00000000-0000-0000-0000-00000000000b'; list_b uuid;
begin
  set local role authenticated;
  perform tests.login(b);
  insert into public.wishlists (owner_id, title) values (b, 'Wedding') returning id into list_b;
  insert into public.wishlist_items (wishlist_id, title) values (list_b, 'Vase');
  reset role;
end $$;

-- ------------------------------------------ cross-owner isolation (B vs A)
do $$
declare a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b';
        list_a uuid := (select id from public.wishlists where owner_id = a);
        item_a uuid := (select id from public.wishlist_items where wishlist_id = (select id from public.wishlists where owner_id = a) and title = 'Book');
begin
  set local role authenticated;
  perform tests.login(b);

  if tests.count_rows('public.wishlists') <> 1 then perform tests.fail('B sees lists that are not theirs'); end if;
  if tests.count_rows('public.wishlist_items') <> 1 then perform tests.fail('B sees items that are not theirs'); end if;

  if tests.rows_affected(format('update public.wishlists set title = ''hijack'' where id = %L', list_a)) <> 0 then
    perform tests.fail('B updated A''s list');
  end if;
  if tests.rows_affected(format('delete from public.wishlists where id = %L', list_a)) <> 0 then
    perform tests.fail('B deleted A''s list');
  end if;
  if tests.rows_affected(format('update public.wishlist_items set title = ''hijack'' where id = %L', item_a)) <> 0 then
    perform tests.fail('B updated A''s item');
  end if;
  if tests.rows_affected(format('delete from public.wishlist_items where id = %L', item_a)) <> 0 then
    perform tests.fail('B deleted A''s item');
  end if;
  perform tests.expect_error('B inserts item into A list',
    format('insert into public.wishlist_items (wishlist_id, title) values (%L, ''planted'')', list_a), '42501');
  reset role;
end $$;

-- Anonymous (guest-style) auth users cannot create lists.
do $$
declare c uuid := '00000000-0000-0000-0000-00000000000c';
begin
  insert into auth.users (id) values (c);
  set local role authenticated;
  perform tests.login(c, true);
  perform tests.expect_error('anonymous user creates list',
    format('insert into public.wishlists (owner_id, title) values (%L, ''x'')', c), '42501');
  reset role;
end $$;

-- Timestamps are maintained server-side (separate transaction from the insert).
select pg_sleep(0.05);
do $$
declare a uuid := '00000000-0000-0000-0000-00000000000a'; before_ts timestamptz; after_ts timestamptz;
begin
  select updated_at into before_ts from public.wishlists where owner_id = a;
  set local role authenticated;
  perform tests.login(a);
  update public.wishlists set title = 'Birthday 2027' where owner_id = a;
  reset role;
  select updated_at into after_ts from public.wishlists where owner_id = a;
  if after_ts <= before_ts then perform tests.fail('updated_at was not advanced'); end if;
end $$;

-- ----------------------------------- reservations: uniqueness and cascades
do $$
declare a uuid := '00000000-0000-0000-0000-00000000000a';
        item uuid := (select id from public.wishlist_items where title = 'Book');
begin
  insert into public.reservations (item_id, claim_token_hash) values (item, repeat('a', 64));
  perform tests.expect_error('second reservation for same item',
    format('insert into public.reservations (item_id, claim_token_hash) values (%L, %L)', item, repeat('b', 64)), '23505');
  perform tests.expect_error('malformed claim hash',
    format('insert into public.reservations (item_id, claim_token_hash) values (%L, ''plain-secret'')', (select id from public.wishlist_items where title = 'Headphones')), '23514');

  set local role authenticated;
  perform tests.login(a);
  perform tests.expect_error('owner reads reservations', 'select * from public.reservations', '42501');
  delete from public.wishlists where owner_id = a;
  reset role;

  if (select count(*) from public.wishlist_items where title in ('Book', 'Headphones')) <> 0 then
    perform tests.fail('items did not cascade with their list');
  end if;
  if (select count(*) from public.reservations) <> 0 then
    perform tests.fail('reservations did not cascade with their item');
  end if;
end $$;

\echo 'All database tests passed.'
