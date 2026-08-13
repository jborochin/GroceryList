import React, { useEffect, useMemo, useState } from 'react';
import { Alert, View, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRecipeStore } from '../../store/useRecipeStore';
import { useMealPlanStore } from '../../store/useMealPlanStore';
import { useMealScheduleStore } from '../../store/useMealScheduleStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ServingStepper } from '../ServingStepper';
import { EmptyState } from '../EmptyState';
import { MealPickerSheet } from '../MealPickerSheet';
import { computeNutritionSummary } from '../../utils/nutritionSummary';
import { ensureRecipeForMeal } from '../../utils/commitMealPlan';
import { catalogCloneIdSet } from '../../utils/deterministicId';
import {
  cellToDateKey,
  getWeekStart,
  shiftWeek,
  weekRangeLabel,
} from '../../utils/planningWeek';
import {
  getMealCatalog,
  loadMealCatalogCache,
  refreshMealCatalogCache,
} from '../../lib/mealCatalogSync';
import { NutritionBar } from '../NutritionBar';
import { RootStackParamList, TabParamList } from '../../navigation/types';
import { Meal, MealSlot, ScheduleCell } from '../../types';
import { useAppTheme } from '../../theme/tokens';
import {
  Surface,
  Text,
  IconButton,
  SectionHeader,
  Button,
  Pill,
} from '../ui';
import { buildWeek } from './weekDays';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

import { SLOTS, SLOT_ICON, SLOT_LABEL } from './weekDays';

interface Props {
  /** Jump to a day's log — the Week view's rows are also a way in to logging. */
  onOpenDay: (dateKey: string) => void;
}

