import React from 'react';
import { View } from 'react-native';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';
import { IconButton } from './IconButton';

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  rightIcon?: string;
  onRightPress?: () => void;
  rightLabel?: string;
  trailing?: React.ReactNode;
}

export function Header({ eyebrow, title, subtitle, rightIcon, onRightPress, trailing }: Props) {
  const t = useAppTheme();
  return (
    <View style={{ marginTop: t.spacing.sm, marginBottom: t.spacing.lg }}>
      {eyebrow ? (
        <Text variant="eyebrow" tone="tertiary" style={{ marginBottom: 6 }}>
          {eyebrow}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: t.spacing.md }}>
          <Text variant="hero">{title}</Text>
          {subtitle ? (
            <Text variant="bodyLg" tone="secondary" style={{ marginTop: 4 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing ?? (rightIcon ? (
          <IconButton
            icon={rightIcon}
            onPress={onRightPress}
            variant="tonal"
            size={20}
          />
        ) : null)}
      </View>
    </View>
  );
}
