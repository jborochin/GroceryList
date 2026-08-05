import React, { useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useGroceryRecipeStore } from '../store/useGroceryRecipeStore';
import { usePantryStore } from '../store/usePantryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';
import { aggregate } from '../utils/ingredientAggregator';
import { applyPantry } from '../utils/pantryDeduction';
import { estimatePrices } from '../utils/priceEstimator';
import { computeNutritionSummary } from '../utils/nutritionSummary';
import { NutritionBar } from '../components/NutritionBar';
import { TabParamList, RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import {
  Screen,
  Header,
  Surface,
  GlassSurface,
  Text,
  Button,
  Stat,
  SectionHeader,
  CountUpText,
} from '../components/ui';

type TabNav = BottomTabNavigationProp<TabParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const t = useAppTheme();
  const navigation = useNavigation<TabNav & RootNav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const plan = useMealPlanStore((s) => s.entries);
  const planDays = useMealPlanStore((s) => s.planDays);
  const groceryRecipes = useGroceryRecipeStore((s) => s.entries);
  const pantry = usePantryStore((s) => s.items);
  const settings = useSettingsStore((s) => s.settings);
  const overrides = usePriceOverrideStore((s) => s.overrides);

  const summary = useMemo(
    () => computeNutritionSummary(plan, recipes, settings, planDays),
    [plan, recipes, settings, planDays]
  );
  const grocery = useMemo(() => {
    // Same two sources the Grocery tab aggregates, so the preview doesn't
    // under-report recipes added straight to the list. Nutrition and the
    // "meals planned" count below stay plan-only — grocery-only recipes
    // aren't planned meals.
    const agg = aggregate([...plan, ...groceryRecipes], recipes);
    const withPantry = applyPantry(agg, pantry);
    return estimatePrices(withPantry, overrides);
  }, [plan, groceryRecipes, recipes, pantry, overrides]);

  const totalServings = plan.reduce((acc, p) => acc + p.desiredServings, 0);
  const itemsCount = grocery.items.length;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Screen scroll glass headerTitle="Kitchen">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <Image
          source={require('../../assets/icon.png')}
          style={{ width: 56, height: 56 }}
          accessibilityLabel="MealFlow"
        />
        <View style={{ flex: 1 }}>
          <Header eyebrow={today} title="Kitchen" subtitle="Plan smart, shop once, eat well." />
        </View>
      </View>

      {/* Hero stats - bento style (glass) */}
      <View style={{ flexDirection: 'row', gap: t.spacing.md, marginBottom: t.spacing.md }}>
        <Surface
          variant="flat"
          pad={t.spacing.lg}
          style={{
            flex: 1,
            backgroundColor: t.palette.primary,
            minHeight: 140,
            justifyContent: 'space-between',
          }}
        >
          <Text variant="eyebrow" style={{ color: t.palette.primaryContrast, opacity: 0.7 }}>
            Estimated cost
          </Text>
          <View>
            {grocery.total > 0 ? (
              <CountUpText
                value={grocery.total}
                prefix="$"
                decimals={0}
                variant="display"
                style={{ color: t.palette.primaryContrast }}
              />
            ) : (
              <Text variant="display" tabularNums style={{ color: t.palette.primaryContrast }}>
                —
              </Text>
            )}
            <Text
              variant="caption"
              style={{ color: t.palette.primaryContrast, opacity: 0.7, marginTop: 2 }}
            >
              {itemsCount > 0 ? `${itemsCount} items to buy` : 'plan a week to see'}
            </Text>
          </View>
        </Surface>
        <View style={{ flex: 1, gap: t.spacing.md }}>
          <GlassSurface
            variant="hero"
            pad={t.spacing.md}
            style={{ flex: 1, justifyContent: 'space-between' }}
          >
            <Text variant="eyebrow" tone="tertiary">
              Recipes
            </Text>
            <CountUpText value={plan.length} variant="display" />
          </GlassSurface>
          <GlassSurface
            variant="hero"
            pad={t.spacing.md}
            style={{ flex: 1, justifyContent: 'space-between' }}
          >
            <Text variant="eyebrow" tone="tertiary">
              Servings
            </Text>
            <CountUpText value={totalServings} variant="display" />
          </GlassSurface>
        </View>
      </View>

      {/* Quick actions */}
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginTop: t.spacing.xs }}>
        <Button
          label="Plan week"
          icon="calendar-month"
          onPress={() => navigation.navigate('Plan')}
          style={{ flex: 1 }}
          fullWidth
        />
        <Button
          label="Grocery list"
          variant="secondary"
          icon="cart-outline"
          onPress={() => navigation.navigate('List')}
          style={{ flex: 1 }}
          fullWidth
        />
      </View>

      <SectionHeader title="Daily nutrition" trailing={
        <Text variant="caption" tone="tertiary" tabularNums>
          {summary.target.dailyCalories} kcal goal
        </Text>
      } />

      <GlassSurface variant="hero" pad={t.spacing.lg}>
        <NutritionBar
          label="Calories"
          actual={summary.daily.calories}
          target={summary.target.dailyCalories}
          unit=""
          color={t.palette.primary}
        />
        {/* Hairline sets Calories apart as the primary stat within one material. */}
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: t.palette.rimLight,
            marginVertical: t.spacing.sm,
          }}
        />
        <NutritionBar
          label="Protein"
          actual={summary.daily.proteinG}
          target={summary.target.dailyProteinG}
          color={t.palette.textPrimary}
        />
        <NutritionBar
          label="Carbs"
          actual={summary.daily.carbsG}
          target={summary.target.dailyCarbsG}
          color={t.palette.textSecondary}
        />
        <NutritionBar
          label="Fat"
          actual={summary.daily.fatG}
          target={summary.target.dailyFatG}
          color={t.palette.textTertiary}
        />
        {summary.hasMissingData ? (
          <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.sm }}>
            Some recipes are missing nutrition data — totals may be understated.
          </Text>
        ) : null}
      </GlassSurface>

      <SectionHeader title="Quick add" />
      <GlassSurface
        variant="content"
        tint="primary"
        pad={t.spacing.lg}
        onPress={() => navigation.navigate('AddRecipe', undefined)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="title">Add a recipe</Text>
            <Text variant="small" tone="secondary" style={{ marginTop: 2 }}>
              Paste a URL or enter ingredients manually.
            </Text>
          </View>
          <Stat label="" value="+" align="end" size="md" tone="primary" />
        </View>
      </GlassSurface>
    </Screen>
  );
}
