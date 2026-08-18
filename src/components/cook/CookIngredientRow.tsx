import React from 'react';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { Text } from '../ui';
import { haptics } from '../../utils/haptics';

interface Props {
  name: string;
  /** Formatted quantity, e.g. '1.5 lb'. */
  amount: string;
  checked: boolean;
  onToggle: () => void;
  isLast: boolean;
}

/** One "already in the pot" row. The whole row is the hit target — wet hands. */
export function CookIngredientRow({ name, amount, checked, onToggle, isLast }: Props) {
  const t = useAppTheme();

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${name}, ${amount}`}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          gap: t.spacing.md,
          borderBottomWidth: isLast ? 0 : 1,
          borderBottomColor: t.palette.border,
        },
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Checkbox checked={checked} />
      <Text
        variant="body"
        style={{
          flex: 1,
          opacity: checked ? 0.45 : 1,
          textDecorationLine: checked ? 'line-through' : 'none',
        }}
      >
        {name}
      </Text>
      <Text
        variant="small"
        tone="secondary"
        tabularNums
        style={{ opacity: checked ? 0.45 : 1 }}
      >
        {amount}
      </Text>
    </Pressable>
  );
}

export function Checkbox({ checked, size = 24 }: { checked: boolean; size?: number }) {
  const t = useAppTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: t.radius.xs,
        borderWidth: checked ? 0 : 2,
        borderColor: t.palette.borderStrong,
        backgroundColor: checked ? t.palette.primary : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? (
        <Icon name="check" size={size - 8} color={t.palette.primaryContrast} />
      ) : null}
    </View>
  );
}
