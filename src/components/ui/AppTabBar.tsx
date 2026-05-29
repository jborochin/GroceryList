import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { tokens, useAppTheme } from '../../theme/tokens';
import { useReduceTransparency } from '../../hooks/useReduceEffects';
import { haptics } from '../../utils/haptics';

const HORIZONTAL_PADDING = 16;
const INNER_PAD = 6;
const BAR_HEIGHT = 60;

const ICON_BY_ROUTE: Record<string, string> = {
  Home: 'view-dashboard-variant-outline',
  Library: 'silverware-fork-knife',
  Plan: 'calendar-blank-outline',
  List: 'cart-outline',
  Settings: 'tune-variant',
};

const ICON_FOCUSED: Record<string, string> = {
  Home: 'view-dashboard-variant',
  Library: 'silverware-fork-knife',
  Plan: 'calendar-month',
  List: 'cart',
  Settings: 'tune-variant',
};

// Labels are not drawn (icon-only bar) but are still announced to screen readers.
const LABEL_BY_ROUTE: Record<string, string> = {
  Home: 'Home',
  Library: 'Recipes',
  Plan: 'Week',
  List: 'List',
  Settings: 'You',
};

export function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const reduceTransparency = useReduceTransparency();

  const tabCount = state.routes.length;
  const innerWidth = windowWidth - HORIZONTAL_PADDING * 2 - INNER_PAD * 2;
  const tabWidth = innerWidth / tabCount;

  const indicatorX = useSharedValue(state.index * tabWidth);

  useEffect(() => {
    indicatorX.value = withSpring(state.index * tabWidth, tokens.spring);
  }, [state.index, tabWidth, indicatorX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
    width: tabWidth,
  }));

  const allowBlur = !reduceTransparency && Platform.OS !== 'web';
  const blurTint =
    Platform.OS === 'ios' ? 'systemUltraThinMaterialDark' : t.palette.blurTint;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.outer,
        {
          left: HORIZONTAL_PADDING,
          right: HORIZONTAL_PADDING,
          bottom: Math.max(insets.bottom, 8) + 6,
        },
      ]}
    >
      <View
        style={[
          styles.bar,
          {
            borderRadius: t.radius.xl,
            ...t.shadow.strong,
          },
        ]}
      >
        {/* Layered glass: blur → translucent fill → rim gradient */}
        {allowBlur ? (
          <BlurView
            intensity={t.blur.thick}
            tint={blurTint}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: allowBlur ? t.palette.glassThick : t.palette.surface },
          ]}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[t.palette.rimLight, 'transparent', t.palette.rimGround]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: t.radius.xl,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: t.palette.border,
            },
          ]}
        />
        <View style={[styles.row, { padding: INNER_PAD }]}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              {
                top: INNER_PAD,
                bottom: INNER_PAD,
                left: INNER_PAD,
                borderRadius: t.radius.lg,
                backgroundColor: t.palette.primary,
                overflow: 'hidden',
              },
              indicatorStyle,
            ]}
          >
            {/* Subtle gloss on the active indicator so it catches light */}
            <LinearGradient
              colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']}
              locations={[0, 0.6]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const iconName = focused
              ? ICON_FOCUSED[route.name] ?? ICON_BY_ROUTE[route.name]
              : ICON_BY_ROUTE[route.name] ?? 'circle-small';
            const label = LABEL_BY_ROUTE[route.name] ?? route.name;
            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                haptics.selection();
                navigation.navigate(route.name as never);
              }
            };
            const onLongPress = () => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            };
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                onLongPress={onLongPress}
                hitSlop={4}
                style={[styles.tab, { width: tabWidth, height: BAR_HEIGHT - INNER_PAD * 2 }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={label}
              >
                <Icon
                  name={iconName}
                  size={22}
                  color={focused ? t.palette.primaryContrast : t.palette.textSecondary}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
  },
  bar: {
    height: BAR_HEIGHT,
    overflow: 'hidden',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
