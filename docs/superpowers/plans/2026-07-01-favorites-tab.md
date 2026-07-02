# Favorites Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Favorites segment to the Recipes screen where users can heart personal recipes and catalog meals to surface them in a dedicated tab.

**Architecture:** A new persisted `useFavoritesStore` holds a flat array of favorited IDs shared across both recipe types. Cards get a heart overlay (top-left) that toggles favorites. `RecipeLibraryScreen` adds a third segment that renders a merged grid of favorited recipes and meals.

**Tech Stack:** Zustand + AsyncStorage (persist), React Native (View/Pressable), MaterialCommunityIcons via `IconButton`, Expo/React Native.

## Global Constraints

- Heart icon goes **top-left** on all cards (delete stays top-right on RecipeGridCard; add/check stays top-right on MealCatalogCard)
- Forest-green filled heart `#3A5C42` when favorited; `heart-outline` when not
- No search bar in Favorites mode (YAGNI)
- FAB ("Add recipe") visible only in `mode === 'mine'`
- No changes to `Recipe` type in `src/types/index.ts`
- New store must be added to `hydration.ts` or it silently blocks hydration (CLAUDE.md)
- No Supabase sync — offline-only

---

## File Map

| Action | Path |
|--------|------|
| Modify | `src/store/storage.ts` |
| Create | `src/store/useFavoritesStore.ts` |
| Modify | `src/store/hydration.ts` |
| Modify | `src/components/RecipeGridCard.tsx` |
| Modify | `src/components/MealCatalogCard.tsx` |
| Modify | `src/screens/RecipeLibraryScreen.tsx` |

---

### Task 1: Favorites store + hydration wiring

**Files:**
- Modify: `src/store/storage.ts`
- Create: `src/store/useFavoritesStore.ts`
- Modify: `src/store/hydration.ts`

**Interfaces:**
- Produces: `useFavoritesStore` with `favoriteIds: string[]`, `toggleFavorite(id: string): void`, `isFavorite(id: string): boolean`

- [ ] **Step 1: Add storage key**

In `src/store/storage.ts`, add `favorites` to the `STORAGE_KEYS` object:

```ts
export const STORAGE_KEYS = {
  recipes: 'mealprep/recipes/v1',
  mealPlan: 'mealprep/mealPlan/v1',
  mealSchedule: 'mealprep/mealSchedule/v1',
  mealDisposition: 'mealprep/mealDisposition/v1',
  pantry: 'mealprep/pantry/v1',
  manualItems: 'mealprep/manualItems/v1',
  dismissedItems: 'mealprep/dismissedItems/v1',
  settings: 'mealprep/settings/v1',
  priceOverrides: 'mealprep/priceOverrides/v1',
  seeded: 'mealprep/seeded/v1',
  lastSyncedAt: 'mealprep/sync/lastSyncedAt/v1',
  outbox: 'mealprep/sync/outbox/v1',
  migratedAccountId: 'mealprep/sync/migratedAccountId/v1',
  mealCatalogCache: 'mealprep/mealCatalog/v1',
  favorites: 'mealprep/favorites/v1',
} as const;
```

- [ ] **Step 2: Create the favorites store**

Create `src/store/useFavoritesStore.ts`:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage, STORAGE_KEYS } from './storage';

interface FavoritesState {
  favoriteIds: string[];
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favoriteIds: [],
      toggleFavorite: (id) =>
        set((s) => ({
          favoriteIds: s.favoriteIds.includes(id)
            ? s.favoriteIds.filter((fid) => fid !== id)
            : [...s.favoriteIds, id],
        })),
      isFavorite: (id) => get().favoriteIds.includes(id),
    }),
    {
      name: STORAGE_KEYS.favorites,
      storage: zustandStorage,
    }
  )
);
```

- [ ] **Step 3: Wire into hydration**

In `src/store/hydration.ts`, import and add `useFavoritesStore` to the `stores` array:

```ts
import { useRecipeStore } from './useRecipeStore';
import { useMealPlanStore } from './useMealPlanStore';
import { useMealScheduleStore } from './useMealScheduleStore';
import { useMealDispositionStore } from './useMealDispositionStore';
import { usePantryStore } from './usePantryStore';
import { useManualItemStore } from './useManualItemStore';
import { useDismissedItemStore } from './useDismissedItemStore';
import { useSettingsStore } from './useSettingsStore';
import { usePriceOverrideStore } from './usePriceOverrideStore';
import { useAuthStore } from './useAuthStore';
import { useFavoritesStore } from './useFavoritesStore';

