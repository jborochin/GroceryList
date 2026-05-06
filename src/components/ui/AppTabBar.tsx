import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { tokens, useAppTheme } from '../../theme/tokens';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Text } from './Text';
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

const LABEL_BY_ROUTE: Record<string, string> = {
  Home: 'Home',
  Library: 'Recipes',
  Plan: 'Week',
  List: 'List',
  Settings: 'You',
};

const AnimatedIcon = Animated.createAnimatedComponent(Icon);

export function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const reduceEffects = useSettingsStore((s) => s.settings.reduceVisualEffects);

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

  const allowBlur = !reduceEffects && Platform.OS !== 'web';

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
            tint={t.palette.blurTint}
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
              <TabItem
                key={route.key}
                iconName={iconName}
                label={label}
                focused={focused}
                onPress={onPress}
                onLongPress={onLongPress}
                width={tabWidth}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

interface TabItemProps {
  iconName: string;
  label: string;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  width: number;
}

function TabItem({ iconName, label, focused, onPress, onLongPress, width }: TabItemProps) {
  const t = useAppTheme();
  const focus = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, { duration: t.duration.base });
  }, [focused, focus, t.duration.base]);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
    maxWidth: interpolate(focus.value, [0, 1], [0, 80]),
    marginLeft: interpolate(focus.value, [0, 1], [0, 6]),
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={4}
      style={[styles.tab, { width, height: BAR_HEIGHT - INNER_PAD * 2 }]}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
    >
      <AnimatedIcon
        name={iconName}
        size={20}
        color={focused ? t.palette.primaryContrast : t.palette.textSecondary}
      />
      <Animated.View style={[{ overflow: 'hidden' }, labelStyle]}>
        <Text
          variant="small"
          weight="semibold"
          numberOfLines={1}
          style={{ color: t.palette.primaryContrast }}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
});
