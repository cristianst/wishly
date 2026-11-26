-- Phase 4: unlisted sharing.
--  * rotate_share_token: owners replace a list's share link (they cannot choose the value).
--  * get_public_wishlist: sanitized read by share token, callable only by the Edge Function.
--  * check_rate_limit + rate_limits: shared, database-backed rate limiting for Edge Functions.

-- ------------------------------------------------------------ rotate token
create function public.rotate_share_token(p_wishlist_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.wishlists
     set share_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
   where id = p_wishlist_id and owner_id = v_uid
  returning share_token into v_token;

  if v_token is null then
    raise exception 'wishlist not found' using errcode = 'P0002';
  end if;
  return v_token;
end;
$$;

revoke all on function public.rotate_share_token(uuid) from public, anon, authenticated;
grant execute on function public.rotate_share_token(uuid) to authenticated;

-- --------------------------------------------------------- public read
-- Returns only fields that are safe for any holder of the link. `reserved` is
-- derived from the reservations table; claim hashes and owner data never leave.
create function public.get_public_wishlist(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', w.title,
    'description', w.description,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'title', i.title,
          'description', i.description,
          'productUrl', i.product_url,
          'imageUrl', i.image_url,
          'price', i.price,
          'currency', i.currency,
          'reserved', exists (select 1 from public.reservations r where r.item_id = i.id)
        )
        order by i.created_at, i.id
      )
      from public.wishlist_items i
      where i.wishlist_id = w.id
    ), '[]'::jsonb)
  )
  from public.wishlists w
  where p_token ~ '^[A-Za-z0-9_-]{32,128}$' and w.share_token = p_token
$$;

revoke all on function public.get_public_wishlist(text) from public, anon, authenticated;
grant execute on function public.get_public_wishlist(text) to service_role;

-- ------------------------------------------------------------ rate limiting
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start),
  constraint rate_limits_key_length check (char_length(key) <= 200)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

-- Counts one hit for `p_key` in the current fixed window; false once over the limit.
create function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or char_length(p_key) > 200 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Opportunistic cleanup keeps the table small without a scheduled job.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
