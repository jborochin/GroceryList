import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useAppTheme } from '../../theme/tokens';

interface Props {
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
  rounded?: boolean;
}

export function ProgressBar({ progress, color, trackColor, height = 6, rounded = true }: Props) {
  const t = useAppTheme();
  const w = useSharedValue(0);

  const clamped = Math.max(0, Math.min(1, progress));

  useEffect(() => {
    w.value = withTiming(clamped, { duration: t.duration.slow });
  }, [clamped, w, t.duration.slow]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${w.value * 100}%`,
  }));

  return (
    <View
      style={{
        height,
        borderRadius: rounded ? height / 2 : 0,
        backgroundColor: trackColor ?? t.palette.surfaceSunken,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          {
            height: '100%',
            backgroundColor: color ?? t.palette.primary,
            borderRadius: rounded ? height / 2 : 0,
          },
          fillStyle,
        ]}
      />
    </View>
  );
}
