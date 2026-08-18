import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MealSlot, NutritionPerServing } from '../../types';
import { useAppTheme } from '../../theme/tokens';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { ServingStepper } from '../ServingStepper';
import { Button, IconButton, SegmentedControl, Surface, Text } from '../ui';
import { CookFinishDefaults } from '../../utils/cookFinish';

const SLOTS: { value: MealSlot; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

interface Props {
  visible: boolean;
  title: string;
  /** Slot / servings / matched plan cell, from resolveCookFinish. */
  defaults: CookFinishDefaults;
  /** Per serving. Absent when the recipe has no nutrition — then logging is hidden. */
  nutritionPerServing?: NutritionPerServing;
  onLog: (servings: number, slot: MealSlot) => void;
  onSkip: () => void;
  onClose: () => void;
}

/**
 * The end of a cook. Offers to log what you just made, seeded from the plan
 * cell it answers — the same thing the Log tab's "Ate this" does, reached from
 * the kitchen instead of the diary.
 *
 * Logging never touches the schedule. The plan cell survives so the grocery
 * list, which is built from cells, reads exactly as it did before; the entry's
 * `fromCellId` is what stops the day double-counting. See resolveDay().
 */
export function CookFinishSheet({
  visible,
  title,
  defaults,
  nutritionPerServing,
  onLog,
  onSkip,
  onClose,
}: Props) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const [servings, setServings] = useState(defaults.servings);
  const [slot, setSlot] = useState<MealSlot>(defaults.slot);

  // The Modal stays mounted between opens, so re-seed on each open rather than
  // leaving the last session's answers behind.
  useEffect(() => {
    if (visible) {
      setServings(defaults.servings);
      setSlot(defaults.slot);
    }
  }, [visible, defaults.servings, defaults.slot]);

  const canLog = nutritionPerServing !== undefined;
  const calories = nutritionPerServing
    ? Math.round(nutritionPerServing.calories * servings)
    : 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityLabel="Dismiss"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: t.palette.scrim }]}
        />
        <View
          style={{
            backgroundColor: t.palette.bgElevated,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            paddingTop: t.spacing.sm,
            paddingBottom: insets.bottom + t.spacing.lg,
            ...t.shadow.strong,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 5,
              borderRadius: t.radius.pill,
              backgroundColor: t.palette.borderStrong,
              marginBottom: t.spacing.sm,
            }}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: t.spacing.lg,
              marginBottom: t.spacing.lg,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="eyebrow" tone="secondary">
                Finished cooking
              </Text>
              <Text variant="title" weight="semibold" numberOfLines={2}>
                {title}
              </Text>
            </View>
            <IconButton
              icon="close"
              onPress={onClose}
              variant="tonal"
              size={18}
              accessibilityLabel="Close"
            />
          </View>

          {canLog ? (
            <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.md }}>
              {defaults.cell ? (
                <Surface variant="tinted" tint="primary" pad={t.spacing.md} radius={t.radius.md}>
                  <Text variant="small" style={{ color: t.palette.primarySoftText }}>
                    This was on your plan for today — logging it confirms that meal.
                  </Text>
                </Surface>
              ) : null}

              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="caption" tone="tertiary" style={{ marginBottom: 4 }}>
                    How much did you eat?
                  </Text>
                  <Text variant="title" tabularNums>
                    {servings} {servings === 1 ? 'serving' : 'servings'} · {calories} cal
                  </Text>
                </View>
                <ServingStepper value={servings} onChange={setServings} />
              </View>

              <View>
                <Text variant="caption" tone="tertiary" style={{ marginBottom: 6 }}>
                  Meal
                </Text>
                <SegmentedControl items={SLOTS} value={slot} onChange={setSlot} />
              </View>
            </View>
          ) : (
            <View style={{ paddingHorizontal: t.spacing.lg }}>
              <Text variant="body" tone="secondary">
                This recipe has no nutrition saved, so there's nothing to log. Add it
                on the recipe to log future cooks.
              </Text>
            </View>
          )}

          <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm, marginTop: t.spacing.lg }}>
            {canLog ? (
              <Button
                label="Log it and finish"
                icon="notebook-plus-outline"
                onPress={() => onLog(servings, slot)}
                fullWidth
                size="lg"
              />
            ) : null}
            <Button
              label={canLog ? "Finish without logging" : 'Finish'}
              variant="secondary"
              onPress={onSkip}
              fullWidth
              size={canLog ? 'md' : 'lg'}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
