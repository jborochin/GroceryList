import React from 'react';
import { View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../theme/tokens';
import { Text } from './ui/Text';

interface Props {
  icon?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon = 'package-variant', title, subtitle, children }: Props) {
  const t = useAppTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: t.spacing.xxl,
        paddingVertical: t.spacing.xxl,
      }}
    >
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 44,
          backgroundColor: t.palette.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: t.spacing.lg,
        }}
      >
        <Icon name={icon} size={40} color={t.palette.textTertiary} />
      </View>
      <Text variant="title" style={{ textAlign: 'center', marginBottom: 6 }}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="body" tone="secondary" style={{ textAlign: 'center', maxWidth: 320 }}>
          {subtitle}
        </Text>
      ) : null}
      {children ? <View style={{ marginTop: t.spacing.xl }}>{children}</View> : null}
    </View>
  );
}
