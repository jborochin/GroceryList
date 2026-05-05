import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';
import { haptics } from '../../utils/haptics';

interface Item<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

interface Props<T extends string> {
  items: Item<T>[];
  value: T;
  onChange: (v: T) => void;
  style?: ViewStyle;
}

export function SegmentedControl<T extends string>({ items, value, onChange, style }: Props<T>) {
  const t = useAppTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: t.palette.surfaceMuted,
          padding: 4,
          borderRadius: t.radius.pill,
          gap: 2,
        },
        style,
      ]}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            onPress={() => {
              if (!active) {
                haptics.selection();
                onChange(item.value);
              }
            }}
            style={{
              flex: 1,
              paddingVertical: 9,
              paddingHorizontal: 12,
              borderRadius: t.radius.pill,
              backgroundColor: active ? t.palette.surface : 'transparent',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              ...(active ? t.shadow.soft : null),
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            {item.icon ? (
              <Icon
                name={item.icon}
                size={15}
                color={active ? t.palette.textPrimary : t.palette.textSecondary}
              />
            ) : null}
            <Text
              variant="small"
              weight={active ? 'semibold' : 'medium'}
              tone={active ? 'primary' : 'secondary'}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
