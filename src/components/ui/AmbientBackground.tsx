import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { useReduceMotion, useReduceTransparency } from '../../hooks/useReduceEffects';
import { useParallax } from './ParallaxContext';

// Single static radial backdrop for the whole app: a bright cool near-white at
// the center easing to a slightly deeper green-tinged white at the edges (8 stops
// to avoid banding). Mounted once at the root so it never re-renders on navigation.
// A slow scroll-driven parallax nudges the center ±8px; both the parallax and the
// blur fall back to a solid fill under Reduce Motion / Reduce Transparency.
const OVERSCAN = 16;
const BACKDROP = '#F5F8F6';

const STOPS: { offset: string; color: string }[] = [
  { offset: '0%', color: '#FBFDFC' },
  { offset: '12%', color: '#F9FBFA' },
  { offset: '24%', color: '#F7F9F8' },
  { offset: '36%', color: '#F5F8F6' },
  { offset: '48%', color: '#F2F6F4' },
  { offset: '62%', color: '#EFF3F1' },
  { offset: '80%', color: '#EAF0ED' },
  { offset: '100%', color: '#E4EBE7' },
];

export function AmbientBackground() {
  const reduceTransparency = useReduceTransparency();
  const reduceMotion = useReduceMotion();
  const parallax = useParallax();
  const { width, height } = useWindowDimensions();

  const animatedStyle = useAnimatedStyle(() => {
    if (!parallax || reduceMotion) return {};
    const y = parallax.value;
    return {
      transform: [
        { translateX: interpolate(y, [0, 1000], [-4, 4], Extrapolation.CLAMP) },
        { translateY: interpolate(y, [0, 1000], [8, -8], Extrapolation.CLAMP) },
      ],
    };
  }, [parallax, reduceMotion]);

  if (reduceTransparency) {
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP }]}
      />
    );
  }

  const w = width + OVERSCAN * 2;
  const h = height + OVERSCAN * 2;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP, overflow: 'hidden' }]}
    >
      <Animated.View
        style={[
          { position: 'absolute', left: -OVERSCAN, top: -OVERSCAN, width: w, height: h },
          animatedStyle,
        ]}
      >
        <Svg width={w} height={h}>
          <Defs>
            <RadialGradient id="ambient" cx="50%" cy="42%" r="75%">
              {STOPS.map((s) => (
                <Stop key={s.offset} offset={s.offset} stopColor={s.color} stopOpacity={1} />
              ))}
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={w} height={h} fill="url(#ambient)" />
        </Svg>
      </Animated.View>
    </View>
  );
}
