import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useAppTheme } from '../../theme/tokens';
import { getSundayWeekStart, parseDateKey, shiftDate, todayKey } from '../../utils/planningWeek';
import { Text } from '../ui';

interface Props {
  selected: string;
  onSelect: (dateKey: string) => void;
}

const WEEKDAY_SUN_FIRST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The current calendar week, Sunday through Saturday — the week containing
// whichever date is selected, so opening a day from another week (via the
// Week view) always shows a strip that includes it.
export function DateStrip({ selected, onSelect }: Props) {
  const t = useAppTheme();
  const today = todayKey();

  const days = useMemo(() => {
    const sunday = getSundayWeekStart(selected);
    const out: Array<{ key: string; weekday: string; date: number }> = [];
    for (let i = 0; i < 7; i++) {
      const key = shiftDate(sunday, i);
      const d = parseDateKey(key);
      out.push({ key, weekday: WEEKDAY_SUN_FIRST[d.getDay()], date: d.getDate() });
    }
    return out;
  }, [selected]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
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
