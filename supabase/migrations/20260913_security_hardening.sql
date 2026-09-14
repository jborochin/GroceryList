-- Security hardening, 2026-09-13. Idempotent: safe to re-run.
-- Mirrored into schema.sql so a fresh project lands in the same state.

-- =====================================================================
-- 1. recipes are owned: primary key (user_id, id), not id alone.
--
-- Catalog clones and seed recipes carry a DETERMINISTIC id (UUIDv5 of the meal
-- slug, src/utils/deterministicId.ts), so every account produces the same id
-- for the same meal. With `id` as the whole key the first account to sync a
-- clone owned the row: every other account's upsert of that id hit a row its
-- RLS UPDATE policy can't see (42501), landed in the outbox, and was retried
-- forever. Worse, meal_plan_entries.recipe_id referenced recipes(id) ON DELETE
-- CASCADE, so deleting one user's auth row hard-deleted the shared recipe and
-- cascaded into EVERY user's plan entries for it.
-- =====================================================================
do $$
begin
  -- Old single-column FK from meal_plan_entries, if present.
  if exists (
    select 1 from pg_constraint where conname = 'meal_plan_entries_recipe_id_fkey'
  ) then
    alter table public.meal_plan_entries drop constraint meal_plan_entries_recipe_id_fkey;
  end if;

  -- Replace a single-column recipes PK with the composite one.
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'recipes' and c.contype = 'p'
      and array_length(c.conkey, 1) = 1
  ) then
    alter table public.recipes drop constraint recipes_pkey;
    alter table public.recipes add constraint recipes_pkey primary key (user_id, id);
  end if;

  -- Composite FK: a plan entry can only point at a recipe its own user owns.
  if not exists (
    select 1 from pg_constraint where conname = 'meal_plan_entries_recipe_fkey'
  ) then
    alter table public.meal_plan_entries
      add constraint meal_plan_entries_recipe_fkey
      foreign key (user_id, recipe_id) references public.recipes(user_id, id) on delete cascade;
  end if;
end $$;

-- =====================================================================
-- 2. Function grants and search_path.
--
-- `revoke ... from anon, authenticated` never removed anything: Postgres grants
-- EXECUTE to PUBLIC on every new function, and those two roles inherit it.
-- Revoke from PUBLIC as well. handle_new_user is SECURITY DEFINER and fires from
-- the auth service's insert, so that role keeps an explicit grant.
-- =====================================================================
revoke execute on function public.bump_ingredient_demand(text, boolean) from public, anon, authenticated;
grant execute on function public.bump_ingredient_demand(text, boolean) to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;
  insert into public.user_settings(user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
