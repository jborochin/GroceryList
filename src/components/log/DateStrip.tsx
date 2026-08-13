import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAppTheme } from '../../theme/tokens';
import { parseDateKey, shiftDate, todayKey } from '../../utils/planningWeek';
import { Text } from '../ui';
import { WEEKDAY_SHORT } from './weekDays';

interface Props {
  selected: string;
  onSelect: (dateKey: string) => void;
  /** How many days either side of today to offer. */
  range?: number;
}

// A horizontal week of days around today. Scrollable rather than paged so
// yesterday is always one tap away — backfilling a missed meal is the second
// most common thing people do in a food diary, after logging today's.
export function DateStrip({ selected, onSelect, range = 14 }: Props) {
  const t = useAppTheme();
  const today = todayKey();

  const days = useMemo(() => {
    const out: Array<{ key: string; weekday: string; date: number }> = [];
    for (let i = -range; i <= 0; i++) {
      const key = shiftDate(today, i);
      const d = parseDateKey(key);
      out.push({ key, weekday: WEEKDAY_SHORT[(d.getDay() + 6) % 7], date: d.getDate() });
    }
    return out;
  }, [today, range]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Anchor at the right edge: today is the last cell and the one that
      // should be visible on open.
      contentOffset={{ x: Number.MAX_SAFE_INTEGER, y: 0 }}
      contentContainerStyle={{ gap: t.spacing.xs, paddingVertical: t.spacing.xs }}
    >
      {days.map((day) => {
        const isSelected = day.key === selected;
        const isToday = day.key === today;
        return (
          <Pressable
            key={day.key}
            onPress={() => onSelect(day.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${day.weekday} ${day.date}${isToday ? ', today' : ''}`}
            style={({ pressed }) => ({
              // 44pt minimum touch target.
              width: 46,
              minHeight: 56,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radius.md,
              backgroundColor: isSelected
                ? t.palette.primary
                : pressed
                ? t.palette.surfaceMuted
                : 'transparent',
              borderWidth: !isSelected && isToday ? 1 : 0,
              borderColor: t.palette.primary,
            })}
          >
            <Text
              variant="micro"
              style={{
                color: isSelected ? t.palette.primaryContrast : t.palette.textTertiary,
              }}
            >
              {day.weekday}
            </Text>
            <Text
              variant="body"
              weight="semibold"
              tabularNums
              style={{
                marginTop: 1,
                color: isSelected ? t.palette.primaryContrast : t.palette.textPrimary,
              }}
            >
              {day.date}
            </Text>
          </Pressable>
        );
      })}
      {/* Trailing spacer so the last cell isn't flush against the screen edge. */}
      <View style={{ width: t.spacing.xs }} />
    </ScrollView>
  );
}
