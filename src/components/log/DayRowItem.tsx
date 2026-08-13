import React from 'react';
import { Pressable, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { DayRow } from '../../utils/foodLogDay';
import { useAppTheme } from '../../theme/tokens';
import { Text, Button, SwipeRow } from '../ui';

interface Props {
  row: DayRow;
  onPress: () => void;
  onDelete: () => void;
  onAteThis: () => void;
  onAteOther: () => void;
}

// One row of a day: either something logged, or a planned meal still projected.
//
// The two states are NOT distinguished by dimming alone. A projected row carries
// a hollow icon, a "~" before its calories and the word "planned" — dimming is
// the third signal, not the only one, so the day still reads correctly with low
// contrast vision or in bright sun.
function DayRowItemBase({ row, onPress, onDelete, onAteThis, onAteOther }: Props) {
  const t = useAppTheme();
  const projected = row.status === 'projected';

  const body = (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        projected
          ? `${row.title}, planned, about ${Math.round(row.nutrition.calories)} calories`
          : `${row.title}, ${Math.round(row.nutrition.calories)} calories`
      }
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.sm,
        minHeight: 48,
        paddingVertical: t.spacing.xs,
        paddingHorizontal: t.spacing.sm,
        borderRadius: t.radius.sm,
        backgroundColor: pressed ? t.palette.surfaceMuted : 'transparent',
      })}
    >
      <Icon
        name={projected ? 'circle-outline' : 'check-circle'}
        size={18}
        color={projected ? t.palette.textTertiary : t.palette.primary}
      />
      <View style={{ flex: 1 }}>
        <Text
          variant="body"
          weight="medium"
          numberOfLines={1}
          tone={projected ? 'secondary' : 'primary'}
        >
          {row.title}
        </Text>
        {row.detail ? (
          <Text variant="micro" tone="tertiary" numberOfLines={1} style={{ marginTop: 1 }}>
            {row.detail}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="body" weight="semibold" tabularNums tone={projected ? 'secondary' : 'primary'}>
          {projected ? '~' : ''}
          {Math.round(row.nutrition.calories)}
        </Text>
        <Text variant="micro" tone="tertiary">
          {projected ? 'planned' : 'kcal'}
        </Text>
      </View>
    </Pressable>
  );

  if (!projected) {
    // Swipe to delete, matching the grocery list's row affordance.
    return (
      <SwipeRow onDelete={onDelete} deleteLabel="Delete">
        {body}
      </SwipeRow>
    );
  }

  return (
    <View>
      {body}
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, paddingHorizontal: t.spacing.sm }}>
        <Button label="Ate this" icon="check" variant="tonal" size="sm" onPress={onAteThis} />
        <Button label="Ate other" icon="swap-horizontal" variant="ghost" size="sm" onPress={onAteOther} />
      </View>
    </View>
  );
}

// Memoized: a day can hold a dozen rows and every keystroke elsewhere in the
// screen would otherwise re-render all of them.
export const DayRowItem = React.memo(DayRowItemBase);
