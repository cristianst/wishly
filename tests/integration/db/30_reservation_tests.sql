-- Tests for migration 20261126140000_reservations.sql.
\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000e2');

do $$
declare e1 uuid := '00000000-0000-0000-0000-0000000000e1'; e2 uuid := '00000000-0000-0000-0000-0000000000e2'; l1 uuid; l2 uuid;
begin
  set local role authenticated;
  perform tests.login(e1);
  insert into public.wishlists (owner_id, title) values (e1, 'Res list') returning id into l1;
  insert into public.wishlist_items (wishlist_id, title) values (l1, 'Alpha'), (l1, 'Beta');
  perform tests.login(e2);
  insert into public.wishlists (owner_id, title) values (e2, 'Other res list') returning id into l2;
  insert into public.wishlist_items (wishlist_id, title) values (l2, 'Gamma');
  reset role;
end $$;

create temp table fx as
select
  (select share_token from public.wishlists where title = 'Res list') as tok,
  (select share_token from public.wishlists where title = 'Other res list') as other_tok,
  (select id from public.wishlist_items where title = 'Alpha') as alpha,
  (select id from public.wishlist_items where title = 'Beta') as beta,
  (select id from public.wishlist_items where title = 'Gamma') as gamma,
  repeat('a', 64) as hash_a,
  repeat('b', 64) as hash_b;
grant select on fx to service_role, anon, authenticated;

-- Only the server (service_role) may use the guest functions.
do $$
declare f record;
begin
  set local role anon;
  perform tests.expect_error('anon reserve', $q$select public.reserve_item('x', gen_random_uuid(), repeat('a', 64))$q$, '42501');
  perform tests.expect_error('anon cancel', $q$select public.cancel_reservation('x', gen_random_uuid(), repeat('a', 64))$q$, '42501');
  perform tests.expect_error('anon ownership', $q$select public.reservation_ownership('x', '[]')$q$, '42501');
  perform tests.expect_error('anon reserved ids', $q$select public.get_reserved_item_ids(gen_random_uuid())$q$, '42501');
  reset role;
  set local role authenticated;
  perform tests.login('00000000-0000-0000-0000-0000000000e1');
  perform tests.expect_error('authenticated reserve', $q$select public.reserve_item('x', gen_random_uuid(), repeat('a', 64))$q$, '42501');
  perform tests.expect_error('authenticated cancel', $q$select public.cancel_reservation('x', gen_random_uuid(), repeat('a', 64))$q$, '42501');
  perform tests.expect_error('authenticated ownership', $q$select public.reservation_ownership('x', '[]')$q$, '42501');
  reset role;
end $$;

-- Reserve lifecycle.
do $$
declare r text; fx_ record;
begin
  select * into fx_ from fx;
  set local role service_role;

  if public.reserve_item(fx_.tok, fx_.alpha, fx_.hash_a) <> 'created' then perform tests.fail('first reserve should create'); end if;
  if public.reserve_item(fx_.tok, fx_.alpha, fx_.hash_a) <> 'already_yours' then perform tests.fail('same secret should be idempotent'); end if;
  if public.reserve_item(fx_.tok, fx_.alpha, fx_.hash_b) <> 'conflict' then perform tests.fail('other guest should conflict'); end if;

  -- Wrong list / unknown item / unknown token never reserve anything.
  if public.reserve_item(fx_.other_tok, fx_.alpha, fx_.hash_b) <> 'not_found' then perform tests.fail('item from another list'); end if;
  if public.reserve_item(fx_.tok, gen_random_uuid(), fx_.hash_b) <> 'not_found' then perform tests.fail('unknown item'); end if;
  if public.reserve_item(repeat('z', 64), fx_.beta, fx_.hash_b) <> 'not_found' then perform tests.fail('unknown token'); end if;
  if public.reserve_item('short', fx_.beta, fx_.hash_b) <> 'not_found' then perform tests.fail('malformed token'); end if;
  perform tests.expect_error('raw secret as hash', format('select public.reserve_item(%L, %L, ''raw-secret'')', fx_.tok, fx_.beta), '22023');
  reset role;

  if (select count(*) from public.reservations where item_id in (select alpha from fx union select beta from fx union select gamma from fx)) <> 1 then perform tests.fail('exactly one reservation expected'); end if;
end $$;

