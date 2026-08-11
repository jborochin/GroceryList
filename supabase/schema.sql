-- MealPrep Grocery — Supabase schema
-- Run in the Supabase SQL editor against an empty project. Idempotent: safe to re-run.

-- =====================================================================
-- Helper: touch updated_at
-- =====================================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- 1. profiles (1:1 with auth.users)
-- =====================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_delete_own" on public.profiles for delete using (auth.uid() = id);

-- =====================================================================
-- 2. recipes
-- =====================================================================
create table if not exists public.recipes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_url text,
  servings numeric not null,
  ingredients jsonb not null default '[]'::jsonb,
  instructions text[],
  nutrition_per_serving jsonb,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Migration for existing installs (the create-table above is a no-op once the
-- table exists): add the recipe photo column captured during web import.
alter table public.recipes add column if not exists image_url text;

create index if not exists recipes_user_updated_idx on public.recipes(user_id, updated_at);

drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch before update on public.recipes
  for each row execute function public.touch_updated_at();

alter table public.recipes enable row level security;

drop policy if exists "recipes_select_own" on public.recipes;
drop policy if exists "recipes_insert_own" on public.recipes;
drop policy if exists "recipes_update_own" on public.recipes;
drop policy if exists "recipes_delete_own" on public.recipes;

create policy "recipes_select_own" on public.recipes for select using (auth.uid() = user_id);
create policy "recipes_insert_own" on public.recipes for insert with check (auth.uid() = user_id);
create policy "recipes_update_own" on public.recipes for update using (auth.uid() = user_id);
create policy "recipes_delete_own" on public.recipes for delete using (auth.uid() = user_id);

-- =====================================================================
-- 3. meal_plan_entries
-- =====================================================================
create table if not exists public.meal_plan_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  desired_servings numeric not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, recipe_id)
);

create index if not exists meal_plan_user_updated_idx on public.meal_plan_entries(user_id, updated_at);

drop trigger if exists meal_plan_touch on public.meal_plan_entries;
create trigger meal_plan_touch before update on public.meal_plan_entries
  for each row execute function public.touch_updated_at();

alter table public.meal_plan_entries enable row level security;

drop policy if exists "meal_plan_select_own" on public.meal_plan_entries;
drop policy if exists "meal_plan_insert_own" on public.meal_plan_entries;
drop policy if exists "meal_plan_update_own" on public.meal_plan_entries;
drop policy if exists "meal_plan_delete_own" on public.meal_plan_entries;

create policy "meal_plan_select_own" on public.meal_plan_entries for select using (auth.uid() = user_id);
create policy "meal_plan_insert_own" on public.meal_plan_entries for insert with check (auth.uid() = user_id);
create policy "meal_plan_update_own" on public.meal_plan_entries for update using (auth.uid() = user_id);
create policy "meal_plan_delete_own" on public.meal_plan_entries for delete using (auth.uid() = user_id);

-- =====================================================================
-- 4. pantry_items
-- =====================================================================
create table if not exists public.pantry_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists pantry_user_updated_idx on public.pantry_items(user_id, updated_at);

drop trigger if exists pantry_touch on public.pantry_items;
create trigger pantry_touch before update on public.pantry_items
  for each row execute function public.touch_updated_at();

alter table public.pantry_items enable row level security;

drop policy if exists "pantry_select_own" on public.pantry_items;
drop policy if exists "pantry_insert_own" on public.pantry_items;
drop policy if exists "pantry_update_own" on public.pantry_items;
drop policy if exists "pantry_delete_own" on public.pantry_items;

create policy "pantry_select_own" on public.pantry_items for select using (auth.uid() = user_id);
create policy "pantry_insert_own" on public.pantry_items for insert with check (auth.uid() = user_id);
create policy "pantry_update_own" on public.pantry_items for update using (auth.uid() = user_id);
create policy "pantry_delete_own" on public.pantry_items for delete using (auth.uid() = user_id);

-- =====================================================================
-- 5. price_overrides (keyed by normalizeName() output, per user)
-- =====================================================================
create table if not exists public.price_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_name text not null,
  display_name text not null,
  price_per_unit numeric not null,
  unit text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, normalized_name)
);

