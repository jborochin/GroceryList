import React from 'react';
import { ScrollView, StyleSheet, View, ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../theme/tokens';

export const TAB_BAR_SPACE = 92;

interface Props extends ViewProps {
  scroll?: boolean;
  edges?: { top?: boolean; bottom?: boolean };
  pad?: boolean;
  bg?: 'default' | 'sunken' | 'elevated';
  children: React.ReactNode;
  contentContainerStyle?: object;
  bottomBarSpace?: boolean;
}

export function Screen({
  scroll = false,
  edges = { top: true, bottom: false },
  pad = true,
  bg = 'default',
  bottomBarSpace = true,
  children,
  style,
  contentContainerStyle,
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

  if (scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: bgColor }, style]} {...rest}>
        <ScrollView
          contentContainerStyle={[
            { paddingHorizontal: pad ? t.spacing.lg : 0, ...padding },
            contentContainerStyle,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: bgColor,
          paddingHorizontal: pad ? t.spacing.lg : 0,
          ...padding,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

export const screenStyles = StyleSheet.create({
  fill: { flex: 1 },
});
