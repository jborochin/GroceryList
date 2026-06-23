import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';

type Tone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

interface Props {
  label: string;
  icon?: string;
  tone?: Tone;
  size?: 'sm' | 'md';
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

export function Pill({ label, icon, tone = 'neutral', size = 'md', selected, onPress, style }: Props) {
  const t = useAppTheme();

  let bg = t.palette.surfaceMuted;
  let fg = t.palette.textPrimary;

  if (tone === 'primary') {
    bg = t.palette.primarySoft;
    fg = t.palette.primarySoftText;
  } else if (tone === 'accent') {
    bg = t.palette.accentSoft;
    fg = t.palette.accentSoftText;
  } else if (tone === 'success') {
    bg = t.palette.successSoft;
    fg = t.palette.success;
  } else if (tone === 'warning') {
    bg = t.palette.warningSoft;
    fg = t.palette.warning;
  } else if (tone === 'danger') {
    bg = t.palette.dangerSoft;
    fg = t.palette.dangerSoftText;
  } else if (tone === 'info') {
    bg = t.palette.surfaceMuted;
    fg = t.palette.info;
  }

  if (selected) {
    bg = t.palette.primary;
    fg = t.palette.primaryContrast;
  }

  const padY = size === 'sm' ? 5 : 8;
  const padX = size === 'sm' ? 10 : 14;
  const iconSize = size === 'sm' ? 12 : 14;
  const fontSize = size === 'sm' ? t.fontSize.caption : t.fontSize.small;

  const inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: bg,
        paddingVertical: padY,
        paddingHorizontal: padX,
        borderRadius: t.radius.pill,
      }}
    >
      {icon ? <Icon name={icon} size={iconSize} color={fg} /> : null}
      <Text weight="semibold" style={{ color: fg, fontSize, letterSpacing: -0.1 }}>
        {label}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          { alignSelf: 'flex-start' },
          style,
          pressed ? { opacity: 0.8, transform: [{ scale: 0.97 }] } : null,
        ]}
      >
        {inner}
      </Pressable>
    );
  }

  return <View style={[{ alignSelf: 'flex-start' }, style]}>{inner}</View>;
}
