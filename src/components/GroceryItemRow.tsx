import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme, tokens } from '../theme/tokens';
import { Text } from './ui/Text';
import { GroceryItem } from '../types';
import { formatEntry, formatPrice } from '../utils/formatters';

interface Props {
  item: GroceryItem;
  index: number;
  checked: boolean;
  onToggle: () => void;
  onEditPrice: () => void;
}

export function GroceryItemRow({ item, index, checked, onToggle, onEditPrice }: Props) {
  const t = useAppTheme();
  const progress = useSharedValue(checked ? 1 : 0);
  const [labelWidth, setLabelWidth] = useState(0);

  useEffect(() => {
    progress.value = withSpring(checked ? 1 : 0, tokens.spring);
  }, [checked, progress]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0.55]),
  }));

  const lineStyle = useAnimatedStyle(() => ({
    width: progress.value * labelWidth,
  }));

  const checkboxStyle = useAnimatedStyle(() => ({
    backgroundColor: progress.value > 0.5 ? t.palette.primary : 'transparent',
    borderColor: progress.value > 0.5 ? t.palette.primary : t.palette.borderStrong,
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 1.04]) }],
  }));

  const checkIconStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.6, 1]) }],
  }));

  const onLabelLayout = (e: LayoutChangeEvent) => {
    setLabelWidth(e.nativeEvent.layout.width);
  };

  const qtyStr = item.entries.map((e) => formatEntry(e.quantity, e.unit)).join(' + ');
  const priceMissing = item.hasPriceGap && item.estimatedPrice === undefined;

  return (
    <Animated.View
      entering={FadeInDown.duration(380)
        .delay(Math.min(index, 12) * 24)
        .springify()
        .damping(20)}
      style={{ marginBottom: 8 }}
    >
      <Pressable onPress={onToggle}>
        <Animated.View
          style={[
            wrapStyle,
            {
              backgroundColor: t.palette.surface,
              borderColor: t.palette.border,
              borderWidth: StyleSheet.hairlineWidth,
              borderRadius: t.radius.md,
            },
          ]}
        >
          <View style={styles.row}>
            <Animated.View style={[styles.checkbox, checkboxStyle]}>
              <Animated.View style={checkIconStyle}>
                <Icon name="check" size={14} color={t.palette.primaryContrast} />
              </Animated.View>
            </Animated.View>

            <View style={styles.middle}>
              <View style={styles.labelRow}>
                <Text
                  onLayout={onLabelLayout}
                  variant="bodyLg"
                  weight="semibold"
                  numberOfLines={1}
                >
                  {item.displayName}
                </Text>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.strike,
                    { backgroundColor: t.palette.textPrimary },
                    lineStyle,
                  ]}
                />
              </View>
              <Text variant="caption" tone="secondary" tabularNums numberOfLines={1} style={{ marginTop: 2 }}>
                {qtyStr}
              </Text>
            </View>

            <Pressable onPress={onEditPrice} hitSlop={8}>
              <View
                style={{
                  backgroundColor: priceMissing ? t.palette.dangerSoft : t.palette.surfaceMuted,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: t.radius.pill,
                  minWidth: 64,
                  alignItems: 'center',
                }}
              >
                <Text
                  variant="small"
                  weight="semibold"
                  tabularNums
                  style={{ color: priceMissing ? t.palette.dangerSoftText : t.palette.textPrimary }}
                >
                  {formatPrice(item.estimatedPrice)}
                </Text>
              </View>
            </Pressable>
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 12,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    alignSelf: 'flex-start',
  },
  strike: {
    position: 'absolute',
    left: 0,
    top: '50%',
    height: 1.5,
    marginTop: -0.75,
    opacity: 0.85,
  },
});
