import React from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CookTimer } from '../../types';
import { useAppTheme } from '../../theme/tokens';
import { IconButton, Text } from '../ui';
import { formatClock, remainingSeconds } from '../../utils/cookTimers';

interface Props {
  timers: CookTimer[];
  now: number;
  onPause: (timer: CookTimer) => void;
  onResume: (timer: CookTimer) => void;
  onDismiss: (timer: CookTimer) => void;
}

/**
 * The one thing that must stay visible no matter where the list is scrolled.
 * Timers scroll horizontally rather than wrapping, so the bar keeps a fixed
 * height and never pushes the steps around mid-cook.
 */
export function TimerBar({ timers, now, onPause, onResume, onDismiss }: Props) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();

  if (timers.length === 0) return null;

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: t.spacing.sm,
        paddingBottom: insets.bottom + t.spacing.sm,
        backgroundColor: t.palette.bgElevated,
        borderTopWidth: 1,
        borderTopColor: t.palette.border,
        ...t.shadow.strong,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: t.spacing.lg,
          gap: t.spacing.sm,
        }}
      >
        {timers.map((timer) => (
          <TimerCard
            key={timer.id}
            timer={timer}
            now={now}
            onPause={() => onPause(timer)}
            onResume={() => onResume(timer)}
            onDismiss={() => onDismiss(timer)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function TimerCard({
  timer,
  now,
  onPause,
  onResume,
  onDismiss,
}: {
  timer: CookTimer;
  now: number;
  onPause: () => void;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const t = useAppTheme();
  const done = timer.state === 'fired';
  const paused = timer.state === 'paused';

  // A fired timer shouts in the accent colour: it is the one thing on this
  // screen that needs to be noticed from across the kitchen.
  const bg = done ? t.palette.accent : t.palette.surfaceMuted;
  const fg = done ? t.palette.accentContrast : t.palette.textPrimary;
  const subFg = done ? t.palette.accentContrast : t.palette.textSecondary;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.sm,
        backgroundColor: bg,
        paddingVertical: t.spacing.sm,
        paddingLeft: t.spacing.md,
        paddingRight: t.spacing.xs,
        borderRadius: t.radius.md,
        minWidth: 172,
      }}
    >
      <Icon
        name={done ? 'bell-ring' : paused ? 'pause-circle-outline' : 'timer-outline'}
        size={18}
        color={done ? t.palette.accentContrast : t.palette.primary}
      />
      <View style={{ flex: 1 }}>
        <Text variant="micro" style={{ color: subFg }} numberOfLines={1}>
          {done ? `${timer.label} · done` : paused ? `${timer.label} · paused` : timer.label}
        </Text>
        <Text variant="title" tabularNums style={{ color: fg }}>
          {formatClock(remainingSeconds(timer, now))}
        </Text>
      </View>

      {!done ? (
        <IconButton
          icon={paused ? 'play' : 'pause'}
          onPress={paused ? onResume : onPause}
          size={18}
          accessibilityLabel={paused ? `Resume ${timer.label}` : `Pause ${timer.label}`}
        />
      ) : null}
      <IconButton
        icon="close"
        onPress={onDismiss}
        size={18}
        color={done ? t.palette.accentContrast : undefined}
        accessibilityLabel={`Dismiss ${timer.label}`}
      />
    </View>
  );
}
