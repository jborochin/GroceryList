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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

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
