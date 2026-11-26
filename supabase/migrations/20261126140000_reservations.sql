-- Phase 5: anonymous reservations.
-- All guest-facing functions are callable only by service_role (the Edge Functions), which
-- pass the SHA-256 digest of the guest's secret. The raw secret never reaches the database.
-- UNIQUE(item_id) on reservations is what makes reserving race-free.

create function public.reserve_item(p_token text, p_item_id uuid, p_claim_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wishlist uuid;
  v_inserted uuid;
  v_existing text;
  v_attempt integer := 0;
begin
  if p_claim_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid claim hash' using errcode = '22023';
  end if;

  select w.id into v_wishlist
    from public.wishlists w
   where p_token ~ '^[A-Za-z0-9_-]{32,128}$' and w.share_token = p_token;
  if v_wishlist is null then return 'not_found'; end if;

  if not exists (select 1 from public.wishlist_items i where i.id = p_item_id and i.wishlist_id = v_wishlist) then
    return 'not_found';
  end if;

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.reservations (item_id, claim_token_hash)
      values (p_item_id, p_claim_hash)
      on conflict (item_id) do nothing
      returning id into v_inserted;
    exception when foreign_key_violation then
      return 'not_found'; -- the gift was deleted while we were reserving it
    end;

    if v_inserted is not null then return 'created'; end if;

    select r.claim_token_hash into v_existing from public.reservations r where r.item_id = p_item_id;
    if v_existing is not null then
      return case when v_existing = p_claim_hash then 'already_yours' else 'conflict' end;
    end if;
    -- The holder cancelled between our conflict and our read: try again.
    if v_attempt >= 3 then return 'conflict'; end if;
  end loop;
end;
$$;

-- Returns: cancelled | none (nothing to cancel; safe to retry) | not_yours | not_found.
create function public.cancel_reservation(p_token text, p_item_id uuid, p_claim_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wishlist uuid;
  v_deleted uuid;
begin
  if p_claim_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid claim hash' using errcode = '22023';
  end if;

  select w.id into v_wishlist
    from public.wishlists w
   where p_token ~ '^[A-Za-z0-9_-]{32,128}$' and w.share_token = p_token;
  if v_wishlist is null then return 'not_found'; end if;

  if not exists (select 1 from public.wishlist_items i where i.id = p_item_id and i.wishlist_id = v_wishlist) then
    return 'not_found';
  end if;

  -- Compare and delete in one statement: a mismatched digest can never cancel anything.
  delete from public.reservations r
   where r.item_id = p_item_id and r.claim_token_hash = p_claim_hash
  returning r.id into v_deleted;
  if v_deleted is not null then return 'cancelled'; end if;

  if exists (select 1 from public.reservations r where r.item_id = p_item_id) then
    return 'not_yours';
  end if;
  return 'none';
end;
$$;

-- Which of the supplied proofs [{itemId, claimHash}] hold a reservation on this list.
create function public.reservation_ownership(p_token text, p_proofs jsonb)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owned uuid[];
begin
  if jsonb_typeof(p_proofs) <> 'array' or jsonb_array_length(p_proofs) > 50 then
    raise exception 'invalid proofs' using errcode = '22023';
  end if;

  select coalesce(array_agg(r.item_id), '{}') into v_owned
    from jsonb_to_recordset(p_proofs) as x("itemId" uuid, "claimHash" text)
    join public.reservations r on r.item_id = x."itemId" and r.claim_token_hash = x."claimHash"
    join public.wishlist_items i on i.id = r.item_id
    join public.wishlists w on w.id = i.wishlist_id
   where p_token ~ '^[A-Za-z0-9_-]{32,128}$' and w.share_token = p_token;
  return v_owned;
end;
$$;

-- Owners see which gifts are reserved, never by whom and never any secret material.
-- Returns an empty array for lists the caller does not own.
create function public.get_reserved_item_ids(p_wishlist_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.item_id), '{}')
    from public.reservations r
    join public.wishlist_items i on i.id = r.item_id
    join public.wishlists w on w.id = i.wishlist_id
   where w.id = p_wishlist_id and w.owner_id = (select auth.uid())
$$;

revoke all on function public.reserve_item(text, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_reservation(text, uuid, text) from public, anon, authenticated;
revoke all on function public.reservation_ownership(text, jsonb) from public, anon, authenticated;
revoke all on function public.get_reserved_item_ids(uuid) from public, anon, authenticated;

grant execute on function public.reserve_item(text, uuid, text) to service_role;
grant execute on function public.cancel_reservation(text, uuid, text) to service_role;
grant execute on function public.reservation_ownership(text, jsonb) to service_role;
grant execute on function public.get_reserved_item_ids(uuid) to authenticated;
