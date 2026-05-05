import React from 'react';
import { View } from 'react-native';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';

interface Props {
  title: string;
  count?: number;
  trailing?: React.ReactNode;
  marginTop?: number;
}

export function SectionHeader({ title, count, trailing, marginTop }: Props) {
  const t = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginTop: marginTop ?? t.spacing.xl,
        marginBottom: t.spacing.md,
        gap: t.spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flex: 1 }}>
        <Text variant="title">{title}</Text>
        {count !== undefined ? (
          <Text variant="small" tone="tertiary" tabularNums>
            {count}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}
