---
name: update-meal-catalog
description: Add or edit meals in the shared meal catalog (src/data/mealCatalog.json) and publish the change to the Supabase-backed public.meals mirror. Use when the user wants to add a meal, edit an existing meal's ingredients/instructions/image, or otherwise update the catalog that mealPlanner.ts draws from.
---

# Update the meal catalog

1. Edit `src/data/mealCatalog.json` directly (add/edit a meal entry — every ingredient must resolve via `findPrice` and use a known unit, see `CLAUDE.md`'s "Things that are easy to get wrong").
2. Run `npm run seed:build` — regenerates `supabase/seed_meals.sql` (idempotent upsert, includes `image_url`/`instructions`).
3. **If you added any new `src/data/priceDatabase.json` keys** (step 1 forces this for unrecognized ingredients), also run `npm run prices:seed-sources` — regenerates `supabase/seed_price_sources.sql` so the new ingredients enroll in the weekly live price refresh. Safe to re-run: the upsert never touches `reviewed`, `kroger_product_id`, or `notes`, so human review work survives.
4. Apply the generated SQL via the Supabase SQL editor / service role, or the Supabase MCP.

A newly enrolled ingredient prices off its bundled hand-estimate until the next weekly run auto-matches it — no mapping work needed, and nothing breaks if the match is rejected.

Branch previews need the Supabase Pro plan — a free-tier project can't preview this change on a branch before merging.
