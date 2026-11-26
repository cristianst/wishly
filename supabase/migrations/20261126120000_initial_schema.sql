-- Wishly initial schema: wishlists, wishlist_items, reservations.
-- Owner CRUD is enforced by RLS plus column-level grants. Reservations are
-- closed to direct client access; they are served by Edge Functions (Phase 5).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- wishlists
create table public.wishlists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  description text,
  -- 2 x UUIDv4 from the CSPRNG: 244 bits of entropy (>= 128 required, 256 preferred).
  share_token text not null unique
              default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint wishlists_title_valid check (title = btrim(title) and char_length(title) between 1 and 100),
  constraint wishlists_description_valid check (description is null or char_length(description) <= 1000),
  constraint wishlists_share_token_valid check (share_token ~ '^[A-Za-z0-9_-]{32,128}$')
);

create index wishlists_owner_id_idx on public.wishlists (owner_id);

create trigger wishlists_set_updated_at
  before update on public.wishlists
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------- wishlist_items
create table public.wishlist_items (
  id          uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists (id) on delete cascade,
  title       text not null,
  description text,
  product_url text,
  image_url   text,
  price       numeric(12, 2),
  currency    char(3) not null default 'EUR',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint wishlist_items_title_valid check (title = btrim(title) and char_length(title) between 1 and 150),
  constraint wishlist_items_description_valid check (description is null or char_length(description) <= 2000),
  constraint wishlist_items_product_url_valid
    check (product_url is null or (char_length(product_url) <= 2048 and product_url ~* '^https?://[^[:space:]]+$')),
  constraint wishlist_items_image_url_valid
    check (image_url is null or (char_length(image_url) <= 2048 and image_url ~* '^https?://[^[:space:]]+$')),
  constraint wishlist_items_price_valid check (price is null or price >= 0),
  constraint wishlist_items_currency_valid check (currency ~ '^[A-Z]{3}$')
);

create index wishlist_items_wishlist_id_idx on public.wishlist_items (wishlist_id, created_at);

create trigger wishlist_items_set_updated_at
  before update on public.wishlist_items
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- reservations
-- A cancelled reservation is deleted. UNIQUE(item_id) allows one active
-- reservation per gift. Only the SHA-256 digest of the guest secret is stored.
create table public.reservations (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null unique references public.wishlist_items (id) on delete cascade,
  claim_token_hash text not null,
  created_at       timestamptz not null default now(),
  constraint reservations_claim_token_hash_valid check (claim_token_hash ~ '^[0-9a-f]{64}$')
);

-- ---------------------------------------------------------------------- RLS
alter table public.wishlists       enable row level security;
alter table public.wishlist_items  enable row level security;
alter table public.reservations    enable row level security;

-- Start from zero privileges: Supabase grants broad defaults to anon/authenticated.
revoke all on public.wishlists, public.wishlist_items, public.reservations from public, anon, authenticated;

-- wishlists: owners only. share_token and owner_id are never client-writable.
grant select, delete on public.wishlists to authenticated;
grant insert (owner_id, title, description) on public.wishlists to authenticated;
grant update (title, description) on public.wishlists to authenticated;

create policy wishlists_select_own on public.wishlists
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy wishlists_insert_own on public.wishlists
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  );

create policy wishlists_update_own on public.wishlists
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy wishlists_delete_own on public.wishlists
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- wishlist_items: allowed only when the parent list belongs to the caller.
-- wishlist_id is not updatable, so an item can never move to another list.
grant select, delete on public.wishlist_items to authenticated;
grant insert (wishlist_id, title, description, product_url, image_url, price, currency)
  on public.wishlist_items to authenticated;
grant update (title, description, product_url, image_url, price, currency)
  on public.wishlist_items to authenticated;

create policy wishlist_items_select_own on public.wishlist_items
  for select to authenticated
  using (exists (
    select 1 from public.wishlists w
    where w.id = wishlist_items.wishlist_id and w.owner_id = (select auth.uid())
  ));

create policy wishlist_items_insert_own on public.wishlist_items
  for insert to authenticated
  with check (exists (
    select 1 from public.wishlists w
    where w.id = wishlist_items.wishlist_id and w.owner_id = (select auth.uid())
  ));

create policy wishlist_items_update_own on public.wishlist_items
  for update to authenticated
  using (exists (
    select 1 from public.wishlists w
    where w.id = wishlist_items.wishlist_id and w.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.wishlists w
    where w.id = wishlist_items.wishlist_id and w.owner_id = (select auth.uid())
  ));

create policy wishlist_items_delete_own on public.wishlist_items
  for delete to authenticated
  using (exists (
    select 1 from public.wishlists w
    where w.id = wishlist_items.wishlist_id and w.owner_id = (select auth.uid())
  ));

-- reservations: RLS enabled, no policies and no grants. Clients cannot touch it.
