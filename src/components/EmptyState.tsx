import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../theme/tokens';
import { Text } from './ui/Text';
import { useReducedMotion } from '../hooks/useReducedMotion';

interface Props {
  icon?: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon = 'package-variant', title, subtitle, children }: Props) {
  const t = useAppTheme();
  const reduceMotion = useReducedMotion();
  const breathe = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      breathe.value = 0;
      return;
    }
    breathe.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [reduceMotion, breathe]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breathe.value * 0.04 }],
    opacity: 1 - breathe.value * 0.05,
  }));

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
      <Animated.View
        style={[
          {
            width: 88,
            height: 88,
            borderRadius: 44,
            backgroundColor: t.palette.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: t.spacing.lg,
          },
          iconStyle,
        ]}
      >
        <Icon name={icon} size={40} color={t.palette.textTertiary} />
      </Animated.View>
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
