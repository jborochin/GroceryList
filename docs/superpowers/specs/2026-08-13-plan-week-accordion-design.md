# Plan Week Accordion — Design Spec

**Date:** 2026-08-13
**Status:** Approved

## Context

The Log tab's "Week" mode (`WeekPlanView.tsx`) renders all seven days of the selected week fully expanded — each with all four meal slots and their add/assign controls. On a phone screen this requires significant scrolling to see the whole week, and there's no visual distinction between "the day I'm working on" and "the other six days."

## Goal

Turn the week list into an accordion: exactly one day is expanded (full slot controls) at a time; the other six collapse to a single summary row each, so the whole week fits on screen without scrolling. Also rename the "Week" segment to "Plan" — it's a planning surface, distinct from the Day view's log.

---

## Changes

### 1. Segmented control label

`src/screens/FoodLogScreen.tsx` — the `SegmentedControl` item's `label` changes from `'Week'` to `'Plan'`:

```ts
{ value: 'week', label: 'Plan', icon: 'calendar-month' }
```

The `Mode` type and the `'week'` value are unchanged — this is a display-only rename. No other file references the string `'Week'` as a mode identifier.

### 2. `expandedDay` state in `WeekPlanView`

New local state, not persisted:

```ts
const [expandedDay, setExpandedDay] = useState(() => defaultExpandedDay(selectedWeekStart));

function defaultExpandedDay(weekStart: string): number {
  const isCurrentWeek = weekStart === getWeekStart();
  return isCurrentWeek ? (new Date().getDay() + 6) % 7 : 0;
}
```

An effect resets it whenever `selectedWeekStart` changes (Prev/Next week buttons, or "Back to this week"), using the same `defaultExpandedDay` logic — so navigating to a different week always opens on today (if that week contains it) or Monday, never a stale index left over from the previous week.

### 3. Day row rendering — collapsed

For every `day` in `week` where `day.index !== expandedDay`, render a single-row `Surface`:

- Weekday label + date (as today), "Today" `Pill` if `day.isToday`
- Four small slot-icons on the trailing edge, one per `SLOTS` entry, using the existing `SLOT_ICON` map: filled/tinted (`t.palette.primary`) if `cellsByKey.get(`${day.index}:${slot}`)` is non-empty, dim/outline (`t.palette.textTertiary`) otherwise
- A trailing chevron-right icon button (see §5)
- No slot list, no Add buttons, no `ServingStepper`

Tapping the row (outside the chevron button) calls `setExpandedDay(day.index)`. Tapping the already-expanded day's row is unreachable since that day isn't rendered collapsed.

### 4. Day row rendering — expanded

Exactly the current full card for `day.index === expandedDay`: header (label, date, Today pill, chevron), then all four `SLOTS` with their existing Add-button / assigned-meal / `ServingStepper` / remove-button treatment. Unchanged from today's implementation except:

- The `isToday`-only border highlight becomes an `isExpanded`-driven highlight (`day.index === expandedDay`), so the expanded day is always visually distinguished, whether or not it's also today. `isToday` still renders its `Pill` independently.

### 5. Chevron → jump to Day view

The chevron-right icon in the header row becomes its own pressable icon button (not just decorative), always calling `onOpenDay(cellToDateKey(selectedWeekStart, day.index))` — independent of the row's expand/collapse press, and independent of whether the day is currently expanded or collapsed. This preserves the one-tap path from Plan mode into that day's actual Log that today's row-press provided, now that the row-press is repurposed for expand/collapse.

### 6. Placing an unscheduled recipe

`placeUnscheduled` (the "Place" button under Queued to cook) keeps its existing first-empty-slot scan across `week`/`SLOTS`, and additionally calls `setExpandedDay(day.index)` for whichever day it placed into, so the result is visible immediately without the user needing to find and expand that day manually.

---

## Non-goals

- No change to `ScheduleCell`, `useMealScheduleStore`, or any persisted state — `expandedDay` is ephemeral UI state, reset on mount and on week change.
- No change to Day mode, `DateStrip`, or `resolveDay`.
- No change to how many days are *fetched* — all seven days' cells are still read from the store; only the rendered detail level changes.

## Testing

`WeekPlanView` is a screen-level component (not a `src/utils/` pure function), so per the project's testing philosophy this is verified by running the app, not a Jest suite: confirm accordion behavior, the default-expanded-day logic across "current week" vs. other weeks, the chevron's independent navigation, and that collapsed rows correctly reflect filled/empty slots.
