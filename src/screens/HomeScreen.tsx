import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
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
  Text,
  Button,
  Stat,
  SectionHeader,
} from '../components/ui';

type TabNav = BottomTabNavigationProp<TabParamList>;
type RootNav = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  const t = useAppTheme();
  const navigation = useNavigation<TabNav & RootNav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const plan = useMealPlanStore((s) => s.entries);
  const pantry = usePantryStore((s) => s.items);
  const settings = useSettingsStore((s) => s.settings);
  const overrides = usePriceOverrideStore((s) => s.overrides);

  const summary = useMemo(
    () => computeNutritionSummary(plan, recipes, settings),
    [plan, recipes, settings]
  );
  const grocery = useMemo(() => {
    const agg = aggregate(plan, recipes);
    const withPantry = applyPantry(agg, pantry);
    return estimatePrices(withPantry, overrides);
  }, [plan, recipes, pantry, overrides]);

  const totalServings = plan.reduce((acc, p) => acc + p.desiredServings, 0);
  const itemsCount = grocery.items.length;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Screen scroll>
      <Header eyebrow={today} title="Kitchen" subtitle="Plan smart, shop once, eat well." />

      {/* Hero stats - bento style */}
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
            <Text
              variant="display"
              tabularNums
              style={{ color: t.palette.primaryContrast }}
            >
              {grocery.total > 0 ? `$${grocery.total.toFixed(0)}` : '—'}
            </Text>
            <Text
              variant="caption"
              style={{ color: t.palette.primaryContrast, opacity: 0.7, marginTop: 2 }}
            >
              {itemsCount > 0 ? `${itemsCount} items to buy` : 'plan a week to see'}
            </Text>
          </View>
        </Surface>
        <View style={{ flex: 1, gap: t.spacing.md }}>
          <Surface variant="outlined" pad={t.spacing.md} style={{ flex: 1, justifyContent: 'space-between' }}>
            <Text variant="eyebrow" tone="tertiary">
              Recipes
            </Text>
            <Text variant="display" tabularNums>
              {plan.length}
            </Text>
          </Surface>
          <Surface variant="outlined" pad={t.spacing.md} style={{ flex: 1, justifyContent: 'space-between' }}>
            <Text variant="eyebrow" tone="tertiary">
              Servings
            </Text>
            <Text variant="display" tabularNums>
              {totalServings}
            </Text>
          </Surface>
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

      <Surface variant="outlined" pad={t.spacing.lg}>
        <NutritionBar
          label="Calories"
          actual={summary.daily.calories}
          target={summary.target.dailyCalories}
          unit=""
          color={t.palette.primary}
        />
        <NutritionBar
          label="Protein"
          actual={summary.daily.proteinG}
          target={summary.target.dailyProteinG}
          color="#C44A6E"
        />
        <NutritionBar
          label="Carbs"
          actual={summary.daily.carbsG}
          target={summary.target.dailyCarbsG}
          color="#7C3AED"
        />
        <NutritionBar
          label="Fat"
          actual={summary.daily.fatG}
          target={summary.target.dailyFatG}
          color="#D97706"
        />
        {summary.hasMissingData ? (
          <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.sm }}>
            Some recipes are missing nutrition data — totals may be understated.
          </Text>
        ) : null}
      </Surface>

      <SectionHeader title="Quick add" />
      <Surface
        variant="tinted"
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
      </Surface>
    </Screen>
  );
}
