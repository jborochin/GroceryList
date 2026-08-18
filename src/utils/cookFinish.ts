import { FoodLogEntry, MealSlot, ScheduleCell } from '../types';
import { dateKeyToCell } from './planningWeek';

// What the "finish cooking" sheet should open with.
//
// Cooking a meal you planned for today is the common case, so the sheet seeds
// itself from that plan cell: its slot, its servings, and its id — which the
// resulting FoodLogEntry carries as `fromCellId`, exactly like the Log tab's
// "Ate this" button.
//
// Nothing here mutates anything. That matters more than it looks: the grocery
// list is built from schedule cells, and the ingredients for a meal you just
// cooked were bought days ago. Logging a finished cook retires the day's
// *projection* and must never remove the cell. See resolveDay() in
// foodLogDay.ts, which is the other half of that contract.

export interface CookFinishInput {
  date: string; // local ISO date key
  recipeId: string;
  cells: ScheduleCell[]; // the whole schedule store; filtered here
  entries: FoodLogEntry[]; // the whole log store; filtered here
  now?: Date;
}

export interface CookFinishDefaults {
  /** The plan cell this cook answers, when there is one. */
  cell?: ScheduleCell;
  slot: MealSlot;
  servings: number;
}

export function resolveCookFinish({
  date,
  recipeId,
  cells,
  entries,
  now = new Date(),
}: CookFinishInput): CookFinishDefaults {
  const { weekStart, day } = dateKeyToCell(date);

  // Cells already answered by a log entry — confirmed or replaced. Collected
  // across ALL entries, not just this day's, matching resolveDay().
  const answered = new Set<string>();
  for (const e of entries) {
    if (e.fromCellId) answered.add(e.fromCellId);
    if (e.replacesCellId) answered.add(e.replacesCellId);
  }

  const cell = cells.find(
    (c) =>
      c.weekStart === weekStart &&
      c.day === day &&
      c.recipeId === recipeId &&
      !answered.has(c.id)
  );

  return {
    cell,
    slot: cell?.slot ?? slotForTime(now),
    // Cooking four servings rarely means eating four. Without a plan to go on,
    // one serving is the safer default — it's easier to raise than to notice.
    servings: cell?.desiredServings ?? 1,
  };
}

/** Best guess at which meal you just cooked, from the clock. */
export function slotForTime(now: Date): MealSlot {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 10 * 60 + 30) return 'breakfast';
  if (minutes < 15 * 60) return 'lunch';
  if (minutes < 21 * 60) return 'dinner';
  return 'snack';
}
