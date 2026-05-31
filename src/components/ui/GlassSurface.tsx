import React from 'react';
import { Platform, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../theme/tokens';
import { useReduceTransparency } from '../../hooks/useReduceEffects';

type Variant = 'chrome' | 'hero' | 'content';
type Tint = 'neutral' | 'primary' | 'accent' | 'danger';

// ViewStyle plus the web-only backdrop-filter props (BlurView is a no-op on web,
// so glass parity there comes from a composited frosted layer).
type WebGlassStyle = ViewStyle & {
  backdropFilter?: string;
  WebkitBackdropFilter?: string;
};

interface Props {
  variant?: Variant;
  tint?: Tint;
  radius?: number;
  pad?: number;
  rim?: boolean;
  shadow?: 'none' | 'soft' | 'medium' | 'strong';
  onPress?: () => void;
  onLongPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}

// Layered Liquid Glass primitive: BlurView (iOS/Android) or backdrop-filter
// (web) + translucent white fill + specular rim/hairline + drop shadow. Falls
// back to a solid Apple-style surface when Reduce Transparency is on.
export function GlassSurface({
  variant = 'content',
  tint = 'neutral',
  radius,
  pad,
  rim = true,
  shadow = 'soft',
  onPress,
  onLongPress,
  style,
  children,
}: Props) {
  const t = useAppTheme();
  const reduceTransparency = useReduceTransparency();

  const r = radius ?? t.radius.lg;
  const isWeb = Platform.OS === 'web';

  const fill =
    variant === 'chrome'
      ? t.palette.glassThick
      : variant === 'hero'
      ? t.palette.glassRegular
      : t.palette.glassThin;

  const intensity =
    variant === 'chrome' ? t.blur.thick : variant === 'hero' ? t.blur.regular : t.blur.thin;

  // Native blur only for the heavier variants; web uses backdrop-filter instead.
  const allowBlur =
    !reduceTransparency && !isWeb && (variant === 'chrome' || variant === 'hero');

  // Apple's Reduce Transparency fallback colour.
  const solid = reduceTransparency;
  const fillColor = solid ? 'rgba(28,28,30,0.96)' : fill;

  const blurTint =
    Platform.OS === 'ios' ? 'systemUltraThinMaterialDark' : t.palette.blurTint;

  const webGlass: WebGlassStyle | null =
    isWeb && !solid
      ? {
          backgroundColor: fill,
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        }
      : null;

  const tintBg =
    tint === 'primary'
      ? t.palette.primarySoft
      : tint === 'accent'
      ? t.palette.accentSoft
      : tint === 'danger'
      ? t.palette.dangerSoft
      : null;

  const shadowStyle =
    shadow === 'soft'
      ? t.shadow.soft
      : shadow === 'medium'
      ? t.shadow.medium
      : shadow === 'strong'
      ? t.shadow.strong
      : null;

  const inner = (
    <View style={{ borderRadius: r, borderCurve: 'continuous', overflow: 'hidden' }}>
      {allowBlur ? (
        <BlurView
          intensity={intensity}
          tint={blurTint}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        style={[StyleSheet.absoluteFill, webGlass ?? { backgroundColor: fillColor }]}
      />
      {tintBg && !solid ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tintBg, opacity: 0.55 }]} />
      ) : null}
      {rim ? (
        <LinearGradient
          pointerEvents="none"
          colors={[t.palette.rimLight, 'transparent', t.palette.rimGround]}
          locations={[0, 0.45, 1]}
          style={[StyleSheet.absoluteFill, { borderRadius: r }]}
        />
      ) : null}
      {/* Specular hairline (Apple's bright top edge) */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: r,
            borderCurve: 'continuous',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: t.palette.rimLight,
          },
        ]}
      />
      <View style={{ padding: pad }}>{children}</View>
    </View>
  );

  const wrapStyle: ViewStyle = {
    borderRadius: r,
    borderCurve: 'continuous',
    ...(shadowStyle ?? {}),
  };

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          wrapStyle,
          style,
          pressed ? { opacity: 0.92, transform: [{ scale: 0.995 }] } : null,
        ]}
      >
        {inner}
      </Pressable>
    );
  }

  return <View style={[wrapStyle, style]}>{inner}</View>;
}
