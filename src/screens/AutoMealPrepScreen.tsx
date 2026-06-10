import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { NutritionBar } from '../components/NutritionBar';
import { planMeals, PlannerResult, SlotConfig } from '../utils/mealPlanner';
import { commitPlannedMeals } from '../utils/commitMealPlan';
import {
  getMealCatalog,
  loadMealCatalogCache,
  refreshMealCatalogCache,
} from '../lib/mealCatalogSync';
import { confirm } from '../utils/confirm';
import { MealSlot } from '../types';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import foodPreferences from '../data/foodPreferences.json';
import {
  AmbientBackground,
  Button,
  CollapsingHeader,
  Header,
  Pill,
  SectionHeader,
  Stepper,
  Surface,
  Text,
  useToast,
} from '../components/ui';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

const CUISINE_LABEL: Record<string, string> = Object.fromEntries(
  foodPreferences.cuisines.map((c) => [c.key, c.label])
);
const DIETARY_LABEL: Record<string, string> = Object.fromEntries(
  foodPreferences.dietary.map((d) => [d.key, d.label])
);

export function AutoMealPrepScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const navigation = useNavigation<Nav>();
  const settings = useSettingsStore((s) => s.settings);
  const planEntries = useMealPlanStore((s) => s.entries);
  const clearPlan = useMealPlanStore((s) => s.clearPlan);

  const [days, setDays] = useState(7);
  const [slotCounts, setSlotCounts] = useState<Record<MealSlot, number>>({
    breakfast: 1,
    lunch: 1,
    dinner: 1,
    snack: 1,
  });
  const [result, setResult] = useState<PlannerResult | null>(null);

  useEffect(() => {
    void loadMealCatalogCache().then(refreshMealCatalogCache);
  }, []);

  const catalog = getMealCatalog();
  const catalogById = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog]);

  const targets = useMemo(
    () => ({
      dailyCalories: settings.dailyCalorieTarget,
      macroGrams: settings.macroGrams,
    }),
    [settings.dailyCalorieTarget, settings.macroGrams]
  );

  const handleGenerate = () => {
    const slots: SlotConfig[] = SLOT_ORDER.map((slot) => ({
      slot,
      mealsPerDay: slotCounts[slot],
    })).filter((s) => s.mealsPerDay > 0);
    const r = planMeals({
      targets,
      cuisinePreferences: settings.cuisinePreferences,
      dietaryRestrictions: settings.dietaryRestrictions,
      meals: catalog,
      days,
      slots,
    });
    setResult(r);
  };

  const handleCommit = async () => {
    if (!result || result.items.length === 0) return;
    if (planEntries.length > 0) {
      const replace = await confirm({
        title: 'Replace current plan?',
        message: 'This clears your existing weekly plan and adds the generated meals.',
        confirmLabel: 'Replace',
        destructive: true,
      });
      if (!replace) return;
      clearPlan();
    }
    const summary = commitPlannedMeals(result, catalog);
    toast.show({
      message: `Added ${summary.recipeCount} meals to your plan`,
      tone: 'success',
    });
    navigation.goBack();
  };

  // Average the per-day totals so the preview matches the weekly/7 nutrition view.
  const avgDaily = useMemo(() => {
    if (!result || result.dailyTotals.length === 0) return null;
    const sum = result.dailyTotals.reduce(
      (acc, d) => ({
        calories: acc.calories + d.calories,
        proteinG: acc.proteinG + d.proteinG,
        carbsG: acc.carbsG + d.carbsG,
        fatG: acc.fatG + d.fatG,
      }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );
    const n = result.dailyTotals.length;
    return {
      calories: sum.calories / n,
      proteinG: sum.proteinG / n,
      carbsG: sum.carbsG / n,
      fatG: sum.fatG / n,
    };
  }, [result]);

  const itemsByDay = useMemo(() => {
    if (!result) return [];
    const byDay = new Map<number, typeof result.items>();
    for (const item of result.items) {
      const arr = byDay.get(item.day) ?? [];
      arr.push(item);
      byDay.set(item.day, arr);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, items]) => ({
        day,
        items: items
          .slice()
          .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)),
      }));
  }, [result]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <Animated.ScrollView
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: insets.bottom + 100,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Header
          title="Auto meal prep"
          subtitle="Generate a week of meals that fit your calorie & macro targets."
          rightIcon="close"
          onRightPress={() => navigation.goBack()}
        />

        <Surface variant="outlined" pad={t.spacing.lg} style={{ marginBottom: t.spacing.md }}>
          <Text variant="eyebrow" tone="tertiary" style={{ marginBottom: 6 }}>
            Targeting
          </Text>
          <Text variant="bodyLg" weight="semibold">
            {Math.round(targets.dailyCalories)} cal · {Math.round(targets.macroGrams.proteinG)}P /{' '}
            {Math.round(targets.macroGrams.carbsG)}C / {Math.round(targets.macroGrams.fatG)}F
          </Text>
          {(settings.cuisinePreferences.length > 0 || settings.dietaryRestrictions.length > 0) && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: t.spacing.sm }}>
              {settings.dietaryRestrictions.map((d) => (
                <Pill key={d} label={DIETARY_LABEL[d] ?? d} tone="primary" size="sm" />
              ))}
              {settings.cuisinePreferences.map((c) => (
                <Pill key={c} label={CUISINE_LABEL[c] ?? c} tone="neutral" size="sm" />
              ))}
            </View>
          )}
          <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.sm }}>
            Adjust these in Settings.
          </Text>
        </Surface>

        <Surface variant="outlined" pad={t.spacing.lg} style={{ marginBottom: t.spacing.md }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: t.spacing.sm,
            }}
          >
            <Text variant="bodyLg" weight="semibold">
              Days
            </Text>
            <Stepper value={days} onChange={setDays} min={1} max={14} />
          </View>
          {SLOT_ORDER.map((slot) => (
            <View
              key={slot}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: t.spacing.sm,
              }}
            >
              <Text variant="body">{SLOT_LABEL[slot]} / day</Text>
              <Stepper
                value={slotCounts[slot]}
                onChange={(v) => setSlotCounts((prev) => ({ ...prev, [slot]: v }))}
                min={0}
                max={4}
              />
            </View>
          ))}
        </Surface>

        <Button label="Generate plan" icon="auto-fix" onPress={handleGenerate} fullWidth size="lg" />

        {result && (
          <>
            {avgDaily && (
              <>
                <SectionHeader title="Daily average vs target" />
                <Surface variant="outlined" pad={t.spacing.lg}>
                  <NutritionBar
                    label="Calories"
                    actual={avgDaily.calories}
                    target={targets.dailyCalories}
                    unit=""
                    color={t.palette.primary}
                  />
                  <NutritionBar
                    label="Protein"
                    actual={avgDaily.proteinG}
                    target={targets.macroGrams.proteinG}
                    color={t.palette.textPrimary}
                  />
                  <NutritionBar
                    label="Carbs"
                    actual={avgDaily.carbsG}
                    target={targets.macroGrams.carbsG}
                    color={t.palette.textSecondary}
                  />
                  <NutritionBar
                    label="Fat"
                    actual={avgDaily.fatG}
                    target={targets.macroGrams.fatG}
                    color={t.palette.textTertiary}
                  />
                </Surface>
              </>
            )}

            {result.unfilledSlots > 0 && (
              <Surface variant="outlined" pad={t.spacing.md} style={{ marginTop: t.spacing.md }}>
                <Text variant="small" style={{ color: t.palette.warning }}>
                  {result.unfilledSlots} slot{result.unfilledSlots === 1 ? '' : 's'} couldn't be
                  filled — try relaxing dietary filters or adding fewer meals per day.
                </Text>
              </Surface>
            )}

            <SectionHeader title="Preview" count={result.items.length} />
            <View style={{ gap: t.spacing.md }}>
              {itemsByDay.map(({ day, items }) => (
                <Surface key={day} variant="outlined" pad={t.spacing.md}>
                  <Text variant="eyebrow" tone="tertiary" style={{ marginBottom: t.spacing.sm }}>
                    Day {day + 1}
                  </Text>
                  <View style={{ gap: t.spacing.sm }}>
                    {items.map((item, idx) => {
                      const meal = catalogById.get(item.mealId);
                      if (!meal) return null;
                      return (
                        <View
                          key={`${item.slot}-${idx}`}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}
                        >
                          <View style={{ width: 76 }}>
                            <Text variant="caption" tone="tertiary">
                              {SLOT_LABEL[item.slot]}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text variant="body" weight="medium" numberOfLines={1}>
                              {meal.title}
                              {item.servings > 1 ? ` ×${item.servings}` : ''}
                            </Text>
                            <Text variant="caption" tone="secondary">
                              {CUISINE_LABEL[meal.cuisine] ?? meal.cuisine} ·{' '}
                              {Math.round(meal.nutritionPerServing.calories * item.servings)} cal ·{' '}
                              {Math.round(meal.nutritionPerServing.proteinG * item.servings)}P
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </Surface>
              ))}
            </View>
          </>
        )}
      </Animated.ScrollView>
      <CollapsingHeader title="Auto meal prep" scrollY={scrollY} />

      {result && result.items.length > 0 && (
        <View
          style={{
            position: 'absolute',
            left: t.spacing.lg,
            right: t.spacing.lg,
            bottom: insets.bottom + t.spacing.sm,
          }}
        >
          <Button
            label="Add to plan"
            icon="check"
            onPress={handleCommit}
            fullWidth
            size="lg"
            style={t.shadow.medium}
          />
        </View>
      )}
    </View>
  );
}
