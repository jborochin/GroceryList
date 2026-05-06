import React, { useEffect, useMemo, useState } from 'react';
import { TextStyle } from 'react-native';
import {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme/tokens';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Text } from './Text';

interface Props {
  value: number;
  formatter?: (n: number) => string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  variant?: React.ComponentProps<typeof Text>['variant'];
  weight?: React.ComponentProps<typeof Text>['weight'];
  tone?: React.ComponentProps<typeof Text>['tone'];
  style?: TextStyle;
  durationMs?: number;
}

// Animates a number to its target by sampling the animated SharedValue on the
// JS side once per frame. Tabular nums prevent layout jitter as digits change.
export function CountUpText({
  value,
  formatter,
  decimals = 0,
  prefix = '',
  suffix = '',
  variant = 'display',
  weight,
  tone,
  style,
  durationMs,
}: Props) {
  const t = useAppTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(value);
  const [displayed, setDisplayed] = useState(value);

  const dur = durationMs ?? t.duration.slow;

  useEffect(() => {
    if (reduceMotion) {
      progress.value = value;
      setDisplayed(value);
    } else {
      progress.value = withTiming(value, {
        duration: dur,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [value, dur, reduceMotion, progress]);

  useAnimatedReaction(
    () => progress.value,
    (current) => {
      runOnJS(setDisplayed)(current);
    },
    []
  );

  const text = useMemo(() => {
    if (formatter) return formatter(displayed);
    return `${prefix}${displayed.toFixed(decimals)}${suffix}`;
  }, [formatter, displayed, prefix, suffix, decimals]);

  return (
    <Text variant={variant} weight={weight} tone={tone} tabularNums style={style}>
      {text}
    </Text>
  );
}
