import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/tokens';
import { Text } from './ui/Text';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { GlassSurface } from './ui/GlassSurface';
import { GroceryItem } from '../types';
import { haptics } from '../utils/haptics';
import { useReducedMotion } from '../hooks/useReducedMotion';

interface Props {
  item: GroceryItem | null;
  initialPrice: string;
  initialUnit: string;
  onSave: (price: number, unit: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const DRAG_DISMISS_DISTANCE = 80;
const DRAG_DISMISS_VELOCITY = 800;

export function PriceOverrideSheet({
  item,
  initialPrice,
  initialUnit,
  onSave,
  onClear,
  onClose,
}: Props) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [price, setPrice] = useState(initialPrice);
  const [unit, setUnit] = useState(initialUnit);

  // Track sheet vertical drag offset (only positive = downward).
  const dragY = useSharedValue(0);
  const entered = useSharedValue(0); // 0 → 1 enter

  useEffect(() => {
    setPrice(initialPrice);
    setUnit(initialUnit);
  }, [initialPrice, initialUnit, item]);

  const visible = !!item;

  useEffect(() => {
    if (visible) {
      dragY.value = 0;
      entered.value = reduceMotion
        ? withTiming(1, { duration: t.duration.fast })
        : withSpring(1, { damping: 22, stiffness: 220, mass: 0.9 });
    } else {
      entered.value = 0;
    }
  }, [visible, reduceMotion, dragY, entered, t.duration.fast]);

  const handleSave = () => {
    const p = parseFloat(price);
    if (!isFinite(p) || p < 0) {
      onClose();
      return;
    }
    haptics.success();
    onSave(p, unit.trim() || 'each');
  };

  const dismiss = () => {
    onClose();
  };

  const panGesture = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > DRAG_DISMISS_DISTANCE || e.velocityY > DRAG_DISMISS_VELOCITY) {
        dragY.value = withTiming(600, { duration: 200, easing: Easing.out(Easing.quad) });
        runOnJS(dismiss)();
      } else {
        dragY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dragY.value + (1 - entered.value) * 24 },
    ],
    opacity: entered.value,
  }));

  return (
    <Modal
      visible={visible}
      transparent
      onRequestClose={onClose}
      animationType="none"
      statusBarTranslucent
    >
      {visible && (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(180)}
            style={[StyleSheet.absoluteFill, { backgroundColor: t.palette.scrim }]}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          </Animated.View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.kav}
            pointerEvents="box-none"
          >
            <Animated.View
              style={[
                styles.sheetWrap,
                {
                  paddingBottom: insets.bottom + 16,
                  paddingHorizontal: t.spacing.md,
                },
                sheetStyle,
              ]}
            >
              <GestureDetector gesture={panGesture}>
                <Animated.View>
                  <GlassSurface
                    variant="chrome"
                    radius={t.radius.xl}
                    shadow="strong"
                    rim
                  >
                    <View style={styles.handleWrap}>
                      <View
                        style={{
                          width: 40,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: t.palette.borderStrong,
                          opacity: 0.6,
                        }}
                      />
                    </View>
                    <View
                      style={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.xl }}
                    >
                      <Text variant="eyebrow" tone="tertiary" style={{ marginBottom: 6 }}>
                        Price override
                      </Text>
                      <Text variant="display" numberOfLines={2}>
                        {item?.displayName ?? ''}
                      </Text>
                      <Text
                        variant="small"
                        tone="secondary"
                        style={{ marginTop: 6, marginBottom: t.spacing.xl }}
                      >
                        Set a price-per-unit. Applies to this ingredient across all future
                        lists.
                      </Text>

                      <View
                        style={{
                          flexDirection: 'row',
                          gap: t.spacing.sm,
                          marginBottom: t.spacing.xl,
                        }}
                      >
                        <Input
                          label="Price ($)"
                          value={price}
                          onChangeText={setPrice}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          containerStyle={{ flex: 1.2 }}
                        />
                        <Input
                          label="Per unit"
                          value={unit}
                          onChangeText={setUnit}
                          autoCapitalize="none"
                          placeholder="each"
                          containerStyle={{ flex: 1 }}
                        />
                      </View>

                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: t.spacing.sm,
                        }}
                      >
                        <Button
                          label="Clear"
                          variant="ghost"
                          onPress={() => {
                            haptics.warn();
                            onClear();
                          }}
                        />
                        <View style={{ flex: 1 }} />
                        <Button label="Cancel" variant="secondary" onPress={onClose} />
                        <Button label="Save" variant="primary" onPress={handleSave} />
                      </View>
                    </View>
                  </GlassSurface>
                </Animated.View>
              </GestureDetector>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheetWrap: {},
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
});
