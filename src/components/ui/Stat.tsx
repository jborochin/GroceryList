import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';

interface Props {
  label: string;
  value: string;
  hint?: string;
  align?: 'start' | 'center' | 'end';
  size?: 'sm' | 'md' | 'lg';
  tone?: 'primary' | 'accent' | 'default';
  style?: ViewStyle;
}

export function Stat({ label, value, hint, align = 'start', size = 'md', tone = 'default', style }: Props) {
  const t = useAppTheme();
  const alignItems = align === 'center' ? 'center' : align === 'end' ? 'flex-end' : 'flex-start';

  const valueColor =
    tone === 'primary' ? t.palette.primary
    : tone === 'accent' ? t.palette.accent
    : t.palette.textPrimary;

  const valueVariant: 'display' | 'headline' | 'title' =
    size === 'lg' ? 'display' : size === 'sm' ? 'title' : 'headline';

  return (
    <View style={[{ alignItems }, style]}>
      <Text
        variant="eyebrow"
        tone="tertiary"
        style={{ marginBottom: 6 }}
      >
        {label}
      </Text>
      <Text variant={valueVariant} style={{ color: valueColor }} tabularNums>
        {value}
      </Text>
      {hint ? (
        <Text variant="caption" tone="tertiary" style={{ marginTop: 2 }} tabularNums>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
