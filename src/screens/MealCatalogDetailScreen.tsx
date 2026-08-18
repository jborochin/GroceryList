import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { useGroceryRecipeStore } from '../store/useGroceryRecipeStore';
import { useCookSessionStore } from '../store/useCookSessionStore';
import { getMealCatalog } from '../lib/mealCatalogSync';
import { ensureRecipeForMeal, recipeIdForMeal } from '../utils/commitMealPlan';
import { scaleIngredients } from '../utils/recipeScaling';
import { formatEntry } from '../utils/formatters';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import foodPreferences from '../data/foodPreferences.json';
import { ServingStepper } from '../components/ServingStepper';
import { AddToGroceryListSheet } from '../components/AddToGroceryListSheet';
import {
  AmbientBackground,
  Button,
  CollapsingHeader,
  IconButton,
  Pill,
  SectionHeader,
  Surface,
  Text,
  useToast,
} from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'MealCatalogDetail'>;

const CUISINE_LABEL: Record<string, string> = Object.fromEntries(
  foodPreferences.cuisines.map((c) => [c.key, c.label])
);
const DIETARY_LABEL: Record<string, string> = Object.fromEntries(
  foodPreferences.dietary.map((d) => [d.key, d.label])
);

export function MealCatalogDetailScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const toast = useToast();
  const { mealId } = route.params;

  const meal = useMemo(() => getMealCatalog().find((m) => m.id === mealId), [mealId]);

  // Catalog meals never enter "my recipes"; favoriting is how a user keeps one
  // at hand (Recipes tab → Favorites).
  const isFavorited = useFavoritesStore((s) => s.favoriteIds.includes(mealId));
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);

  const [servings, setServings] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Grocery list only — adding a catalog meal here must not put it on the Week tab.
  const addGroceryRecipe = useGroceryRecipeStore((s) => s.addEntry);
  const removeGroceryRecipe = useGroceryRecipeStore((s) => s.removeEntry);

  // Cook sessions are keyed by the clone's deterministic id, so this resolves
  // without materializing anything.
  const cooking = useCookSessionStore(
    (s) => s.sessions[recipeIdForMeal(mealId)] !== undefined
  );

  // The stepper is seeded from the meal's own servings and stays independent of
  // the grocery list — adding to the list is a fire-and-forget action, so nothing
  // on this screen reflects what's already queued.
  useEffect(() => {
    if (meal && servings === 0) {
      setServings(meal.servings);
    }
  }, [meal, servings]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  if (!meal) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.palette.bg,
        }}
      >
        <Text variant="body" tone="secondary">
          Meal not found.
        </Text>
      </View>
    );
  }

  const handleToggleFavorite = () => {
    toggleFavorite(meal.id);
    toast.show({
      message: isFavorited
        ? `Removed ${meal.title} from favorites`
        : `Saved ${meal.title} to favorites`,
      tone: 'success',
    });
  };

  const n = meal.nutritionPerServing;
  const ratio = servings > 0 ? servings / Math.max(1, meal.servings) : 1;
  const scaledIngredients = scaleIngredients(meal.ingredients, ratio);

  // The add button is deliberately stateless — it never reads back from the
  // grocery list, so it always reads "Add" and never toggles. Undo lives on the
  // toast instead.
  const handleConfirmAdd = (desiredServings: number) => {
    setSheetOpen(false);
    // Materialize the catalog meal as a recipe clone (deterministic id) so the
    // aggregator can resolve its ingredients. Clones stay out of "My Recipes".
    const recipeId = ensureRecipeForMeal(meal);
    addGroceryRecipe(recipeId, desiredServings);
    toast.show({
      message: `Added ${meal.title} (${desiredServings} servings) to your grocery list`,
      tone: 'success',
      action: { label: 'Undo', onPress: () => removeGroceryRecipe(recipeIdForMeal(meal.id)) },
    });
  };

  // Cook mode only ever addresses a Recipe, so a catalog meal materializes its
  // clone first — the same deterministic id the grocery path uses, and equally
  // invisible in "My Recipes".
  const handleCook = () => {
    navigation.navigate('CookMode', { recipeId: ensureRecipeForMeal(meal), servings });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + t.spacing.sm,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: insets.bottom + t.spacing.xxl + 80,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.md, gap: t.spacing.sm }}>
          <IconButton
            icon="chevron-left"
            onPress={() => navigation.goBack()}
            variant="tonal"
            size={20}
            accessibilityLabel="Back"
          />
          <View style={{ flex: 1 }} />
          <Button
            label={cooking ? 'Resume' : 'Cook'}
            icon="chef-hat"
            size="sm"
            variant="primary"
            onPress={handleCook}
          />
          <Button
            label="Add"
            icon="cart-plus"
            size="sm"
            variant="secondary"
            onPress={() => setSheetOpen(true)}
          />
          <Pill label="Public catalog" icon="earth" tone="neutral" size="sm" />
        </View>

        {meal.imageUrl ? (
          <Image
            source={{ uri: meal.imageUrl }}
            style={{
              width: '100%',
              height: 200,
              borderRadius: t.radius.lg,
              marginBottom: t.spacing.md,
              backgroundColor: t.palette.surfaceMuted,
            }}
            contentFit="cover"
            transition={200}
            accessibilityLabel={`Photo of ${meal.title}`}
          />
        ) : null}

        <Text variant="hero" numberOfLines={3}>
          {meal.title}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: t.spacing.sm }}>
          <Pill label={CUISINE_LABEL[meal.cuisine] ?? meal.cuisine} tone="neutral" size="sm" />
          {meal.prepTimeMinutes ? (
            <Pill label={`${meal.prepTimeMinutes} min`} icon="clock-outline" tone="neutral" size="sm" />
          ) : null}
          {meal.dietaryTags.map((d) => (
            <Pill key={d} label={DIETARY_LABEL[d] ?? d} tone="primary" size="sm" />
          ))}
        </View>

        <Surface variant="outlined" pad={t.spacing.lg} style={{ marginTop: t.spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="tertiary" style={{ marginBottom: 4 }}>
                Servings
              </Text>
              <Text variant="title">{servings} servings</Text>
            </View>
            <ServingStepper value={servings} onChange={setServings} />
          </View>
        </Surface>

        <SectionHeader title="Nutrition" trailing={<Text variant="caption" tone="tertiary">per serving</Text>} />
        <Surface variant="outlined" pad={t.spacing.lg}>
          <View style={{ flexDirection: 'row' }}>
            <NutritionStat label="Calories" value={`${Math.round(n.calories)}`} />
            <NutritionStat label="Protein" value={`${Math.round(n.proteinG)}g`} />
            <NutritionStat label="Carbs" value={`${Math.round(n.carbsG)}g`} />
            <NutritionStat label="Fat" value={`${Math.round(n.fatG)}g`} />
          </View>
        </Surface>

        <SectionHeader title="Ingredients" count={scaledIngredients.length} />
        <Surface variant="outlined" pad={t.spacing.lg}>
          {scaledIngredients.map((i, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 10,
                gap: t.spacing.md,
                borderBottomWidth: idx === scaledIngredients.length - 1 ? 0 : 1,
                borderBottomColor: t.palette.border,
              }}
            >
              <View
                style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.palette.primary }}
              />
              <Text variant="body" style={{ flex: 1 }}>
                {i.name}
              </Text>
              <Text variant="small" tone="secondary" tabularNums>
                {formatEntry(i.quantity, i.unit)}
              </Text>
            </View>
          ))}
        </Surface>

        {meal.instructions && meal.instructions.length > 0 ? (
          <>
            <SectionHeader title="Instructions" />
            <Surface variant="outlined" pad={t.spacing.lg}>
              {meal.instructions.map((step, idx) => (
                <View
                  key={idx}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: 8,
                    gap: t.spacing.md,
                    alignItems: 'flex-start',
                  }}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: t.palette.primarySoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: 1,
                    }}
                  >
                    <Text
                      variant="caption"
                      weight="bold"
                      style={{ color: t.palette.primarySoftText }}
                      tabularNums
                    >
                      {idx + 1}
                    </Text>
                  </View>
                  <Text variant="body" style={{ flex: 1, lineHeight: 22 }}>
                    {step}
                  </Text>
                </View>
              ))}
            </Surface>
          </>
        ) : null}
      </Animated.ScrollView>
      <CollapsingHeader title={meal.title} scrollY={scrollY} threshold={64} />

      <View
        style={{
          position: 'absolute',
          left: t.spacing.lg,
          right: t.spacing.lg,
          bottom: insets.bottom + t.spacing.sm,
        }}
      >
        {isFavorited ? (
          <Button
            label="Saved to favorites"
            icon="heart"
            variant="secondary"
            onPress={handleToggleFavorite}
            fullWidth
            size="lg"
            style={t.shadow.medium}
          />
        ) : (
          <Button
            label="Save to favorites"
            icon="heart-outline"
            onPress={handleToggleFavorite}
            fullWidth
            size="lg"
            style={t.shadow.medium}
          />
        )}
      </View>

      <AddToGroceryListSheet
        visible={sheetOpen}
        title={meal.title}
        initialServings={servings}
        onConfirm={handleConfirmAdd}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

function NutritionStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text variant="title" tabularNums>
        {value}
      </Text>
      <Text variant="caption" tone="tertiary" style={{ marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}