create index if not exists price_overrides_user_updated_idx on public.price_overrides(user_id, updated_at);

drop trigger if exists price_overrides_touch on public.price_overrides;
create trigger price_overrides_touch before update on public.price_overrides
  for each row execute function public.touch_updated_at();

alter table public.price_overrides enable row level security;

drop policy if exists "price_overrides_select_own" on public.price_overrides;
drop policy if exists "price_overrides_insert_own" on public.price_overrides;
drop policy if exists "price_overrides_update_own" on public.price_overrides;
drop policy if exists "price_overrides_delete_own" on public.price_overrides;

create policy "price_overrides_select_own" on public.price_overrides for select using (auth.uid() = user_id);
create policy "price_overrides_insert_own" on public.price_overrides for insert with check (auth.uid() = user_id);
create policy "price_overrides_update_own" on public.price_overrides for update using (auth.uid() = user_id);
create policy "price_overrides_delete_own" on public.price_overrides for delete using (auth.uid() = user_id);

-- =====================================================================
-- 6. user_settings (single row per user; macro grams added)
-- =====================================================================
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_calorie_target int not null default 2000,
  protein_pct int not null default 30,
  carbs_pct int not null default 40,
  fat_pct int not null default 30,
  protein_g int not null default 150,
  carbs_g int not null default 200,
  fat_g int not null default 67,
  reduce_visual_effects boolean not null default false,
  updated_at timestamptz not null default now()
);

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "user_settings_select_own" on public.user_settings;
drop policy if exists "user_settings_insert_own" on public.user_settings;
drop policy if exists "user_settings_update_own" on public.user_settings;
drop policy if exists "user_settings_delete_own" on public.user_settings;

create policy "user_settings_select_own" on public.user_settings for select using (auth.uid() = user_id);
create policy "user_settings_insert_own" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "user_settings_update_own" on public.user_settings for update using (auth.uid() = user_id);
create policy "user_settings_delete_own" on public.user_settings for delete using (auth.uid() = user_id);