// The meal-plan calendar. Formerly the Week tab's own screen; now the Log tab's
// "Week" mode, so it renders content only — FoodLogScreen owns the scroll
// container, the header and the ambient background.
export function WeekPlanView({ onOpenDay }: Props) {
  const t = useAppTheme();
  const navigation = useNavigation<Nav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const plan = useMealPlanStore((s) => s.entries);
  const planDays = useMealPlanStore((s) => s.planDays);
  const addEntry = useMealPlanStore((s) => s.addEntry);
  const removeEntry = useMealPlanStore((s) => s.removeEntry);
  const cells = useMealScheduleStore((s) => s.cells);
  const selectedWeekStart = useMealScheduleStore((s) => s.selectedWeekStart);
  const setSelectedWeek = useMealScheduleStore((s) => s.setSelectedWeek);
  const assign = useMealScheduleStore((s) => s.assign);
  const removeCell = useMealScheduleStore((s) => s.removeCell);
  const updateCellServings = useMealScheduleStore((s) => s.updateCellServings);
  const clearSchedule = useMealScheduleStore((s) => s.clearSchedule);
  const clearPlan = useMealPlanStore((s) => s.clearPlan);
  const settings = useSettingsStore((s) => s.settings);

  type PickerTarget = { mode: 'slot'; day: number; slot: MealSlot } | { mode: 'loose' };
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  // Pull the freshest shared catalog so "Browse catalog" matches Auto Meal Prep.
  useEffect(() => {
    void loadMealCatalogCache().then(refreshMealCatalogCache);
  }, []);
  const catalog = getMealCatalog();

  const week = useMemo(() => buildWeek(selectedWeekStart), [selectedWeekStart]);
  const isCurrentWeek = selectedWeekStart === getWeekStart();

  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  // The picker's "My recipes" tab shows only user-authored recipes — catalog
  // clones (materialized for the pipeline) live under its "Browse catalog" tab.
  const myRecipes = useMemo(() => {
    const cloneIds = catalogCloneIdSet(catalog.map((m) => m.id));
    return recipes.filter((r) => !cloneIds.has(r.id));
  }, [recipes, catalog]);

  // Only the selected week's placements are shown (and drive the counts below);
  // other weeks' cells stay in the store untouched.
  const weekCells = useMemo(
    () => cells.filter((c) => c.weekStart === selectedWeekStart),
    [cells, selectedWeekStart]
  );

  // Group cells by `${day}:${slot}` so each calendar cell can render its meals.
  const cellsByKey = useMemo(() => {
    const map = new Map<string, ScheduleCell[]>();
    for (const cell of weekCells) {
      const key = `${cell.day}:${cell.slot}`;
      const arr = map.get(key) ?? [];
      arr.push(cell);
      map.set(key, arr);
    }
    return map;
  }, [weekCells]);

  // Plan recipes queued for the week that haven't been placed on the calendar yet.
  const unscheduled = useMemo(() => {
    const scheduled = new Set(weekCells.map((c) => c.recipeId));
    return plan
      .filter((e) => !scheduled.has(e.recipeId) && recipeById.has(e.recipeId))
      .map((e) => ({ entry: e, recipe: recipeById.get(e.recipeId)! }));
  }, [plan, weekCells, recipeById]);

  const nutrition = useMemo(
    () => computeNutritionSummary(plan, recipes, settings, planDays),
    [plan, recipes, settings, planDays]
  );

  const hasPlan = weekCells.length > 0 || plan.length > 0;

  const handleClearWeek = () => {
    Alert.alert(
      'Clear this week?',
      `All meals for ${weekRangeLabel(selectedWeekStart)} will be removed from the calendar and grocery list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => { clearSchedule(); clearPlan(); },
        },
      ]
    );
  };

  const openPicker = (day: number, slot: MealSlot) => setPicker({ mode: 'slot', day, slot });
  const openLoosePicker = () => setPicker({ mode: 'loose' });

  const handleSelectRecipe = (recipeId: string, defaultServings: number) => {
    if (picker?.mode === 'slot') assign(picker.day, picker.slot, recipeId, defaultServings);
    else if (picker?.mode === 'loose') addEntry(recipeId, defaultServings);
    setPicker(null);
  };

  const handleSelectMeal = (meal: Meal) => {
    if (picker?.mode === 'slot') {
      const recipeId = ensureRecipeForMeal(meal);
      assign(picker.day, picker.slot, recipeId, meal.servings);
    } else if (picker?.mode === 'loose') {
      const recipeId = ensureRecipeForMeal(meal);
      addEntry(recipeId, meal.servings);
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
    );
  }

  const destinationLabel =
    picker?.mode === 'slot'
      ? `${week[picker.day].label} · ${SLOT_LABEL[picker.slot]}`
      : weekRangeLabel(selectedWeekStart);

  return (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: t.spacing.xs }}>
        {hasPlan ? (
          <IconButton
            icon="trash-can-outline"
            onPress={handleClearWeek}
            variant="tonal"
            size={20}
            accessibilityLabel="Clear all meals this week"
          />
        ) : null}
        <IconButton
          icon="auto-fix"
          onPress={() => navigation.navigate('AutoMealPrep')}
          variant="tonal"
          size={20}
          accessibilityLabel="Auto meal prep"
        />
      </View>

      {/* Week switcher — every planning action here targets the selected week,
          and the grocery list follows it. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.sm,
            marginBottom: t.spacing.md,
          }}
        >
          <IconButton
            icon="chevron-left"
            onPress={() => setSelectedWeek(shiftWeek(selectedWeekStart, -1))}
            variant="tonal"
            size={20}
            accessibilityLabel="Previous week"
          />
          <Pressable
            style={{ flex: 1, alignItems: 'center' }}
            disabled={isCurrentWeek}
            onPress={() => setSelectedWeek(getWeekStart())}
            accessibilityRole="button"
            accessibilityLabel={isCurrentWeek ? weekRangeLabel(selectedWeekStart) : 'Back to this week'}
          >
            <Text variant="body" weight="semibold" tabularNums>
              {weekRangeLabel(selectedWeekStart)}
            </Text>
            {!isCurrentWeek ? (
              <Text variant="micro" style={{ color: t.palette.primary }}>
                Back to this week
              </Text>
            ) : null}
          </Pressable>
          <IconButton
            icon="chevron-right"
            onPress={() => setSelectedWeek(shiftWeek(selectedWeekStart, 1))}
            variant="tonal"
            size={20}
            accessibilityLabel="Next week"
          />
        </View>

        <View style={{ gap: t.spacing.sm }}>
          {week.map((day) => (
            <Surface
              key={day.index}
              variant="outlined"
              pad={t.spacing.md}
              style={day.isToday ? { borderColor: t.palette.primary, borderWidth: 1 } : undefined}
            >
              {/* Day header — also the way into that day's log, so planning and
                  logging are one gesture apart rather than a mode switch. */}
              <Pressable
                onPress={() => onOpenDay(cellToDateKey(selectedWeekStart, day.index))}
                accessibilityRole="button"
                accessibilityLabel={`Open the log for ${day.label} ${day.date}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.sm,
                  minHeight: 44,
                  marginBottom: t.spacing.xs,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text variant="bodyLg" weight="semibold">
                  {day.label}
                </Text>
                <Text variant="caption" tone="tertiary" tabularNums>
                  {day.date}
                </Text>
                {day.isToday ? <Pill label="Today" tone="primary" size="sm" /> : null}
                <View style={{ marginLeft: 'auto' }}>
                  <Icon name="chevron-right" size={18} color={t.palette.textTertiary} />
                </View>
              </Pressable>

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

        <SectionHeader
          title="Queued to cook"
          count={unscheduled.length}
          trailing={
            <Button label="Add recipe" icon="plus" variant="tonal" size="sm" onPress={openLoosePicker} />
          }
        />
        {unscheduled.length > 0 ? (
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
        ) : (
          <Surface variant="outlined" pad={t.spacing.lg} style={{ alignItems: 'center', gap: t.spacing.sm }}>
            <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
              Add recipes you plan to cook this week — you can decide which day later.
            </Text>
            <Button label="Add recipe" icon="plus" variant="tonal" size="sm" onPress={openLoosePicker} />
          </Surface>
        )}

        {weekCells.length > 0 || unscheduled.length > 0 ? (
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

      {/* Inline rather than floating: the tab now has two modes, and a
          pinned button would sit under the Day/Week toggle competing with the
          tab bar for the same corner. */}
      {hasPlan ? (
        <Button
          label="View grocery list"
          icon="cart-arrow-right"
          onPress={() => navigation.navigate('List')}
          fullWidth
          size="lg"
          variant="secondary"
          style={{ marginTop: t.spacing.lg }}
        />
      ) : null}

      <MealPickerSheet
        visible={picker !== null}
        destinationLabel={destinationLabel}
        recipes={myRecipes}
        catalog={catalog}
        onSelectRecipe={handleSelectRecipe}
        onSelectMeal={handleSelectMeal}
        onClose={() => setPicker(null)}
        onAddRecipe={() => {
          setPicker(null);
          navigation.navigate('AddRecipe', undefined);
        }}
      />
    </>
  );
}
