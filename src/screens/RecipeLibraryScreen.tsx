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
import { RecipeGridCard } from '../components/RecipeGridCard';
import { MealCatalogCard } from '../components/MealCatalogCard';
import { EmptyState } from '../components/EmptyState';
import { RootStackParamList } from '../navigation/types';
import { Meal, MealSlot } from '../types';
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
type Mode = 'mine' | 'browse';

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

export function RecipeLibraryScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const deleteRecipe = useRecipeStore((s) => s.deleteRecipe);
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

  // Recipe ids already in the library, to flag catalog meals as added. Catalog
  // meals map to a deterministic recipe id, so this is a simple membership test.
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

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const browsing = mode === 'browse';
  const data: Array<Meal | (typeof recipes)[number]> = browsing ? filteredMeals : filteredRecipes;

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
            <Header
              title="Recipes"
              subtitle={
                browsing
                  ? `${catalog.length} meals to explore`
                  : recipes.length === 0
                    ? 'Build your library to start planning.'
                    : `${recipes.length} saved`
              }
            />
            <View style={{ marginBottom: t.spacing.lg }}>
              <SegmentedControl<Mode>
                value={mode}
                onChange={setMode}
                items={[
                  { value: 'mine', label: 'My Recipes', icon: 'bookmark-outline' },
                  { value: 'browse', label: 'Browse', icon: 'earth' },
                ]}
              />
            </View>
            {(browsing || recipes.length > 0) && (
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
            {!browsing && filteredRecipes.length > 0 && query ? (
              <Text variant="caption" tone="tertiary" style={{ marginBottom: t.spacing.sm }}>
                {filteredRecipes.length} {filteredRecipes.length === 1 ? 'match' : 'matches'}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) =>
          browsing ? (
            <MealCatalogCard
              meal={item as Meal}
              added={libraryIds.has(recipeIdForMeal(item.id))}
              onAdd={() => handleAddMeal(item as Meal)}
              onPress={() => navigation.navigate('MealCatalogDetail', { mealId: item.id })}
              horizontalPadding={t.spacing.lg}
              columnGap={t.spacing.md}
            />
          ) : (
            <RecipeGridCard
              recipe={item as (typeof recipes)[number]}
              onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}
              onDelete={() => handleDelete(item.id, item.title)}
              horizontalPadding={t.spacing.lg}
              columnGap={t.spacing.md}
            />
          )
        }
        ListEmptyComponent={
          <View style={{ marginTop: t.spacing.xxl }}>
            {browsing ? (
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

      {!browsing && (
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
