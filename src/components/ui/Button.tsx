import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';
import { haptics } from '../../utils/haptics';

type Variant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props {
  label?: string;
  icon?: string;
  trailingIcon?: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  haptic?: boolean;
  style?: ViewStyle | ViewStyle[];
}

export function Button({
  label,
  icon,
  trailingIcon,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  fullWidth,
  haptic = true,
  style,
}: Props) {
  const t = useAppTheme();
  const isDisabled = disabled || loading;

  const padY = size === 'sm' ? 8 : size === 'lg' ? 16 : 12;
  const padX = size === 'sm' ? 14 : size === 'lg' ? 22 : 18;
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 20 : 18;
  const fontSize = size === 'sm' ? t.fontSize.small : size === 'lg' ? t.fontSize.bodyLg : t.fontSize.body;

  let bg = t.palette.primary;
  let fg = t.palette.primaryContrast;
  let borderColor: string | undefined;
  let borderWidth = 0;

  if (variant === 'secondary') {
    bg = 'transparent';
    fg = t.palette.textPrimary;
    borderColor = t.palette.borderStrong;
    borderWidth = 1;
  } else if (variant === 'tonal') {
    bg = t.palette.primarySoft;
    fg = t.palette.primarySoftText;
  } else if (variant === 'ghost') {
    bg = 'transparent';
    fg = t.palette.textPrimary;
  } else if (variant === 'danger') {
    bg = t.palette.danger;
    fg = '#FFFFFF';
  }

  const handlePress = () => {
    if (isDisabled) return;
    if (haptic) haptics.tap();
    onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderColor,
          borderWidth,
          borderRadius: t.radius.pill,
          paddingVertical: padY,
          paddingHorizontal: padX,
          opacity: isDisabled ? 0.5 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          ...(pressed && !isDisabled ? { transform: [{ scale: 0.97 }], opacity: 0.92 } : null),
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} color={fg} />
      ) : null}
      {label ? (
        <Text
          weight="semibold"
          style={{ color: fg, fontSize, letterSpacing: -0.1 }}
        >
          {label}
        </Text>
      ) : null}
      {trailingIcon && !loading ? (
        <Icon name={trailingIcon} size={iconSize} color={fg} />
      ) : null}
    </Pressable>
  );
}

export const buttonStyles = StyleSheet.create({});
