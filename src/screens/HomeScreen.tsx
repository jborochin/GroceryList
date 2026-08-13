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
import { usePriceCatalogStore } from '../store/usePriceCatalogStore';
import { useMealScheduleStore } from '../store/useMealScheduleStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { aggregate } from '../utils/ingredientAggregator';
import { applyPantry } from '../utils/pantryDeduction';
import { estimatePrices } from '../utils/priceEstimator';
import { resolveDay } from '../utils/foodLogDay';
import { todayKey } from '../utils/planningWeek';
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
  const priceCatalogVersion = usePriceCatalogStore((s) => s.version);

  const cells = useMealScheduleStore((s) => s.cells);
  const logEntries = useFoodLogStore((s) => s.entries);
  const today = useMemo(
    () => resolveDay(todayKey(), cells, logEntries, recipes),
    [cells, logEntries, recipes]
  );
  const grocery = useMemo(() => {
    // Same two sources the Grocery tab aggregates, so the preview doesn't
    // under-report recipes added straight to the list. Nutrition and the
    // "meals planned" count below stay plan-only — grocery-only recipes
    // aren't planned meals.
    const agg = aggregate([...plan, ...groceryRecipes], recipes);
    const withPantry = applyPantry(agg, pantry);
    return estimatePrices(withPantry, overrides);
    // priceCatalogVersion ticks when a live price refresh lands; findPrice reads
    // the overlay through a module-level cache that React can't otherwise see.
  }, [plan, groceryRecipes, recipes, pantry, overrides, priceCatalogVersion]);

  const totalServings = plan.reduce((acc, p) => acc + p.desiredServings, 0);
  const itemsCount = grocery.items.length;

  const todayLabel = new Date().toLocaleDateString(undefined, {
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
          <Header eyebrow={todayLabel} title="Kitchen" subtitle="Plan smart, shop once, eat well." />
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
          onPress={() => navigation.navigate('Log', { view: 'week' })}
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

      {/* Today, not the week's average. Home and the Log tab must agree, and
          what someone wants from a home screen is "where am I right now". The
          weekly projection still lives on the Log tab's Week view. */}
      <SectionHeader
        title="Today"
        trailing={
          <Text variant="caption" tone="tertiary" tabularNums>
            {settings.dailyCalorieTarget} kcal goal
          </Text>
        }
      />

      <GlassSurface variant="hero" pad={t.spacing.lg} onPress={() => navigation.navigate('Log')}>
        <NutritionBar
          label="Calories"
          actual={today.totals.calories}
          target={settings.dailyCalorieTarget}
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
          actual={today.totals.proteinG}
          target={settings.macroGrams.proteinG}
          color={t.palette.textPrimary}
        />
        <NutritionBar
          label="Carbs"
          actual={today.totals.carbsG}
          target={settings.macroGrams.carbsG}
          color={t.palette.textSecondary}
        />
        <NutritionBar
          label="Fat"
          actual={today.totals.fatG}
          target={settings.macroGrams.fatG}
          color={t.palette.textTertiary}
        />
        <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.sm }}>
          {today.projected.calories > 0
            ? `Includes ${Math.round(today.projected.calories)} kcal still planned — tap to confirm what you ate.`
            : 'Tap to log a meal.'}
        </Text>
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