const stores = [useRecipeStore, useMealPlanStore, useMealScheduleStore, useMealDispositionStore, usePantryStore, useManualItemStore, useDismissedItemStore, useSettingsStore, usePriceOverrideStore, useFavoritesStore];
```

The rest of `hydration.ts` is unchanged.

- [ ] **Step 4: Type-check**

```
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add src/store/storage.ts src/store/useFavoritesStore.ts src/store/hydration.ts
git commit -m "feat: add useFavoritesStore with toggle + persistence"
```

---

### Task 2: Heart overlay on RecipeGridCard

**Files:**
- Modify: `src/components/RecipeGridCard.tsx`

**Interfaces:**
- Consumes: `useFavoritesStore` is NOT imported here — props flow from the screen
- Produces: `RecipeGridCard` accepts `isFavorited?: boolean` and `onFavorite?: () => void`

- [ ] **Step 1: Add props and heart button**

Replace the full `src/components/RecipeGridCard.tsx` content with:

```tsx
import React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../theme/tokens';
import { Recipe } from '../types';
import { Text } from './ui/Text';
import { IconButton } from './ui/IconButton';

interface Props {
  recipe: Recipe;
  onPress?: () => void;
  onDelete?: () => void;
  isFavorited?: boolean;
  onFavorite?: () => void;
  // Horizontal padding + column gap the parent grid applies, so the card can
  // size itself to exactly half the row (keeps a lone trailing card half-width
  // instead of stretching, which `flex: 1` would do).
  horizontalPadding: number;
  columnGap: number;
}

