import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/tokens';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { ServingStepper } from './ServingStepper';
import { Button, IconButton, Text } from './ui';

interface Props {
  visible: boolean;
  /** Recipe or meal title, echoed back so the sheet confirms what's being added. */
  title: string;
  /** Seeded from the caller's inline preview stepper — the sheet confirms, it doesn't re-ask. */
  initialServings: number;
  onConfirm: (servings: number) => void;
  onClose: () => void;
}

export function AddToGroceryListSheet({
  visible,
  title,
  initialServings,
  onConfirm,
  onClose,
}: Props) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [servings, setServings] = useState(initialServings);

  // The Modal stays mounted between opens, so re-seed on each open rather than
  // leaving the last session's count behind.
  useEffect(() => {
    if (visible) setServings(initialServings);
  }, [visible, initialServings]);

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
          {/* Grabber */}
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
              justifyContent: 'space-between',
              paddingHorizontal: t.spacing.lg,
              marginBottom: t.spacing.lg,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="eyebrow" tone="secondary">
                Add to grocery list
              </Text>
              <Text variant="title" weight="semibold" numberOfLines={2}>
                {title}
              </Text>
            </View>
            <IconButton icon="close" onPress={onClose} variant="tonal" size={18} accessibilityLabel="Close" />
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: t.spacing.lg,
              marginBottom: t.spacing.lg,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="tertiary" style={{ marginBottom: 4 }}>
                Servings
              </Text>
              <Text variant="title">{servings} servings</Text>
            </View>
            <ServingStepper value={servings} onChange={setServings} />
          </View>

          <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}>
            <Button
              label="Add to list"
              icon="cart-plus"
              onPress={() => onConfirm(servings)}
              fullWidth
              size="lg"
            />
            <Button label="Cancel" variant="secondary" onPress={onClose} fullWidth />
          </View>
        </View>
      </View>
    </Modal>
  );
}
