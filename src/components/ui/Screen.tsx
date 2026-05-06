import React from 'react';
import { ScrollViewProps, StyleSheet, View, ViewProps } from 'react-native';
import Animated, {
  SharedValue,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme/tokens';
import { AmbientBackground } from './AmbientBackground';
import { CollapsingHeader } from './CollapsingHeader';

export const TAB_BAR_SPACE = 92;

interface Props extends ViewProps {
  scroll?: boolean;
  edges?: { top?: boolean; bottom?: boolean };
  pad?: boolean;
  bg?: 'default' | 'sunken' | 'elevated';
  glass?: boolean;
  /** Renders a scroll-driven glass shelf at the top with this title. */
  headerTitle?: string;
  /** External scroll progress to drive the glass shelf — use when the screen
   *  manages its own scroll container (e.g. FlatList, SectionList). */
  scrollY?: SharedValue<number>;
  children: React.ReactNode;
  contentContainerStyle?: object;
  bottomBarSpace?: boolean;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle' | 'onScroll'>;
}

export function Screen({
  scroll = false,
  edges = { top: true, bottom: false },
  pad = true,
  bg = 'default',
  glass = false,
  headerTitle,
  scrollY,
  bottomBarSpace = true,
  children,
  style,
  contentContainerStyle,
  scrollProps,
  ...rest
}: Props) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const bgColor =
    bg === 'sunken' ? t.palette.surfaceSunken : bg === 'elevated' ? t.palette.bgElevated : t.palette.bg;

  const padding = {
    paddingTop: edges.top ? insets.top : 0,
    paddingBottom: (edges.bottom ? insets.bottom : 0) + (bottomBarSpace ? TAB_BAR_SPACE : 0),
  };

  // Internal scroll tracking when the screen owns its ScrollView.
  const internalScrollY = useSharedValue(0);
  const trackInternal = scroll && headerTitle && !scrollY;
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      internalScrollY.value = e.contentOffset.y;
    },
  });

  const containerBg = glass ? 'transparent' : bgColor;
  const headerScrollY = scrollY ?? internalScrollY;

  if (scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: bgColor }, style]} {...rest}>
        {glass ? <AmbientBackground /> : null}
        <Animated.ScrollView
          {...scrollProps}
          contentContainerStyle={[
            { paddingHorizontal: pad ? t.spacing.lg : 0, ...padding },
            contentContainerStyle,
          ]}
          style={[{ backgroundColor: containerBg }, scrollProps?.style]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={trackInternal ? scrollHandler : undefined}
        >
          {children}
        </Animated.ScrollView>
        {headerTitle ? (
          <CollapsingHeader title={headerTitle} scrollY={headerScrollY} />
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: bgColor,
        },
        style,
      ]}
      {...rest}
    >
      {glass ? <AmbientBackground /> : null}
      <View
        style={{
          flex: 1,
          paddingHorizontal: pad ? t.spacing.lg : 0,
          ...padding,
        }}
      >
        {children}
      </View>
      {headerTitle && scrollY ? (
        <CollapsingHeader title={headerTitle} scrollY={scrollY} />
      ) : null}
    </View>
  );
}

export const screenStyles = StyleSheet.create({
  fill: { flex: 1 },
});
