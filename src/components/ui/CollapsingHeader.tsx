import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  SharedValue,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme/tokens';
import { useReduceTransparency } from '../../hooks/useReduceEffects';
import { Text } from './Text';

interface Props {
  title: string;
  scrollY: SharedValue<number>;
  threshold?: number;
}

// Floating glass shelf that fades in as the user scrolls past `threshold`.
// Sits above scroll content; doesn't replace the inline page header.
export function CollapsingHeader({ title, scrollY, threshold = 24 }: Props) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceTransparency = useReduceTransparency();
  const allowBlur = !reduceTransparency && Platform.OS !== 'web';
  const blurTint =
    Platform.OS === 'ios' ? 'systemUltraThinMaterialLight' : t.palette.blurTint;

  const containerStyle = useAnimatedStyle(() => {
    const o = interpolate(
      scrollY.value,
      [threshold, threshold + 56],
      [0, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity: o,
      transform: [
        {
          translateY: interpolate(
            scrollY.value,
            [threshold, threshold + 56],
            [-8, 0],
            Extrapolation.CLAMP
          ),
        },
      ],
    };
  }, [threshold]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.host,
        {
          paddingTop: insets.top,
        },
        containerStyle,
      ]}
    >
      <View style={{ height: 52, justifyContent: 'center' }}>
        {allowBlur ? (
          <BlurView
            intensity={t.blur.thick}
            tint={blurTint}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: allowBlur ? t.palette.glassThick : t.palette.surface },
          ]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['transparent', t.palette.rimGround]}
          locations={[0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Text
          variant="title"
          weight="semibold"
          numberOfLines={1}
          style={{ paddingHorizontal: t.spacing.lg }}
        >
          {title}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  },
});
