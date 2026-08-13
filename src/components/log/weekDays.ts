import { MealSlot } from '../../types';
import { getWeekStart, parseWeekStart } from '../../utils/planningWeek';

// Slot presentation, shared by the Log tab's Day and Week views so a meal slot
// looks the same whichever one you are in.

export const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export const SLOT_ICON: Record<MealSlot, string> = {
  breakfast: 'weather-sunset-up',
  lunch: 'white-balance-sunny',
  dinner: 'weather-night',
  snack: 'food-apple-outline',
};

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface WeekDay {
  index: number;
  label: string;
  date: number;
  isToday: boolean;
}

// 0 = Monday. Day headers carry the real dates of the selected week ("Mon 23",
// today highlighted only when that week contains today); the schedule keys off
// weekStart + day index.
export function buildWeek(weekStart: string): WeekDay[] {
  const monday = parseWeekStart(weekStart);
  const isCurrentWeek = weekStart === getWeekStart();
  const todayIndex = (new Date().getDay() + 6) % 7;
  return WEEKDAY_SHORT.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { index: i, label, date: d.getDate(), isToday: isCurrentWeek && i === todayIndex };
  });
}
