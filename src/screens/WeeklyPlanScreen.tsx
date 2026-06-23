import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useMealScheduleStore } from '../store/useMealScheduleStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { ServingStepper } from '../components/ServingStepper';
import { EmptyState } from '../components/EmptyState';
import { MealPickerSheet } from '../components/MealPickerSheet';
import { computeNutritionSummary } from '../utils/nutritionSummary';
import { ensureRecipeForMeal } from '../utils/commitMealPlan';
import {
  getMealCatalog,
  loadMealCatalogCache,
  refreshMealCatalogCache,
} from '../lib/mealCatalogSync';
import { NutritionBar } from '../components/NutritionBar';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { Meal, MealSlot, ScheduleCell } from '../types';
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

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};
const SLOT_ICON: Record<MealSlot, string> = {
  breakfast: 'weather-sunset-up',
  lunch: 'white-balance-sunny',
  dinner: 'weather-night',
  snack: 'food-apple-outline',
};

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// 0 = Monday. The calendar is anchored to the current local week purely so the
// day headers read like a real week ("Mon 23" + today highlighted); the schedule
// itself keys off the day index, not a date.
function buildWeek() {
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - todayIndex);
  return WEEKDAY_SHORT.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { index: i, label, date: d.getDate(), isToday: i === todayIndex };
  });
}