export function RecipeGridCard({ recipe, onPress, onDelete, isFavorited, onFavorite, horizontalPadding, columnGap }: Props) {
  const t = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = (screenWidth - horizontalPadding * 2 - columnGap) / 2;

  const cal = recipe.nutritionPerServing?.calories;
  const protein = recipe.nutritionPerServing?.proteinG;
  const macroParts: string[] = [];
  if (cal) macroParts.push(`${Math.round(cal)} cal`);
  if (protein) macroParts.push(`${Math.round(protein)}g protein`);
  const macroLine = macroParts.join('  ·  ');

  const initial = (recipe.title.trim().charAt(0) || '?').toUpperCase();
  const a11yLabel = [recipe.title, macroParts.join(', ')].filter(Boolean).join('. ');

  // The delete and favorite controls are sibling overlays (not children of the
  // card Pressable): nesting a button inside a button is invalid DOM on web and
  // breaks hit-testing.
  return (
    <View
      style={{
        width: cardWidth,
        aspectRatio: 0.82,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: t.palette.surfaceMuted,
        ...t.shadow.soft,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.92 : 1 })}
      >
        {recipe.imageUrl ? (
          <Image
            source={{ uri: recipe.imageUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={200}
            recyclingKey={recipe.id}
          />
        ) : (
          // Fallback: themed gradient tile with the recipe initial — mirrors the
          // letter avatar used by the list RecipeCard so the grid stays cohesive.
          <LinearGradient
            colors={[t.palette.primary, t.palette.primarySoftText]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="hero" weight="bold" style={{ color: t.palette.primaryContrast }}>
              {initial}
            </Text>
          </LinearGradient>
        )}

        {/* Bottom scrim so the title/macros stay legible over any photo. */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.72)']}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '60%',
            justifyContent: 'flex-end',
            padding: t.spacing.md,
          }}
        >
          <Text variant="body" weight="semibold" numberOfLines={2} style={{ color: '#FFFFFF' }}>
            {recipe.title}
          </Text>
          {macroLine ? (
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: 'rgba(255,255,255,0.92)', marginTop: 2 }}
            >
              {macroLine}
            </Text>
          ) : null}
        </LinearGradient>
      </Pressable>

      {/* Heart — top-left; delete — top-right. Shown independently. */}
      {onFavorite != null ? (
        <View style={{ position: 'absolute', top: t.spacing.xs, left: t.spacing.xs }}>
          <IconButton
            icon={isFavorited ? 'heart' : 'heart-outline'}
            variant="soft"
            size={18}
            color={isFavorited ? t.palette.primary : t.palette.textInverse}
            onPress={onFavorite}
            accessibilityLabel={isFavorited ? `Unfavorite ${recipe.title}` : `Favorite ${recipe.title}`}
            style={{
              backgroundColor: 'rgba(24, 28, 22, 0.55)',
              ...t.shadow.soft,
            }}
          />
        </View>
      ) : null}

      {onDelete ? (
        <View style={{ position: 'absolute', top: t.spacing.xs, right: t.spacing.xs }}>
          <IconButton
            icon="delete-outline"
            variant="danger"
            size={18}
            color={t.palette.textInverse}
            onPress={onDelete}
            accessibilityLabel={`Delete ${recipe.title}`}
            style={{
              backgroundColor: 'rgba(24, 28, 22, 0.55)',
              ...t.shadow.soft,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Type-check**

```
npm run typecheck
```

Expected: no errors. (RecipeLibraryScreen will show an error until Task 4 passes the new props — that's fine for now since the props are optional.)

- [ ] **Step 3: Commit**

```
git add src/components/RecipeGridCard.tsx
git commit -m "feat: add heart overlay to RecipeGridCard"
```

---

### Task 3: Heart overlay on MealCatalogCard

**Files:**
- Modify: `src/components/MealCatalogCard.tsx`

**Interfaces:**
- Produces: `MealCatalogCard` accepts `isFavorited?: boolean` and `onFavorite?: () => void`

- [ ] **Step 1: Add props and heart button**

Replace the full `src/components/MealCatalogCard.tsx` content with:

```tsx
import React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../theme/tokens';
import { Meal } from '../types';
import { Text } from './ui/Text';
import { IconButton } from './ui/IconButton';

interface Props {
  meal: Meal;
  onPress?: () => void;
  // Whether this catalog meal is already in the user's library — controls the
  // corner affordance (add "+" vs. an "added" check).
  added?: boolean;
  onAdd?: () => void;
  isFavorited?: boolean;
  onFavorite?: () => void;
  // Horizontal padding + column gap the parent grid applies (see RecipeGridCard).
  horizontalPadding: number;
  columnGap: number;
}

// Visual twin of RecipeGridCard, but bound to a catalog `Meal` and carrying an
// add/added affordance instead of delete. Kept separate so the recipe card stays
// focused on user-owned recipes (delete, edit) and types stay honest.
export function MealCatalogCard({ meal, onPress, added, onAdd, isFavorited, onFavorite, horizontalPadding, columnGap }: Props) {
  const t = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = (screenWidth - horizontalPadding * 2 - columnGap) / 2;

  const cal = meal.nutritionPerServing?.calories;
  const protein = meal.nutritionPerServing?.proteinG;
  const macroParts: string[] = [];
  if (cal) macroParts.push(`${Math.round(cal)} cal`);
  if (protein) macroParts.push(`${Math.round(protein)}g protein`);
  const macroLine = macroParts.join('  ·  ');

  const initial = (meal.title.trim().charAt(0) || '?').toUpperCase();
  const a11yLabel = [meal.title, macroParts.join(', ')].filter(Boolean).join('. ');

  return (
    <View
      style={{
        width: cardWidth,
        aspectRatio: 0.82,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: t.palette.surfaceMuted,
        ...t.shadow.soft,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.92 : 1 })}
      >
        {meal.imageUrl ? (
          <Image
            source={{ uri: meal.imageUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={200}
            recyclingKey={meal.id}
          />
        ) : (
          <LinearGradient
            colors={[t.palette.primary, t.palette.primarySoftText]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="hero" weight="bold" style={{ color: t.palette.primaryContrast }}>
              {initial}
            </Text>
          </LinearGradient>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.72)']}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '60%',
            justifyContent: 'flex-end',
            padding: t.spacing.md,
          }}
        >
          <Text variant="body" weight="semibold" numberOfLines={2} style={{ color: '#FFFFFF' }}>
            {meal.title}
          </Text>
          {macroLine ? (
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: 'rgba(255,255,255,0.92)', marginTop: 2 }}
            >
              {macroLine}
            </Text>
          ) : null}
        </LinearGradient>
      </Pressable>

      {/* Heart — top-left. */}
      {onFavorite != null ? (
        <View style={{ position: 'absolute', top: t.spacing.xs, left: t.spacing.xs }}>
          <IconButton
            icon={isFavorited ? 'heart' : 'heart-outline'}
            variant="soft"
            size={18}
            color={isFavorited ? t.palette.primary : t.palette.textInverse}
            onPress={onFavorite}
            accessibilityLabel={isFavorited ? `Unfavorite ${meal.title}` : `Favorite ${meal.title}`}
            style={{
              backgroundColor: 'rgba(24, 28, 22, 0.55)',
              ...t.shadow.soft,
            }}
          />
        </View>
      ) : null}

      {/* Add / added — top-right. */}
      <View style={{ position: 'absolute', top: t.spacing.xs, right: t.spacing.xs }}>
        {added ? (
          <IconButton
            icon="check"
            variant="soft"
            size={18}
            color={t.palette.success}
            haptic={false}
            accessibilityLabel={`${meal.title} is in your recipes`}
            style={{
              backgroundColor: 'rgba(24, 28, 22, 0.55)',
              ...t.shadow.soft,
            }}
          />
        ) : (
          <IconButton
            icon="plus"
            variant="soft"
            size={18}
            color={t.palette.textInverse}
            onPress={onAdd}
            accessibilityLabel={`Add ${meal.title} to my recipes`}
            style={{
              backgroundColor: 'rgba(24, 28, 22, 0.55)',
              ...t.shadow.soft,
            }}
          />
        )}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Type-check**

```
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add src/components/MealCatalogCard.tsx
git commit -m "feat: add heart overlay to MealCatalogCard"
```

---

### Task 4: Favorites segment in RecipeLibraryScreen

**Files:**
- Modify: `src/screens/RecipeLibraryScreen.tsx`

**Interfaces:**
- Consumes: `useFavoritesStore` — `favoriteIds: string[]`, `toggleFavorite(id: string): void`
- Consumes: `RecipeGridCard` — `isFavorited?: boolean`, `onFavorite?: () => void`
- Consumes: `MealCatalogCard` — `isFavorited?: boolean`, `onFavorite?: () => void`

- [ ] **Step 1: Rewrite RecipeLibraryScreen**

Replace the full content of `src/screens/RecipeLibraryScreen.tsx` with:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeStore } from '../store/useRecipeStore';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { RecipeGridCard } from '../components/RecipeGridCard';
import { MealCatalogCard } from '../components/MealCatalogCard';
import { EmptyState } from '../components/EmptyState';
import { RootStackParamList } from '../navigation/types';
import { Meal, MealSlot, Recipe } from '../types';
import {
  getMealCatalog,
  loadMealCatalogCache,
  refreshMealCatalogCache,
} from '../lib/mealCatalogSync';
import { mealToRecipe, recipeIdForMeal } from '../utils/commitMealPlan';
import { useAppTheme } from '../theme/tokens';
import { confirm } from '../utils/confirm';
import foodPreferences from '../data/foodPreferences.json';
import {
  AmbientBackground,
  CollapsingHeader,
  Header,
  Input,
  Button,
  Pill,
  SegmentedControl,
  Text,
  TAB_BAR_SPACE,
  useToast,
} from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Mode = 'mine' | 'browse' | 'favorites';

const CUISINE_LABEL: Record<string, string> = Object.fromEntries(
  foodPreferences.cuisines.map((c) => [c.key, c.label])
);
const DIETARY_LABEL: Record<string, string> = Object.fromEntries(
  foodPreferences.dietary.map((d) => [d.key, d.label])
);
const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

// Discriminates a Meal from a Recipe: Meal has `cuisine`, Recipe does not.
function isMealItem(item: Recipe | Meal): item is Meal {
  return 'cuisine' in item;
}

export function RecipeLibraryScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const deleteRecipe = useRecipeStore((s) => s.deleteRecipe);
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('mine');
  const [query, setQuery] = useState('');
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [dietary, setDietary] = useState<string | null>(null);
  const [slot, setSlot] = useState<MealSlot | null>(null);

  // Catalog is synchronous (cache or bundled); refresh the server mirror once on
  // mount and re-read so a newer catalog shows without an app release.
  const [catalog, setCatalog] = useState<Meal[]>(() => getMealCatalog());
  useEffect(() => {
    let active = true;
    loadMealCatalogCache()
      .then(() => {
        if (active) setCatalog(getMealCatalog());
        return refreshMealCatalogCache();
      })
      .then(() => {
        if (active) setCatalog(getMealCatalog());
      });
    return () => {
      active = false;
    };
  }, []);

  // O(1) favorite membership test — recomputed only when favoriteIds changes.
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  // Recipe ids already in the library, to flag catalog meals as added.
  const libraryIds = useMemo(() => new Set(recipes.map((r) => r.id)), [recipes]);

  const handleDelete = async (id: string, title: string) => {
    const ok = await confirm({
      title: `Delete ${title}?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteRecipe(id);
  };

  const handleAddMeal = (meal: Meal) => {
    useRecipeStore.getState().upsertRecipe(mealToRecipe(meal));
    toast.show({ message: `Added ${meal.title} to your recipes`, tone: 'success' });
  };

  const filteredRecipes = useMemo(() => {
    if (!query.trim()) return recipes;
    const q = query.trim().toLowerCase();
    return recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    );
  }, [recipes, query]);

  const availableCuisines = useMemo(
    () => Array.from(new Set(catalog.map((m) => m.cuisine))).sort(),
    [catalog]
  );
  const availableDietary = useMemo(
    () => Array.from(new Set(catalog.flatMap((m) => m.dietaryTags))).sort(),
    [catalog]
  );

  const filteredMeals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((m) => {
      if (cuisine && m.cuisine !== cuisine) return false;
      if (dietary && !m.dietaryTags.includes(dietary)) return false;
      if (slot && !m.slots.includes(slot)) return false;
      if (q) {
        const match =
          m.title.toLowerCase().includes(q) ||
          m.ingredients.some((i) => i.name.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [catalog, query, cuisine, dietary, slot]);

  const favoritedRecipes = useMemo(
    () => recipes.filter((r) => favoriteSet.has(r.id)),
    [recipes, favoriteSet]
  );
  const favoritedMeals = useMemo(
    () => catalog.filter((m) => favoriteSet.has(m.id)),
    [catalog, favoriteSet]
  );

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const browsing = mode === 'browse';
  const showingFavorites = mode === 'favorites';

  const data: Array<Recipe | Meal> =
    mode === 'browse'
      ? filteredMeals
      : mode === 'favorites'
        ? [...favoritedRecipes, ...favoritedMeals]
        : filteredRecipes;

  const headerSubtitle = showingFavorites
    ? `${favoritedRecipes.length + favoritedMeals.length} favorited`
    : browsing
      ? `${catalog.length} meals to explore`
      : recipes.length === 0
        ? 'Build your library to start planning.'
        : `${recipes.length} saved`;

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <Animated.FlatList
        // Re-key on mode so the grid resets scroll/recycling when toggling.
        key={mode}
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: TAB_BAR_SPACE + t.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        numColumns={2}
        columnWrapperStyle={{ gap: t.spacing.md }}
        ItemSeparatorComponent={() => <View style={{ height: t.spacing.md }} />}
        ListHeaderComponent={
          <View>
            <Header title="Recipes" subtitle={headerSubtitle} />
            <View style={{ marginBottom: t.spacing.lg }}>
              <SegmentedControl<Mode>
                value={mode}
                onChange={setMode}
                items={[
                  { value: 'mine', label: 'My Recipes', icon: 'bookmark-outline' },
                  { value: 'browse', label: 'Browse', icon: 'earth' },
                  { value: 'favorites', label: 'Favorites', icon: 'heart' },
                ]}
              />
            </View>
            {!showingFavorites && (browsing || recipes.length > 0) && (
              <View style={{ marginBottom: t.spacing.md }}>
                <Input
                  placeholder={browsing ? 'Search the catalog' : 'Search recipes or ingredients'}
                  value={query}
                  onChangeText={setQuery}
                  leftIcon="magnify"
                  rightIcon={query ? 'close-circle' : undefined}
                  onRightPress={query ? () => setQuery('') : undefined}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            )}
            {browsing && (
              <View style={{ marginBottom: t.spacing.md, gap: t.spacing.sm }}>
                <ChipRow
                  options={SLOT_ORDER.map((s) => ({ key: s, label: SLOT_LABEL[s] }))}
                  selected={slot}
                  onToggle={(k) => setSlot((prev) => (prev === k ? null : (k as MealSlot)))}
                />
                <ChipRow
                  options={availableCuisines.map((c) => ({ key: c, label: CUISINE_LABEL[c] ?? c }))}
                  selected={cuisine}
                  onToggle={(k) => setCuisine((prev) => (prev === k ? null : k))}
                />
                <ChipRow
                  options={availableDietary.map((d) => ({ key: d, label: DIETARY_LABEL[d] ?? d }))}
                  selected={dietary}
                  onToggle={(k) => setDietary((prev) => (prev === k ? null : k))}
                />
              </View>
            )}
            {mode === 'mine' && filteredRecipes.length > 0 && query ? (
              <Text variant="caption" tone="tertiary" style={{ marginBottom: t.spacing.sm }}>
                {filteredRecipes.length} {filteredRecipes.length === 1 ? 'match' : 'matches'}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          if (isMealItem(item)) {
            return (
              <MealCatalogCard
                meal={item}
                added={libraryIds.has(recipeIdForMeal(item.id))}
                onAdd={() => handleAddMeal(item)}
                onPress={() => navigation.navigate('MealCatalogDetail', { mealId: item.id })}
                isFavorited={favoriteSet.has(item.id)}
                onFavorite={() => toggleFavorite(item.id)}
                horizontalPadding={t.spacing.lg}
                columnGap={t.spacing.md}
              />
            );
          }
          return (
            <RecipeGridCard
              recipe={item}
              onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}
              onDelete={mode === 'mine' ? () => handleDelete(item.id, item.title) : undefined}
              isFavorited={favoriteSet.has(item.id)}
              onFavorite={() => toggleFavorite(item.id)}
              horizontalPadding={t.spacing.lg}
              columnGap={t.spacing.md}
            />
          );
        }}
        ListEmptyComponent={
          <View style={{ marginTop: t.spacing.xxl }}>
            {showingFavorites ? (
              <EmptyState
                icon="heart-outline"
                title="No favorites yet"
                subtitle="Tap the heart on any recipe or catalog meal to save it here."
              />
            ) : browsing ? (
              <EmptyState
                icon="earth"
                title="No meals match"
                subtitle="Try clearing a filter or searching for something else."
              />
            ) : (
              <EmptyState
                icon="silverware-fork-knife"
                title={recipes.length === 0 ? 'Your library is empty' : 'No matches'}
                subtitle={
                  recipes.length === 0
                    ? 'Add your own recipe below, or switch to Browse to add from the public catalog.'
                    : 'Try another search term.'
                }
              />
            )}
          </View>
        }
      />

      {mode === 'mine' && (
        <View
          style={{
            position: 'absolute',
            right: t.spacing.lg,
            bottom: TAB_BAR_SPACE + t.spacing.sm,
          }}
        >
          <Button
            label="Add recipe"
            icon="plus"
            onPress={() => navigation.navigate('AddRecipe', undefined)}
            variant="primary"
            size="md"
            style={t.shadow.medium}
          />
        </View>
      )}
      <CollapsingHeader title="Recipes" scrollY={scrollY} />
    </View>
  );
}

interface ChipOption {
  key: string;
  label: string;
}

function ChipRow({
  options,
  selected,
  onToggle,
}: {
  options: ChipOption[];
  selected: string | null;
  onToggle: (key: string) => void;
}) {
  const t = useAppTheme();
  if (options.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingRight: t.spacing.lg }}
    >
      {options.map((o) => (
        <Pill
          key={o.key}
          label={o.label}
          size="sm"
          selected={selected === o.key}
          onPress={() => onToggle(o.key)}
        />
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Type-check**

```
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run the app and verify manually**

```
npx expo start
```

Verification checklist (press `w` for web or `i` for iOS simulator):

1. Open Recipes tab — three segments visible: My Recipes / Browse / Favorites
2. In My Recipes: tap heart on a card → fills forest-green; delete button still shows top-right
3. Switch to Favorites → hearted recipe appears
4. In Browse: tap heart on a catalog meal → fills; switch to Favorites → meal appears alongside the recipe
5. In Favorites: tap a filled heart → it empties; item disappears from the grid
6. Open Favorites with nothing favorited → empty state shows "No favorites yet"
7. Restart the app → favorites still shown (persisted to AsyncStorage)
8. FAB ("Add recipe") visible only in My Recipes mode, not Browse or Favorites

- [ ] **Step 4: Commit**

```
git add src/screens/RecipeLibraryScreen.tsx
git commit -m "feat: add Favorites segment to Recipes screen"
```

---

## Verification Summary

After all tasks are complete:

```
npm run typecheck   # must pass clean
npx expo start      # manual walkthrough of checklist in Task 4 Step 3
```
