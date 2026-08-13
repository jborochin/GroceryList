import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { CompositeNavigationProp, RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealScheduleStore } from '../store/useMealScheduleStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { resolveDay, SLOT_ORDER } from '../utils/foodLogDay';
import { dateKeyLabel, dateKeyToCell, todayKey } from '../utils/planningWeek';
import { confirm } from '../utils/confirm';
import { MealSlot } from '../types';
import { RootStackParamList, TabParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import { DateStrip } from '../components/log/DateStrip';
import { DaySummary } from '../components/log/DaySummary';
import { DayRowItem } from '../components/log/DayRowItem';
import { WeekPlanView } from '../components/log/WeekPlanView';
import { SLOT_ICON, SLOT_LABEL } from '../components/log/weekDays';
import {
  Button,
  Header,
  Screen,
  SectionHeader,
  SegmentedControl,
  Surface,
  Text,
} from '../components/ui';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

type Mode = 'day' | 'week';

/**
 * The Log tab.
 *
 * Absorbs what used to be the Week tab. The two modes are two views of the same
 * thing: the plan is a prediction of the log. A planned meal shows on its day as
 * a projected row that already counts toward the totals, and you either confirm
 * it or replace it with what you actually ate. Neither action touches the
 * schedule — the grocery list is built from that, and those ingredients are
 * already bought.
 */
export function FoodLogScreen() {
  const t = useAppTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParamList, 'Log'>>();

  const [mode, setMode] = useState<Mode>(route.params?.view ?? 'day');
  const [date, setDate] = useState(todayKey());

  const recipes = useRecipeStore((s) => s.recipes);
  const cells = useMealScheduleStore((s) => s.cells);
  const setSelectedWeek = useMealScheduleStore((s) => s.setSelectedWeek);
  const settings = useSettingsStore((s) => s.settings);
  const entries = useFoodLogStore((s) => s.entries);
  const addEntry = useFoodLogStore((s) => s.addEntry);
  const removeEntry = useFoodLogStore((s) => s.removeEntry);

  const summary = useMemo(
    () => resolveDay(date, cells, entries, recipes),
    [date, cells, entries, recipes]
  );

  // A row in the Week grid opens that day's log — planning and logging are one
  // gesture apart rather than a mode switch.
  const openDay = useCallback((dateKey: string) => {
    setDate(dateKey);
    setMode('day');
  }, []);

  // Selecting a day outside the planning week re-points the schedule at it, so
  // the projected rows come from the right week's cells.
  const selectDate = useCallback(
    (dateKey: string) => {
      setDate(dateKey);
      setSelectedWeek(dateKeyToCell(dateKey).weekStart);
    },
    [setSelectedWeek]
  );

  const openSearch = useCallback(
    (slot: MealSlot, replacesCellId?: string) => {
      navigation.navigate('FoodSearch', { slot, date, replacesCellId });
    },
    [navigation, date]
  );

  const handleDelete = useCallback(
    (id: string, title: string) => {
      void confirm({
        title: 'Remove this entry?',
        message: `"${title}" will be removed from your log.`,
        confirmLabel: 'Remove',
        destructive: true,
      }).then((ok) => {
        if (ok) removeEntry(id);
      });
    },
    [removeEntry]
  );

  const dayContent = (
    <>
      <DateStrip selected={date} onSelect={selectDate} />
      <View style={{ marginTop: t.spacing.sm }}>
        <DaySummary summary={summary} settings={settings} />
      </View>

      {SLOT_ORDER.map((slot) => {
        const rows = summary.bySlot[slot];
        const slotCalories = rows.reduce((acc, r) => acc + r.nutrition.calories, 0);
        return (
          <View key={slot}>
            <SectionHeader
              title={SLOT_LABEL[slot]}
              trailing={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                  {rows.length > 0 ? (
                    <Text variant="caption" tone="tertiary" tabularNums>
                      {Math.round(slotCalories)} kcal
                    </Text>
                  ) : null}
                  <Button
                    label="Add"
                    icon="plus"
                    variant="tonal"
                    size="sm"
                    onPress={() => openSearch(slot)}
                  />
                </View>
              }
            />
            {rows.length === 0 ? (
              <Surface
                variant="outlined"
                pad={t.spacing.md}
                style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}
              >
                <Icon name={SLOT_ICON[slot]} size={16} color={t.palette.textTertiary} />
                <Text variant="small" tone="tertiary">
                  Nothing logged or planned.
                </Text>
              </Surface>
            ) : (
              <Surface variant="outlined" pad={t.spacing.xs} style={{ gap: 2 }}>
                {rows.map((row) => (
                  <DayRowItem
                    key={row.key}
                    row={row}
                    onPress={() => {
                      if (row.recipe) {
                        navigation.navigate('RecipeDetail', { recipeId: row.recipe.id });
                      }
                    }}
                    onDelete={() => handleDelete(row.key, row.title)}
                    onAteThis={() => {
                      if (!row.cell) return;
                      addEntry({
                        date,
                        slot,
                        displayName: row.title,
                        source: 'recipe',
                        sourceId: row.cell.recipeId,
                        servingQty: row.cell.desiredServings,
                        servingLabel:
                          row.cell.desiredServings === 1 ? 'serving' : 'servings',
                        nutrition: row.nutrition,
                        fromCellId: row.cell.id,
                      });
                    }}
                    onAteOther={() => openSearch(slot, row.cell?.id)}
                  />
                ))}
              </Surface>
            )}
          </View>
        );
      })}
    </>
  );

  return (
    // Keyed by mode so the scroll container remounts on Day/Week toggle —
    // otherwise the scroll offset from a long Week view carries over and
    // scrolls the shorter Day view's date strip out of view.
    <Screen key={mode} scroll glass headerTitle="Log" bottomBarSpace>
      <Header
        eyebrow={mode === 'day' ? dateKeyLabel(date) : 'Meal plan'}
        title="Log"
        subtitle={
          mode === 'day'
            ? 'What you actually ate — planned meals count until you say otherwise.'
            : 'Plan the week; each meal shows on its day, ready to confirm.'
        }
      />

      <SegmentedControl<Mode>
        items={[
          { value: 'day', label: 'Day', icon: 'notebook-outline' },
          { value: 'week', label: 'Plan', icon: 'calendar-month' },
        ]}
        value={mode}
        onChange={setMode}
        style={{ marginBottom: t.spacing.md }}
      />

      {mode === 'day' ? dayContent : <WeekPlanView onOpenDay={openDay} />}
    </Screen>
  );
}
