import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
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

// ViewStyle plus the web-only backdrop-filter props (BlurView is a no-op on web).
type WebGlassStyle = ViewStyle & {
  backdropFilter?: string;
  WebkitBackdropFilter?: string;
};

const HORIZONTAL_PADDING = 16;
const INNER_PAD = 6;
const BAR_HEIGHT = 60;

const ICON_BY_ROUTE: Record<string, string> = {
  Home: 'view-dashboard-variant-outline',
  Library: 'silverware-fork-knife',
  Log: 'notebook-outline',
  List: 'cart-outline',
  Settings: 'tune-variant',
};

const ICON_FOCUSED: Record<string, string> = {
  Home: 'view-dashboard-variant',
  Library: 'silverware-fork-knife',
  Log: 'notebook',
  List: 'cart',
  Settings: 'tune-variant',
};

const LABEL_BY_ROUTE: Record<string, string> = {
  Home: 'Home',
  Library: 'Recipes',
  Log: 'Log',
  List: 'List',
  Settings: 'You',
};

export function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  // Live glassmorphism: a real backdrop blur (native BlurView / web backdrop-filter)
  // under a translucent frosted fill. Falls back to an opaque cream fill when Reduce
  // Transparency is on.
  const reduceTransparency = useReduceTransparency();
  const isWeb = Platform.OS === 'web';
  const solid = reduceTransparency;
  const allowBlur = !solid && !isWeb;
  const blurTint =
    Platform.OS === 'ios' ? 'systemUltraThinMaterialLight' : t.palette.blurTint;
  // Cool translucent-white frost (not warm cream) so the bar separates from the
  // cream backdrop and reads as a frosted glass panel floating above it, while the
  // backdrop blur of content scrolling underneath still shows through. Opaque
  // fallback under Reduce Transparency.
  const FROST = 'rgba(255,255,255,0.55)';
  const webGlass: WebGlassStyle | null =
    isWeb && !solid
      ? {
          backgroundColor: FROST,
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        }
      : null;
  const fillColor = solid ? t.palette.ambienceA : FROST;
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
        {allowBlur ? (
          <BlurView
            intensity={t.blur.thick}
            tint={blurTint}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {/* Translucent frosted fill over the blur (opaque fallback under Reduce
            Transparency). Rim gradient removed to avoid the funky sheen. */}
        <View style={[StyleSheet.absoluteFill, webGlass ?? { backgroundColor: fillColor }]} />
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
                  size={20}
                  color={focused ? t.palette.primaryContrast : t.palette.textSecondary}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    { color: focused ? t.palette.primaryContrast : t.palette.textSecondary },
                  ]}
                >
                  {label}
                </Text>
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
  label: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    marginTop: 2,
  },
});
