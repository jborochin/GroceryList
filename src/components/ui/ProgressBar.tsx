import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../theme/tokens';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface Props {
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
  rounded?: boolean;
}

export function ProgressBar({ progress, color, trackColor, height = 6, rounded = true }: Props) {
  const t = useAppTheme();
  const reduceMotion = useReducedMotion();
  const { width: screenWidth } = useWindowDimensions();
  const w = useSharedValue(0);
  const gloss = useSharedValue(0);

  const clamped = Math.max(0, Math.min(1, progress));
  const isFull = clamped >= 0.999;

  useEffect(() => {
    w.value = withTiming(clamped, { duration: t.duration.slow });
  }, [clamped, w, t.duration.slow]);

  useEffect(() => {
    if (isFull && !reduceMotion) {
      gloss.value = 0;
      gloss.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        -1,
        false
      );
    } else {
      cancelAnimation(gloss);
      gloss.value = 0;
    }
  }, [isFull, reduceMotion, gloss]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${w.value * 100}%`,
  }));

  const glossStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -screenWidth + (screenWidth * 1.5) * gloss.value }],
    opacity: isFull ? 1 - Math.abs(gloss.value - 0.5) * 1.4 : 0,
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
            overflow: 'hidden',
          },
          fillStyle,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { width: 80 },
            glossStyle,
          ]}
        >
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
