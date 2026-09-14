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
import { removeRecipeEverywhere } from '../store/removeRecipeEverywhere';
import { useMealPlanStore } from '../store/useMealPlanStore';
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
import { ensureRecipeForMeal, recipeIdForMeal } from '../utils/commitMealPlan';
import { catalogCloneIdSet } from '../utils/deterministicId';
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
  const plan = useMealPlanStore((s) => s.entries);
  const addEntry = useMealPlanStore((s) => s.addEntry);
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

  // Catalog meals placed on the calendar are cloned into the recipe store (the
  // grocery/nutrition pipeline resolves plan entries there), but they are NOT the
  // user's own recipes — hide them from "My Recipes". Favorites is how a user
  // keeps a catalog meal at hand.
  const cloneIds = useMemo(() => catalogCloneIdSet(catalog.map((m) => m.id)), [catalog]);
  const myRecipes = useMemo(
    () => recipes.filter((r) => !cloneIds.has(r.id)),
    [recipes, cloneIds]
  );

  // Recipe ids already queued in the weekly plan (scheduled or not), to flag
  // cards as queued regardless of which screen added them.
  const queuedIds = useMemo(() => new Set(plan.map((e) => e.recipeId)), [plan]);

  const handleQueueRecipe = (recipe: Recipe) => {
    addEntry(recipe.id, recipe.servings);
    toast.show({ message: `Added ${recipe.title} to this week`, tone: 'success' });
  };

  const handleQueueMeal = (meal: Meal) => {
    const recipeId = ensureRecipeForMeal(meal);
    addEntry(recipeId, meal.servings);
    toast.show({ message: `Added ${meal.title} to this week`, tone: 'success' });
  };

  const handleDelete = async (id: string, title: string) => {
    const ok = await confirm({
      title: `Delete ${title}?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) {
      removeRecipeEverywhere(id);
    }
  };

  const filteredRecipes = useMemo(() => {
    if (!query.trim()) return myRecipes;
    const q = query.trim().toLowerCase();
    return myRecipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    );
  }, [myRecipes, query]);

  // Only offer filter values that actually occur in the catalog.
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
    () => myRecipes.filter((r) => favoriteSet.has(r.id)),
    [myRecipes, favoriteSet]
  );
  // A favorite recorded under a clone's recipe id (legacy behavior) surfaces as
  // its catalog meal, so old favorites keep working now that clones are hidden.
  const favoritedMeals = useMemo(
    () => catalog.filter(
      (m) => favoriteSet.has(m.id) || favoriteSet.has(recipeIdForMeal(m.id))
    ),
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
      : myRecipes.length === 0
        ? 'Build your library to start planning.'
        : `${myRecipes.length} saved`;

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
            {!showingFavorites && (browsing || myRecipes.length > 0) && (
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
                queued={queuedIds.has(recipeIdForMeal(item.id))}
                onQueue={() => handleQueueMeal(item)}
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
              queued={queuedIds.has(item.id)}
              onQueue={() => handleQueueRecipe(item)}
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
                title={myRecipes.length === 0 ? 'Your library is empty' : 'No matches'}
                subtitle={
                  myRecipes.length === 0
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
