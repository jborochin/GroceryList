import React from 'react';
import { View } from 'react-native';
import { useAppTheme } from '../theme/tokens';
import { Text } from './ui/Text';
import { ProgressBar } from './ui/ProgressBar';

interface Props {
  label: string;
  actual: number;
  target: number;
  unit?: string;
  color?: string;
}

export function NutritionBar({ label, actual, target, unit = 'g', color }: Props) {
  const t = useAppTheme();
  const pct = target > 0 ? Math.min(1.5, actual / target) : 0;
  const variance = target > 0 ? Math.round(((actual - target) / target) * 100) : 0;
  const overTarget = pct > 1;

  return (
    <View style={{ marginVertical: 8 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <Text variant="small" weight="medium">
          {label}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text variant="small" tone="secondary" tabularNums>
            {Math.round(actual)}
            {unit} / {Math.round(target)}
            {unit}
          </Text>
          {target > 0 ? (
            <Text
              variant="caption"
              weight="semibold"
              style={{ color: overTarget ? t.palette.warning : t.palette.success }}
              tabularNums
            >
              {variance >= 0 ? '+' : ''}
              {variance}%
            </Text>
          ) : null}
        </View>
      </View>
      <ProgressBar
        progress={Math.min(1, pct)}
        color={color ?? t.palette.primary}
        trackColor={t.palette.surfaceMuted}
      />
    </View>
  );
}
