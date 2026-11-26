-- Tests for migration 20261126130000_sharing.sql (runs after 10_rls_tests.sql).
\set ON_ERROR_STOP on

grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d2');

-- Fixtures created as the owners, through the real policies.
do $$
declare d1 uuid := '00000000-0000-0000-0000-0000000000d1'; d2 uuid := '00000000-0000-0000-0000-0000000000d2'; l1 uuid;
begin
  set local role authenticated;
  perform tests.login(d1);
  insert into public.wishlists (owner_id, title, description) values (d1, 'Shared list', 'For friends') returning id into l1;
  insert into public.wishlist_items (wishlist_id, title, price, currency, product_url)
    values (l1, 'Lamp', 49.00, 'EUR', 'https://example.com/lamp'), (l1, 'Plant', null, 'EUR', null);
  perform tests.login(d2);
  insert into public.wishlists (owner_id, title) values (d2, 'Other list');
  reset role;
  insert into public.reservations (item_id, claim_token_hash)
    select id, repeat('c', 64) from public.wishlist_items where title = 'Lamp';
end $$;

-- ------------------------------------------------ public read is locked down
do $$
declare tok text := (select share_token from public.wishlists where title = 'Shared list');
begin
  set local role anon;
  perform tests.expect_error('anon calls get_public_wishlist', format('select public.get_public_wishlist(%L)', tok), '42501');
  reset role;
  set local role authenticated;
  perform tests.login('00000000-0000-0000-0000-0000000000d1');
  perform tests.expect_error('authenticated calls get_public_wishlist', format('select public.get_public_wishlist(%L)', tok), '42501');
  reset role;
end $$;

do $$
declare
  tok text := (select share_token from public.wishlists where title = 'Shared list');
  result jsonb;
  item jsonb;
begin
  set local role service_role;
  result := public.get_public_wishlist(tok);
  reset role;

  if result ->> 'title' <> 'Shared list' then perform tests.fail('wrong list returned'); end if;
  if jsonb_array_length(result -> 'items') <> 2 then perform tests.fail('expected two items'); end if;

  -- Only the whitelisted keys are present, at both levels.
  if (select array_agg(k order by k) from jsonb_object_keys(result) k) <> array['description', 'items', 'title'] then
    perform tests.fail('unexpected top-level keys: ' || (select string_agg(k, ',') from jsonb_object_keys(result) k));
  end if;
  for item in select * from jsonb_array_elements(result -> 'items') loop
    if (select array_agg(k order by k) from jsonb_object_keys(item) k)
       <> array['currency', 'description', 'id', 'imageUrl', 'price', 'productUrl', 'reserved', 'title'] then
      perform tests.fail('unexpected item keys: ' || (select string_agg(k, ',') from jsonb_object_keys(item) k));
    end if;
  end loop;

  if result::text like '%' || repeat('c', 64) || '%' or result::text like '%owner%' then
    perform tests.fail('sensitive data leaked in public payload');
  end if;
  if (select (i ->> 'reserved')::boolean from jsonb_array_elements(result -> 'items') i where i ->> 'title' = 'Lamp') is not true then
    perform tests.fail('reserved flag not derived');
  end if;
  if (select (i ->> 'reserved')::boolean from jsonb_array_elements(result -> 'items') i where i ->> 'title' = 'Plant') is not false then
    perform tests.fail('unreserved item reported as reserved');
  end if;
end $$;

do $$
begin
  set local role service_role;
  if public.get_public_wishlist(repeat('z', 64)) is not null then perform tests.fail('unknown token returned data'); end if;
  if public.get_public_wishlist('short') is not null then perform tests.fail('malformed token returned data'); end if;
  if public.get_public_wishlist('%') is not null or public.get_public_wishlist('') is not null then
    perform tests.fail('wildcard/empty token returned data');
  end if;
  reset role;
end $$;

-- --------------------------------------------------------- rotating the token
do $$
declare
  d1 uuid := '00000000-0000-0000-0000-0000000000d1'; d2 uuid := '00000000-0000-0000-0000-0000000000d2';
  l1 uuid := (select id from public.wishlists where title = 'Shared list');
  old_tok text := (select share_token from public.wishlists where title = 'Shared list');
  new_tok text;
begin
  set local role anon;
  perform tests.expect_error('anon rotates', format('select public.rotate_share_token(%L)', l1), '42501');
  reset role;

  set local role authenticated;
  perform tests.login(d2);
  perform tests.expect_error('non-owner rotates', format('select public.rotate_share_token(%L)', l1), 'P0002');
  perform tests.login(d1, true);
  perform tests.expect_error('anonymous user rotates', format('select public.rotate_share_token(%L)', l1), '42501');
  perform tests.login(d1);
  new_tok := public.rotate_share_token(l1);
  reset role;

  if new_tok = old_tok or length(new_tok) < 32 then perform tests.fail('token was not replaced by a strong value'); end if;
  if (select share_token from public.wishlists where id = l1) <> new_tok then perform tests.fail('new token not stored'); end if;

  set local role service_role;
  if public.get_public_wishlist(old_tok) is not null then perform tests.fail('old token still resolves'); end if;
  if public.get_public_wishlist(new_tok) is null then perform tests.fail('new token does not resolve'); end if;
  reset role;
end $$;

-- ------------------------------------------------------------- rate limiting
do $$
begin
  set local role anon;
  perform tests.expect_error('anon uses rate limiter', $q$select public.check_rate_limit('k', 5, 60)$q$, '42501');
  reset role;
end $$;

do $$
declare allowed int := 0; i int; other boolean;
begin
  set local role service_role;
  for i in 1..7 loop
    if public.check_rate_limit('test:a', 5, 3600) then allowed := allowed + 1; end if;
  end loop;
  other := public.check_rate_limit('test:b', 5, 3600);
  perform tests.expect_error('bad limit', $q$select public.check_rate_limit('x', 0, 60)$q$, '22023');
  reset role;
  if allowed <> 5 then perform tests.fail('expected exactly 5 allowed hits, got ' || allowed); end if;
  if not other then perform tests.fail('limits must be tracked per key'); end if;
end $$;

do $$
begin
  set local role authenticated;
  perform tests.login('00000000-0000-0000-0000-0000000000d1');
  perform tests.expect_error('authenticated uses rate limiter', $q$select public.check_rate_limit('k', 5, 60)$q$, '42501');
  perform tests.expect_error('authenticated reads rate_limits', 'select * from public.rate_limits', '42501');
  reset role;
end $$;

\echo 'Sharing database tests passed.'