export function WeeklyPlanScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const plan = useMealPlanStore((s) => s.entries);
  const planDays = useMealPlanStore((s) => s.planDays);
  const removeEntry = useMealPlanStore((s) => s.removeEntry);
  const cells = useMealScheduleStore((s) => s.cells);
  const assign = useMealScheduleStore((s) => s.assign);
  const removeCell = useMealScheduleStore((s) => s.removeCell);
  const updateCellServings = useMealScheduleStore((s) => s.updateCellServings);
  const settings = useSettingsStore((s) => s.settings);

  const [picker, setPicker] = useState<{ day: number; slot: MealSlot } | null>(null);

  // Pull the freshest shared catalog so "Browse catalog" matches Auto Meal Prep.
  useEffect(() => {
    void loadMealCatalogCache().then(refreshMealCatalogCache);
  }, []);
  const catalog = getMealCatalog();

  const week = useMemo(buildWeek, []);

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  // Group cells by `${day}:${slot}` so each calendar cell can render its meals.
  const cellsByKey = useMemo(() => {
    const map = new Map<string, ScheduleCell[]>();
    for (const cell of cells) {
      const key = `${cell.day}:${cell.slot}`;
      const arr = map.get(key) ?? [];
      arr.push(cell);
      map.set(key, arr);
    }
    return map;
  }, [cells]);

  // Plan recipes that haven't been placed on the calendar yet (e.g. a plan that
  // arrived via sync from another device, or pre-dates the calendar feature).
  const unscheduled = useMemo(() => {
    const scheduled = new Set(cells.map((c) => c.recipeId));
    return plan
      .filter((e) => !scheduled.has(e.recipeId) && recipeById.has(e.recipeId))
      .map((e) => ({ entry: e, recipe: recipeById.get(e.recipeId)! }));
  }, [plan, cells, recipeById]);

  const nutrition = useMemo(
    () => computeNutritionSummary(plan, recipes, settings, planDays),
    [plan, recipes, settings, planDays]
  );

  const totalServings = plan.reduce((acc, p) => acc + p.desiredServings, 0);
  const hasPlan = cells.length > 0 || plan.length > 0;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const openPicker = (day: number, slot: MealSlot) => setPicker({ day, slot });

  const handleSelectRecipe = (recipeId: string, defaultServings: number) => {
    if (picker) assign(picker.day, picker.slot, recipeId, defaultServings);
    setPicker(null);
  };

  const handleSelectMeal = (meal: Meal) => {
    if (picker) {
      const recipeId = ensureRecipeForMeal(meal);
      assign(picker.day, picker.slot, recipeId, meal.servings);
    }
    setPicker(null);
  };

  // Drop an unscheduled recipe into the first empty calendar cell, scanning by
  // day then slot. Preserves the recipe's existing serving count.
  const placeUnscheduled = (recipeId: string, servings: number) => {
    for (const day of week) {
      for (const slot of SLOTS) {
        if (!cellsByKey.has(`${day.index}:${slot}`)) {
          assign(day.index, slot, recipeId, servings);
          return;
        }
      }
    }
    assign(0, 'dinner', recipeId, servings);
  };

  if (recipes.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: t.palette.bg, paddingTop: insets.top }}>
        <EmptyState
          icon="calendar-blank-outline"
          title="No recipes yet"
          subtitle="Add a recipe to your library, or let us auto-build a week that fits your macros."
        >
          <Button
            label="Auto meal prep"
            icon="auto-fix"
            onPress={() => navigation.navigate('AutoMealPrep')}
            size="lg"
          />
        </EmptyState>
      </View>
    );
  }

  const destinationLabel = picker
    ? `${week[picker.day].label} · ${SLOT_LABEL[picker.slot]}`
    : '';

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <Animated.ScrollView
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: TAB_BAR_SPACE + (hasPlan ? 80 : t.spacing.lg),
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Header
          title="This week"
          subtitle={
            cells.length === 0
              ? 'Tap a meal slot to plan it, or auto-build a week.'
              : `${cells.length} ${cells.length === 1 ? 'meal' : 'meals'} planned · ${totalServings} servings`
          }
          rightIcon="auto-fix"
          onRightPress={() => navigation.navigate('AutoMealPrep')}
        />

        <View style={{ gap: t.spacing.sm }}>
          {week.map((day) => (
            <Surface
              key={day.index}
              variant="outlined"
              pad={t.spacing.md}
              style={day.isToday ? { borderColor: t.palette.primary, borderWidth: 1 } : undefined}
            >
              {/* Day header */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.sm,
                  marginBottom: t.spacing.sm,
                }}
              >
                <Text variant="bodyLg" weight="semibold">
                  {day.label}
                </Text>
                <Text variant="caption" tone="tertiary" tabularNums>
                  {day.date}
                </Text>
                {day.isToday ? (
                  <View style={{ marginLeft: 'auto' }}>
                    <Pill label="Today" tone="primary" size="sm" />
                  </View>
                ) : null}
              </View>

              {/* Meal slots */}
              <View style={{ gap: t.spacing.xs }}>
                {SLOTS.map((slot) => {
                  const slotCells = cellsByKey.get(`${day.index}:${slot}`) ?? [];
                  return (
                    <View key={slot}>
                      {slotCells.length === 0 ? (
                        <Pressable
                          onPress={() => openPicker(day.index, slot)}
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${SLOT_LABEL[slot]} for ${day.label}`}
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: t.spacing.sm,
                            minHeight: 44,
                            paddingHorizontal: t.spacing.sm,
                            borderRadius: t.radius.sm,
                            backgroundColor: pressed ? t.palette.surfaceMuted : 'transparent',
                          })}
                        >
                          <Icon name={SLOT_ICON[slot]} size={16} color={t.palette.textTertiary} />
                          <Text variant="small" tone="tertiary" style={{ flex: 1 }}>
                            Add {SLOT_LABEL[slot].toLowerCase()}
                          </Text>
                          <Icon name="plus" size={18} color={t.palette.textTertiary} />
                        </Pressable>
                      ) : (
                        <View
                          style={{
                            backgroundColor: t.palette.surfaceMuted,
                            borderRadius: t.radius.sm,
                            paddingHorizontal: t.spacing.sm,
                            paddingVertical: t.spacing.xs,
                            gap: t.spacing.xs,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Icon name={SLOT_ICON[slot]} size={13} color={t.palette.textSecondary} />
                            <Text variant="micro" weight="medium" tone="secondary">
                              {SLOT_LABEL[slot]}
                            </Text>
                            <Pressable
                              onPress={() => openPicker(day.index, slot)}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={`Add another ${SLOT_LABEL[slot]} for ${day.label}`}
                              style={{ marginLeft: 'auto' }}
                            >
                              <Icon name="plus" size={16} color={t.palette.primary} />
                            </Pressable>
                          </View>
                          {slotCells.map((cell) => {
                            const recipe = recipeById.get(cell.recipeId);
                            return (
                              <View
                                key={cell.id}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}
                              >
                                <Pressable
                                  style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
                                  onPress={() =>
                                    navigation.navigate('RecipeDetail', { recipeId: cell.recipeId })
                                  }
                                  accessibilityRole="button"
                                  accessibilityLabel={`View ${recipe?.title ?? 'recipe'} details`}
                                >
                                  <Text variant="body" weight="medium" numberOfLines={1}>
                                    {recipe?.title ?? 'Unknown recipe'}
                                  </Text>
                                </Pressable>
                                <ServingStepper
                                  value={cell.desiredServings}
                                  onChange={(v) => updateCellServings(cell.id, v)}
                                />
                                <IconButton
                                  icon="close"
                                  onPress={() => removeCell(cell.id)}
                                  variant="tonal"
                                  size={14}
                                  accessibilityLabel="Remove meal"
                                />
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </Surface>
          ))}
        </View>

        {unscheduled.length > 0 ? (
          <>
            <SectionHeader
              title="Unscheduled"
              count={unscheduled.length}
              trailing={<Pill label="Not on calendar" tone="warning" size="sm" />}
            />
            <View style={{ gap: t.spacing.sm }}>
              {unscheduled.map(({ entry, recipe }) => (
                <Surface key={recipe.id} variant="outlined" pad={t.spacing.md}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLg" weight="semibold" numberOfLines={1}>
                        {recipe.title}
                      </Text>
                      <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                        {entry.desiredServings} servings
                      </Text>
                    </View>
                    <Button
                      label="Place"
                      icon="calendar-plus"
                      variant="tonal"
                      size="sm"
                      onPress={() => placeUnscheduled(recipe.id, entry.desiredServings)}
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
          </>
        ) : null}

        {cells.length > 0 || unscheduled.length > 0 ? (
          <>
            <SectionHeader
              title="Nutrition preview"
              trailing={
                planDays !== 7 ? (
                  <Pill label={`${planDays}-day plan`} tone="neutral" size="sm" />
                ) : undefined
              }
            />
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
      </Animated.ScrollView>
      <CollapsingHeader title="This week" scrollY={scrollY} />

      {hasPlan ? (
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

      <MealPickerSheet
        visible={picker !== null}
        destinationLabel={destinationLabel}
        recipes={recipes}
        catalog={catalog}
        onSelectRecipe={handleSelectRecipe}
        onSelectMeal={handleSelectMeal}
        onClose={() => setPicker(null)}
        onAddRecipe={() => {
          setPicker(null);
          navigation.navigate('AddRecipe', undefined);
        }}
      />
    </View>
  );
}
