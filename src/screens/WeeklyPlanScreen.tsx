import React, { useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { ServingStepper } from '../components/ServingStepper';
import { EmptyState } from '../components/EmptyState';
import { computeNutritionSummary } from '../utils/nutritionSummary';
import { NutritionBar } from '../components/NutritionBar';
import { TabParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import {
  AmbientBackground,
  CollapsingHeader,
  Header,
  Surface,
  Text,
  IconButton,
  SectionHeader,
  Button,
  Pill,
  TAB_BAR_SPACE,
} from '../components/ui';

type Nav = BottomTabNavigationProp<TabParamList>;

export function WeeklyPlanScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const plan = useMealPlanStore((s) => s.entries);
  const addEntry = useMealPlanStore((s) => s.addEntry);
  const updateServings = useMealPlanStore((s) => s.updateServings);
  const removeEntry = useMealPlanStore((s) => s.removeEntry);
  const settings = useSettingsStore((s) => s.settings);

  const planned = useMemo(() => {
    return plan
      .map((e) => ({ entry: e, recipe: recipes.find((r) => r.id === e.recipeId) }))
      .filter((x): x is { entry: (typeof plan)[number]; recipe: NonNullable<typeof x.recipe> } => !!x.recipe);
  }, [plan, recipes]);

  const available = useMemo(
    () => recipes.filter((r) => !plan.some((e) => e.recipeId === r.id)),
    [recipes, plan]
  );

  const nutrition = useMemo(
    () => computeNutritionSummary(plan, recipes, settings),
    [plan, recipes, settings]
  );

  const totalServings = plan.reduce((acc, p) => acc + p.desiredServings, 0);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  if (recipes.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: t.palette.bg, paddingTop: insets.top }}>
        <EmptyState
          icon="calendar-blank-outline"
          title="No recipes yet"
          subtitle="Add a recipe to your library, then plan your week from here."
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <Animated.ScrollView
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: TAB_BAR_SPACE + (planned.length > 0 ? 80 : t.spacing.lg),
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Header
          title="This week"
          subtitle={
            planned.length === 0
              ? 'Tap a recipe below to plan it.'
              : `${planned.length} ${planned.length === 1 ? 'recipe' : 'recipes'} · ${totalServings} servings`
          }
        />

        {planned.length > 0 ? (
          <>
            <View style={{ gap: t.spacing.sm }}>
              {planned.map(({ entry, recipe }) => (
                <Surface key={recipe.id} variant="outlined" pad={t.spacing.md}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLg" weight="semibold" numberOfLines={1}>
                        {recipe.title}
                      </Text>
                      <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                        Base recipe: {recipe.servings} servings
                      </Text>
                    </View>
                    <ServingStepper
                      value={entry.desiredServings}
                      onChange={(v) => updateServings(recipe.id, v)}
                    />
                    <IconButton
                      icon="close"
                      onPress={() => removeEntry(recipe.id)}
                      variant="tonal"
                      size={16}
                      accessibilityLabel="Remove from plan"
                    />
                  </View>
                </Surface>
              ))}
            </View>

            <SectionHeader title="Nutrition preview" />
            <Surface variant="outlined" pad={t.spacing.lg}>
              <NutritionBar
                label="Daily calories"
                actual={nutrition.daily.calories}
                target={nutrition.target.dailyCalories}
                unit=""
                color={t.palette.primary}
              />
              <NutritionBar
                label="Protein"
                actual={nutrition.daily.proteinG}
                target={nutrition.target.dailyProteinG}
                color={t.palette.textPrimary}
              />
              <NutritionBar
                label="Carbs"
                actual={nutrition.daily.carbsG}
                target={nutrition.target.dailyCarbsG}
                color={t.palette.textSecondary}
              />
              <NutritionBar
                label="Fat"
                actual={nutrition.daily.fatG}
                target={nutrition.target.dailyFatG}
                color={t.palette.textTertiary}
              />
            </Surface>
          </>
        ) : null}

        {available.length > 0 ? (
          <>
            <SectionHeader
              title="Library"
              count={available.length}
              trailing={<Pill label="Tap + to plan" tone="neutral" size="sm" />}
            />
            <View style={{ gap: t.spacing.sm }}>
              {available.map((recipe) => (
                <Surface key={recipe.id} variant="outlined" pad={t.spacing.md}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLg" weight="semibold" numberOfLines={1}>
                        {recipe.title}
                      </Text>
                      <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                        {recipe.servings} servings
                        {recipe.nutritionPerServing
                          ? ` · ${Math.round(recipe.nutritionPerServing.calories)} cal`
                          : ''}
                      </Text>
                    </View>
                    <IconButton
                      icon="plus"
                      onPress={() => addEntry(recipe.id, recipe.servings)}
                      variant="soft"
                      size={18}
                      accessibilityLabel="Add to plan"
                    />
                  </View>
                </Surface>
              ))}
            </View>
          </>
        ) : null}
      </Animated.ScrollView>
      <CollapsingHeader title="This week" scrollY={scrollY} />

      {planned.length > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: t.spacing.lg,
            right: t.spacing.lg,
            bottom: TAB_BAR_SPACE + t.spacing.sm,
          }}
        >
          <Button
            label="View grocery list"
            icon="cart-arrow-right"
            onPress={() => navigation.navigate('List')}
            fullWidth
            size="lg"
            style={t.shadow.medium}
          />
        </View>
      ) : null}
    </View>
  );
}