-- =====================================================================
-- Auto-provision profile + settings on signup
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;
  insert into public.user_settings(user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Onboarding columns on user_settings
-- Idempotent: safe on first run, no-op on subsequent runs. All defaults
-- are constants → Postgres 11+ treats this as a metadata-only update,
-- no table rewrite, no write lock.
-- =====================================================================
alter table public.user_settings
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists cuisine_preferences  jsonb   not null default '[]'::jsonb,
  add column if not exists dietary_restrictions jsonb   not null default '[]'::jsonb,
  add column if not exists cooking_frequency    text    not null default 'few_days',
  add column if not exists cooking_ease_preference numeric not null default 0.5,
  add column if not exists tdee_inputs          jsonb;

-- =====================================================================
-- Global curated meal catalog (public read, NO user_id, NOT per-user synced)
-- The bundled src/data/mealCatalog.json is the offline source of truth; this
-- table is the updatable server mirror that refreshMealCatalogCache() pulls.
-- `id` is a stable slug (text), not a uuid. Writes go through the SQL editor /
-- service role only — there is intentionally no client write policy.
-- =====================================================================
create table if not exists public.meals (
  id text primary key,
  title text not null,
  cuisine text not null,
  slots text[] not null default '{}',
  dietary_tags text[] not null default '{}',
  servings numeric not null default 1,
  ingredients jsonb not null default '[]'::jsonb,
  nutrition_per_serving jsonb not null,
  prep_time_minutes int,
  image_url text,
  instructions text[],
  updated_at timestamptz not null default now()
);

drop trigger if exists meals_touch on public.meals;
create trigger meals_touch before update on public.meals
  for each row execute function public.touch_updated_at();

alter table public.meals enable row level security;

drop policy if exists "meals_public_read" on public.meals;
create policy "meals_public_read" on public.meals for select using (true);

-- =====================================================================
-- Live ingredient prices (public read, NO user_id, NOT per-user synced)
--
-- Refreshed weekly from a retail price API by scripts/refreshKrogerPrices.ts
-- (run from CI with the service-role key). The bundled src/data/priceDatabase.json
-- stays the offline floor and the test-enforced source of truth; this table is an
-- OVERLAY that findPrice() consults on exact normalized match only.
--
-- INVARIANT: `unit` must equal the bundled priceDatabase.json row's unit for the
-- same key. getProfile() derives its default sell unit from the price entry's unit
-- (src/utils/purchaseProfile.ts), and roundToPurchasable() branches on that unit's
-- family -- publishing a different unit here would silently change rounding
-- behavior. The refresh script rejects any conversion it can't land in the
-- baseline unit, and the client re-checks on ingest.
--
-- Kill switch: `truncate public.prices` reverts every device to the bundled
-- prices on its next refresh.
-- =====================================================================
create table if not exists public.prices (
  normalized_name text primary key,
  price_per_unit numeric not null check (price_per_unit > 0),
  unit text not null,
  source text not null,
  confidence numeric,
  as_of timestamptz not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists prices_touch on public.prices;
create trigger prices_touch before update on public.prices
  for each row execute function public.touch_updated_at();

alter table public.prices enable row level security;

drop policy if exists "prices_public_read" on public.prices;
create policy "prices_public_read" on public.prices for select using (true);

-- =====================================================================
-- Ingredient -> retail SKU mapping and review state (INTERNAL).
--
-- RLS is enabled with NO policies at all, so no anon/authenticated client can
-- read or write it -- only the service role (which bypasses RLS) touches this.
-- Seeded from priceDatabase.json keys by scripts/buildPriceSourcesSeed.ts.
--
-- `reviewed` marks a mapping a human has vetted: reviewed rows pin their
-- kroger_product_id and are never re-searched, so review work is permanent.
-- Unreviewed rows are re-resolved on every run, which also self-heals
-- discontinued SKUs. baseline_* mirrors the bundled JSON and is the anchor the
-- sanity band compares candidate prices against.
-- =====================================================================
create table if not exists public.price_sources (
  normalized_name text primary key,
  search_term text not null,
  kroger_product_id text,
  kroger_description text,
  reviewed boolean not null default false,
  confidence numeric,
  baseline_price_per_unit numeric not null,
  baseline_unit text not null,
  last_resolved_at timestamptz,
  last_status text,
  notes text,
  -- How the store sells this ingredient: { sellUnit, packSize, grams? }, mirrored
  -- from src/data/purchaseProfiles.json by scripts/buildPriceSourcesSeed.ts.
  --
  -- Carried on the row because the on-demand edge function needs it to price a
  -- cross-family SKU (bread sized "24 oz" but bought per `each`, beans sized
  -- "15.5 oz" but bought per `can`) and cannot import the app's purchaseProfile
  -- module -- that one reaches findPrice and therefore fuse.js. Null means the
  -- default { sellUnit: baseline_unit, packSize: 1 }, which is what getProfile()
  -- derives for an ingredient with no explicit entry.
  purchase_profile jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists price_sources_touch on public.price_sources;
create trigger price_sources_touch before update on public.price_sources
  for each row execute function public.touch_updated_at();

-- Enabled with zero policies on purpose: service-role access only.
alter table public.price_sources enable row level security;

-- =====================================================================
-- Runtime configuration (public read, service-role write)
--
-- Knobs the pricing pipeline reads at run time, so freshness and cost can be
-- retuned with one SQL statement instead of a redeploy or an app release.
--
-- Public-read is intentional and safe: no secrets live here, and the client
-- needs `ondemand_enabled` / `ondemand_batch_max` before it can decide whether
-- to ask for a price at all. No write policy, so only the service role changes
-- values.
--
--   price_ttl_days          how old a public.prices row may be before an
--                           on-demand request re-resolves it against Kroger.
--                           Distinct from the client's MAX_PRICE_AGE_DAYS = 60,
--                           which is the hard floor past which a row is ignored
--                           entirely. Default 14 matches how long the top-up
--                           budget takes to cycle the whole catalog.
--   ondemand_enabled        kill switch for on-demand resolution.
--   ondemand_batch_max      names one resolve-prices call will accept.
--   ondemand_store_count    reference stores an on-demand resolve medians
--                           across. Deliberately far below the weekly job's 12:
--                           a user is waiting on this one.
--   ondemand_lease_seconds  how long one invocation owns an ingredient before
--                           another may retry it. Stops two devices asking for
--                           the same stale ingredient from both calling Kroger.
--   topup_run_call_budget   hard ceiling on Kroger calls per weekly run, so the
--                           job cannot grow into the 10,000/day quota as the
--                           catalog grows.
--   demand_promote_threshold  requests an unknown ingredient needs before it is
--                           worth adding to the catalog.
-- =====================================================================
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch before update on public.app_config
  for each row execute function public.touch_updated_at();

alter table public.app_config enable row level security;

drop policy if exists "app_config_public_read" on public.app_config;
create policy "app_config_public_read" on public.app_config for select using (true);

-- Defaults only. `on conflict do nothing` so re-running schema.sql never
-- reverts a value that was tuned in production.
insert into public.app_config (key, value) values
  ('price_ttl_days', '14'),
  ('ondemand_enabled', 'true'),
  ('ondemand_batch_max', '5'),
  ('ondemand_store_count', '3'),
  ('ondemand_lease_seconds', '120'),
  ('topup_run_call_budget', '6000'),
  ('demand_promote_threshold', '5')
on conflict (key) do nothing;

-- =====================================================================
-- Ingredient demand counter (INTERNAL)
--
-- One row per normalized ingredient name that has appeared on somebody's
-- grocery list. Two jobs:
--
--  1. It orders the weekly top-up. With a catalog of several hundred keys a
--     full 12-store sweep no longer fits the daily quota, so the budget goes to
--     what people actually buy rather than to alphabetical order.
--  2. It is how the catalog grows. An ingredient nobody has priced yet still
--     lands here with in_catalog = false, so `--report-demand` can surface the
--     names worth enrolling instead of guessing at them.
--
-- Deliberately carries NO user_id. It is an aggregate popularity counter, so it
-- holds no per-user data, needs no ownership policy, and cannot leak one user's
-- list to another. RLS is on with zero policies: service role only.
-- =====================================================================
create table if not exists public.ingredient_demand (
  normalized_name text primary key,
  request_count integer not null default 0,
  first_requested_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  -- Whether this name is in price_sources, i.e. whether we can price it at all.
  in_catalog boolean not null default false,
  -- Set by hand once an unknown name has been added to priceDatabase.json.
  promoted boolean not null default false
);

alter table public.ingredient_demand enable row level security;

-- Partial index: the promotion query only ever asks for names we cannot price.
create index if not exists ingredient_demand_pending_idx
  on public.ingredient_demand (request_count desc)
  where not in_catalog;

-- The top-up job scans for the least recently resolved rows first.
create index if not exists price_sources_stale_idx
  on public.price_sources (last_resolved_at nulls first);

-- Atomic upsert-increment for the demand counter.
--
-- A read-modify-write from the edge function would lose counts whenever two
-- devices report the same ingredient concurrently, which is exactly the case that
-- matters: a popular ingredient is the one being double-counted, and its count is
-- what orders the weekly top-up.
create or replace function public.bump_ingredient_demand(
  p_normalized_name text,
  p_in_catalog boolean
)
returns void
language sql
set search_path = public, pg_temp
as $$
  insert into public.ingredient_demand (normalized_name, request_count, in_catalog)
  values (p_normalized_name, 1, p_in_catalog)
  on conflict (normalized_name) do update set
    request_count = public.ingredient_demand.request_count + 1,
    last_requested_at = now(),
    -- An ingredient can become priceable after it was first requested; never flip
    -- it back, since enrollment is one-way.
    in_catalog = public.ingredient_demand.in_catalog or excluded.in_catalog;
$$;

-- Service role only, same as the table it writes.
revoke execute on function public.bump_ingredient_demand(text, boolean) from anon, authenticated;
