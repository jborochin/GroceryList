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

// Single static radial backdrop for the whole app: charcoal at the center
// easing to pure black at the edges (8 stops to avoid banding). Mounted once at
// the root so it never re-renders on navigation. A slow scroll-driven parallax
// nudges the center ±8px; both the parallax and the blur fall back to a solid
// fill under Reduce Motion / Reduce Transparency.
const OVERSCAN = 16;

const STOPS: { offset: string; color: string }[] = [
  { offset: '0%', color: '#2A2A2E' },
  { offset: '12%', color: '#232327' },
  { offset: '24%', color: '#1C1C20' },
  { offset: '36%', color: '#161618' },
  { offset: '48%', color: '#101012' },
  { offset: '62%', color: '#0A0A0B' },
  { offset: '80%', color: '#050506' },
  { offset: '100%', color: '#000000' },
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
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }]}
      />
    );
  }

  const w = width + OVERSCAN * 2;
  const h = height + OVERSCAN * 2;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', overflow: 'hidden' }]}
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
