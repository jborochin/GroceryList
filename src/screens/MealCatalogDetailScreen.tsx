import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeStore } from '../store/useRecipeStore';
import { getMealCatalog } from '../lib/mealCatalogSync';
import { mealToRecipe, recipeIdForMeal } from '../utils/commitMealPlan';
import { formatEntry } from '../utils/formatters';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import foodPreferences from '../data/foodPreferences.json';
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

  // The recipe id a catalog meal maps to is deterministic, so we can tell
  // whether it's already in the user's library and reflect that in the button.
  const recipeId = meal ? recipeIdForMeal(meal.id) : '';
  const alreadyAdded = useRecipeStore((s) => s.recipes.some((r) => r.id === recipeId));
  const [justAdded, setJustAdded] = useState(false);
  const inLibrary = alreadyAdded || justAdded;

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

  const handleAdd = () => {
    // Idempotent: upsert keyed on the deterministic id never duplicates.
    useRecipeStore.getState().upsertRecipe(mealToRecipe(meal));
    setJustAdded(true);
    toast.show({ message: `Added ${meal.title} to your recipes`, tone: 'success' });
  };

  const n = meal.nutritionPerServing;

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
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.md }}>
          <IconButton
            icon="chevron-left"
            onPress={() => navigation.goBack()}
            variant="tonal"
            size={20}
            accessibilityLabel="Back"
          />
          <View style={{ flex: 1 }} />
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

        <SectionHeader title="Nutrition" trailing={<Text variant="caption" tone="tertiary">per serving</Text>} />
        <Surface variant="outlined" pad={t.spacing.lg}>
          <View style={{ flexDirection: 'row' }}>
            <NutritionStat label="Calories" value={`${Math.round(n.calories)}`} />
            <NutritionStat label="Protein" value={`${Math.round(n.proteinG)}g`} />
            <NutritionStat label="Carbs" value={`${Math.round(n.carbsG)}g`} />
            <NutritionStat label="Fat" value={`${Math.round(n.fatG)}g`} />
          </View>
        </Surface>

        <SectionHeader title="Ingredients" count={meal.ingredients.length} />
        <Surface variant="outlined" pad={t.spacing.lg}>
          {meal.ingredients.map((i, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 10,
                gap: t.spacing.md,
                borderBottomWidth: idx === meal.ingredients.length - 1 ? 0 : 1,
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
        {inLibrary ? (
          <Button
            label="View in my recipes"
            icon="check"
            variant="secondary"
            onPress={() => navigation.navigate('RecipeDetail', { recipeId })}
            fullWidth
            size="lg"
            style={t.shadow.medium}
          />
        ) : (
          <Button
            label="Add to my recipes"
            icon="plus"
            onPress={handleAdd}
            fullWidth
            size="lg"
            style={t.shadow.medium}
          />
        )}
      </View>
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
