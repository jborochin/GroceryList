import React from 'react';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CookTimer } from '../../types';
import { useAppTheme } from '../../theme/tokens';
import { Text } from '../ui';
import { haptics } from '../../utils/haptics';
import { ParsedDuration } from '../../utils/stepTimers';
import { formatClock, remainingSeconds } from '../../utils/cookTimers';
import { Checkbox } from './CookIngredientRow';

interface Props {
  index: number;
  text: string;
  checked: boolean;
  onToggle: () => void;
  /** Durations found in this step's own text — see parseStepDurations. */
  durations: ParsedDuration[];
  /** Timers already started from this step, so a chip can show its own countdown. */
  timers: CookTimer[];
  now: number;
  onStartTimer: (duration: ParsedDuration) => void;
  isLast: boolean;
}

export function CookStepRow({
  index,
  text,
  checked,
  onToggle,
  durations,
  timers,
  now,
  onStartTimer,
  isLast,
}: Props) {
  const t = useAppTheme();

  return (
    <View
      style={{
        paddingVertical: 12,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: t.palette.border,
      }}
    >
      <Pressable
        onPress={() => {
          haptics.selection();
          onToggle();
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`Step ${index + 1}. ${text}`}
        style={({ pressed }) => [
          { flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' },
          pressed ? { opacity: 0.7 } : null,
        ]}
      >
        <View style={{ marginTop: 1 }}>
          <Checkbox checked={checked} />
        </View>
        <Text
          variant="caption"
          weight="bold"
          tabularNums
          style={{ color: t.palette.textTertiary, marginTop: 4, width: 16 }}
        >
          {index + 1}
        </Text>
        <Text
          variant="body"
          style={{
            flex: 1,
            lineHeight: 23,
            opacity: checked ? 0.45 : 1,
            textDecorationLine: checked ? 'line-through' : 'none',
          }}
        >
          {text}
        </Text>
      </Pressable>

      {durations.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: t.spacing.sm,
            // Indent past the checkbox + step number so chips read as belonging
            // to the step rather than to the list.
            marginLeft: 24 + t.spacing.md + 16 + t.spacing.md,
            marginTop: t.spacing.sm,
          }}
        >
          {durations.map((d) => (
            <TimerChip
              key={d.seconds}
              duration={d}
              // A step's timer is identified by its duration: tapping "20 min"
              // twice on the same step is almost always a mis-tap, not a second
              // pot, so a live chip shows its countdown instead of restarting.
              live={timers.find((timer) => timer.totalSeconds === d.seconds)}
              now={now}
              onPress={() => onStartTimer(d)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TimerChip({
  duration,
  live,
  now,
  onPress,
}: {
  duration: ParsedDuration;
  live?: CookTimer;
  now: number;
  onPress: () => void;
}) {
  const t = useAppTheme();
  const running = live !== undefined && live.state !== 'fired';

  const bg = running ? t.palette.primary : t.palette.primarySoft;
  const fg = running ? t.palette.primaryContrast : t.palette.primarySoftText;
  const label = live && running ? formatClock(remainingSeconds(live, now)) : duration.label;

  return (
    <Pressable
      onPress={running ? undefined : onPress}
      disabled={running}
      accessibilityRole="button"
      accessibilityLabel={running ? `Timer running, ${label} left` : `Start a ${duration.label} timer`}
      style={({ pressed }) => [pressed ? { opacity: 0.8, transform: [{ scale: 0.97 }] } : null]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          backgroundColor: bg,
          paddingVertical: 7,
          paddingHorizontal: 12,
          borderRadius: t.radius.pill,
        }}
      >
        <Icon name={running ? 'timer-sand' : 'timer-outline'} size={14} color={fg} />
        <Text
          weight="semibold"
          tabularNums
          style={{ color: fg, fontSize: t.fontSize.small, letterSpacing: -0.1 }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
