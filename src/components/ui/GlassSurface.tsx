import React from 'react';
import { Platform, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../theme/tokens';
import { useSettingsStore } from '../../store/useSettingsStore';

type Variant = 'chrome' | 'hero' | 'content';
type Tint = 'neutral' | 'primary' | 'accent' | 'danger';

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

// Layered glass primitive: BlurView (when enabled) + translucent fill +
// gradient rim. Falls back to opaque Surface-like rendering when blur is
// unavailable or the user has reduced visual effects on.
export function GlassSurface({
  variant = 'content',
  tint = 'neutral',
  radius,
  pad,
  rim = true,
  shadow = 'none',
  onPress,
  onLongPress,
  style,
  children,
}: Props) {
  const t = useAppTheme();
  const reduceEffects = useSettingsStore((s) => s.settings.reduceVisualEffects);

  const r = radius ?? t.radius.lg;

  const fill =
    variant === 'chrome'
      ? t.palette.glassThick
      : variant === 'hero'
      ? t.palette.glassRegular
      : t.palette.glassThin;

  const intensity =
    variant === 'chrome' ? t.blur.thick : variant === 'hero' ? t.blur.regular : t.blur.thin;

  // Hero/chrome use BlurView when allowed; content stays cheap (no blur).
  const allowBlur =
    !reduceEffects &&
    Platform.OS !== 'web' &&
    (variant === 'chrome' || variant === 'hero');

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
    <View style={{ borderRadius: r, overflow: 'hidden' }}>
      {allowBlur ? (
        <BlurView
          intensity={intensity}
          tint={t.palette.blurTint}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {tintBg ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tintBg, opacity: 0.55 }]} />
      ) : null}
      {rim ? (
        <LinearGradient
          pointerEvents="none"
          colors={[t.palette.rimLight, 'transparent', t.palette.rimGround]}
          locations={[0, 0.4, 1]}
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: r,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: 'transparent',
            },
          ]}
        />
      ) : null}
      <View style={{ padding: pad }}>{children}</View>
    </View>
  );

  const wrapStyle: ViewStyle = {
    borderRadius: r,
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
