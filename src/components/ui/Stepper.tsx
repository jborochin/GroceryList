import React from 'react';
import { View } from 'react-native';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';
import { IconButton } from './IconButton';
import { haptics } from '../../utils/haptics';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  size?: 'sm' | 'md';
}

export function Stepper({ value, onChange, min = 1, max = 99, unit, size = 'md' }: Props) {
  const t = useAppTheme();
  const dec = () => {
    if (value > min) {
      haptics.selection();
      onChange(value - 1);
    }
  };
  const inc = () => {
    if (value < max) {
      haptics.selection();
      onChange(value + 1);
    }
  };
  const iconSize = size === 'sm' ? 16 : 18;
  const minWidth = size === 'sm' ? 32 : 44;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: t.palette.surfaceMuted,
        borderRadius: t.radius.pill,
        padding: 3,
        gap: 2,
      }}
    >
      <IconButton
        icon="minus"
        size={iconSize}
        onPress={dec}
        disabled={value <= min}
        haptic={false}
      />
      <View style={{ minWidth, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 3 }}>
        <Text variant="bodyLg" weight="semibold" tabularNums>
          {value}
        </Text>
        {unit ? (
          <Text variant="caption" tone="tertiary">
            {unit}
          </Text>
        ) : null}
      </View>
      <IconButton
        icon="plus"
        size={iconSize}
        onPress={inc}
        disabled={value >= max}
        haptic={false}
      />
    </View>
  );
}
