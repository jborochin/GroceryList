import React from 'react';
import { Pressable, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { haptics } from '../../utils/haptics';

interface Props {
  icon: string;
  onPress?: () => void;
  variant?: 'plain' | 'tonal' | 'outlined' | 'soft' | 'danger';
  size?: number;
  color?: string;
  disabled?: boolean;
  haptic?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function IconButton({
  icon,
  onPress,
  variant = 'plain',
  size = 22,
  color,
  disabled,
  haptic = true,
  accessibilityLabel,
  style,
}: Props) {
  const t = useAppTheme();

  let bg = 'transparent';
  let fg = color ?? t.palette.textPrimary;
  let borderColor: string | undefined;
  let borderWidth = 0;

  if (variant === 'tonal') {
    bg = t.palette.surfaceMuted;
  } else if (variant === 'outlined') {
    borderColor = t.palette.border;
    borderWidth = 1;
  } else if (variant === 'soft') {
    bg = t.palette.primarySoft;
    fg = color ?? t.palette.primarySoftText;
  } else if (variant === 'danger') {
    bg = t.palette.dangerSoft;
    fg = color ?? t.palette.dangerSoftText;
  }

  const dim = size + 20;

  const handlePress = () => {
    if (disabled) return;
    if (haptic) haptics.tap();
    onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? icon}
      style={({ pressed }) => [
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: bg,
          borderColor,
          borderWidth,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
          ...(pressed && !disabled ? { transform: [{ scale: 0.92 }] } : null),
        },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={fg} />
    </Pressable>
  );
}