-- Ownership proofs: only matching (item, hash) pairs on this list are returned.
do $$
declare fx_ record; owned uuid[];
begin
  select * into fx_ from fx;
  set local role service_role;

  owned := public.reservation_ownership(fx_.tok, jsonb_build_array(
    jsonb_build_object('itemId', fx_.alpha, 'claimHash', fx_.hash_a),
    jsonb_build_object('itemId', fx_.beta, 'claimHash', fx_.hash_a)));
  if owned <> array[fx_.alpha] then perform tests.fail('ownership should return only alpha'); end if;

  owned := public.reservation_ownership(fx_.tok, jsonb_build_array(jsonb_build_object('itemId', fx_.alpha, 'claimHash', fx_.hash_b)));
  if cardinality(owned) <> 0 then perform tests.fail('stale/foreign secret must not prove ownership'); end if;

  owned := public.reservation_ownership(fx_.other_tok, jsonb_build_array(jsonb_build_object('itemId', fx_.alpha, 'claimHash', fx_.hash_a)));
  if cardinality(owned) <> 0 then perform tests.fail('ownership must be scoped to the list'); end if;

  perform tests.expect_error('too many proofs',
    format('select public.reservation_ownership(%L, (select jsonb_agg(jsonb_build_object(''itemId'', gen_random_uuid(), ''claimHash'', repeat(''a'', 64))) from generate_series(1, 51)))', fx_.tok), '22023');
  perform tests.expect_error('proofs not an array', format('select public.reservation_ownership(%L, ''{}'')', fx_.tok), '22023');
  reset role;
end $$;

-- Cancel: only the matching digest releases a reservation.
do $$
declare fx_ record;
begin
  select * into fx_ from fx;
  set local role service_role;

  if public.cancel_reservation(fx_.tok, fx_.alpha, fx_.hash_b) <> 'not_yours' then perform tests.fail('other guest must not cancel'); end if;
  reset role;
  if (select count(*) from public.reservations where item_id in (select alpha from fx union select beta from fx union select gamma from fx)) <> 1 then perform tests.fail('mismatched cancel removed the reservation'); end if;
  set local role service_role;
  if public.cancel_reservation(fx_.other_tok, fx_.alpha, fx_.hash_a) <> 'not_found' then perform tests.fail('cancel through another list'); end if;
  if public.cancel_reservation(fx_.tok, fx_.beta, fx_.hash_a) <> 'none' then perform tests.fail('cancel with nothing reserved'); end if;

  if public.cancel_reservation(fx_.tok, fx_.alpha, fx_.hash_a) <> 'cancelled' then perform tests.fail('owner cancel'); end if;
  if public.cancel_reservation(fx_.tok, fx_.alpha, fx_.hash_a) <> 'none' then perform tests.fail('repeated cancel should be a no-op'); end if;
  if public.reserve_item(fx_.tok, fx_.alpha, fx_.hash_b) <> 'created' then perform tests.fail('released gift should be reservable'); end if;
  reset role;
end $$;

-- A previous holder's old secret must not read as "mine" after someone else reserved.
do $$
declare fx_ record; owned uuid[];
begin
  select * into fx_ from fx;
  set local role service_role;
  owned := public.reservation_ownership(fx_.tok, jsonb_build_array(jsonb_build_object('itemId', fx_.alpha, 'claimHash', fx_.hash_a)));
  if cardinality(owned) <> 0 then perform tests.fail('old secret claimed a new reservation'); end if;
  reset role;
end $$;

-- Public view reflects reservations without leaking secrets.
do $$
declare fx_ record; result jsonb;
begin
  select * into fx_ from fx;
  set local role service_role;
  result := public.get_public_wishlist(fx_.tok);
  reset role;
  if (select (i ->> 'reserved')::boolean from jsonb_array_elements(result -> 'items') i where i ->> 'title' = 'Alpha') is not true then
    perform tests.fail('public view should show Alpha reserved');
  end if;
  if result::text like '%' || repeat('a', 64) || '%' or result::text like '%' || repeat('b', 64) || '%' then
    perform tests.fail('claim hash leaked in public view');
  end if;
end $$;

-- Owner view: reserved ids for own lists only.
do $$
declare fx_ record; ids uuid[];
begin
  select * into fx_ from fx;
  set local role authenticated;
  perform tests.login('00000000-0000-0000-0000-0000000000e1');
  ids := public.get_reserved_item_ids((select id from public.wishlists where title = 'Res list'));
  if ids <> array[fx_.alpha] then perform tests.fail('owner should see Alpha reserved'); end if;

  perform tests.login('00000000-0000-0000-0000-0000000000e2');
  ids := public.get_reserved_item_ids((select id from public.wishlists where title = 'Res list'));
  if cardinality(ids) <> 0 then perform tests.fail('non-owner saw reservation status'); end if;
  reset role;
end $$;

-- Deleting a gift removes its reservation; deleting the list does too.
do $$
begin
  set local role authenticated;
  perform tests.login('00000000-0000-0000-0000-0000000000e1');
  delete from public.wishlist_items where title = 'Alpha';
  reset role;
  if (select count(*) from public.reservations where item_id in (select alpha from fx union select beta from fx union select gamma from fx)) <> 0 then perform tests.fail('reservation survived its gift'); end if;
end $$;

\echo 'Reservation database tests passed.'
