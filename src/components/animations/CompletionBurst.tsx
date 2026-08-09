import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../../theme/tokens';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface Props {
  // When this changes (or becomes truthy), the burst plays.
  trigger: number | boolean;
  size?: number;
  particles?: number;
}

const COLORS = ['#2ECC71', '#16A085', '#E67E22', '#F5B041', '#34495E'];

// Lightweight confetti — N dots scale + translate radially + fade out.
// All transform/opacity, no layout work. Respects reduced-motion.
export function CompletionBurst({ trigger, size = 8, particles = 12 }: Props) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      {Array.from({ length: particles }).map((_, i) => (
        <Particle
          key={i}
          index={i}
          total={particles}
          size={size}
          color={COLORS[i % COLORS.length]}
          trigger={trigger}
        />
      ))}
    </View>
  );
}

function Particle({
  index,
  total,
  size,
  color,
  trigger,
}: {
  index: number;
  total: number;
  size: number;
  color: string;
  trigger: number | boolean;
}) {
  const t = useAppTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      index * 12,
      withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) })
    );
  }, [trigger, index, progress]);

  const angle = (index / total) * Math.PI * 2;
  const radius = 110;

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        { translateX: Math.cos(angle) * radius * p },
        { translateY: Math.sin(angle) * radius * p - 40 * p * (1 - p) * 4 },
        { scale: p < 0.6 ? p / 0.6 : 1 - (p - 0.6) / 0.4 },
      ],
      opacity: p < 0.85 ? 1 : 1 - (p - 0.85) / 0.15,
    };
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: t.isDark ? color : color,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -4,
    marginTop: -4,
  },
});
