import React from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../theme/tokens';

type Variant = 'flat' | 'outlined' | 'elevated' | 'sunken' | 'tinted';

interface Props {
  variant?: Variant;
  radius?: number;
  pad?: number;
  tint?: 'primary' | 'accent' | 'danger' | 'warning';
  onPress?: () => void;
  onLongPress?: () => void;
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}

export function Surface({
  variant = 'flat',
  radius,
  pad,
  tint,
  onPress,
  onLongPress,
  children,
  style,
}: Props) {
  const t = useAppTheme();
  const r = radius ?? t.radius.md;

  let bg = t.palette.surface;
  let borderColor: string | undefined;
  let borderWidth = 0;

  if (tint === 'primary') bg = t.palette.primarySoft;
  else if (tint === 'accent') bg = t.palette.accentSoft;
  else if (tint === 'danger') bg = t.palette.dangerSoft;
  else if (tint === 'warning') bg = t.palette.warningSoft;

  if (variant === 'outlined') {
    borderColor = t.palette.border;
    borderWidth = StyleSheet.hairlineWidth;
  } else if (variant === 'sunken') {
    bg = t.palette.surfaceMuted;
  } else if (variant === 'tinted' && !tint) {
    bg = t.palette.surfaceMuted;
  }

  const baseStyle: ViewStyle = {
    backgroundColor: bg,
    borderRadius: r,
    borderColor,
    borderWidth,
    padding: pad,
    ...(variant === 'elevated' ? t.shadow.soft : null),
  };

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          baseStyle,
          style,
          pressed ? { opacity: 0.85, transform: [{ scale: 0.995 }] } : null,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[baseStyle, style]}>{children}</View>;
}
