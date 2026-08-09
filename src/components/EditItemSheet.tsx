import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../theme/tokens';
import { Text } from './ui/Text';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { GlassSurface } from './ui/GlassSurface';
import { GroceryItem } from '../types';
import { haptics } from '../utils/haptics';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { CATEGORY_ORDER, CATEGORY_ICON } from '../utils/groceryCategories';

interface Props {
  item: GroceryItem | null;
  initialDisplayName: string;
  initialQuantity: string;
  initialUnit: string;
  initialCategory: string;
  onSave: (displayName: string, quantity: number, unit: string, category: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const DRAG_DISMISS_DISTANCE = 80;
const DRAG_DISMISS_VELOCITY = 800;

export function EditItemSheet({
  item,
  initialDisplayName,
  initialQuantity,
  initialUnit,
  initialCategory,
  onSave,
  onClear,
  onClose,
}: Props) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [name, setName] = useState(initialDisplayName);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [unit, setUnit] = useState(initialUnit);
  const [category, setCategory] = useState(initialCategory);

  const dragY = useSharedValue(0);
  const entered = useSharedValue(0);

  useEffect(() => {
    setName(initialDisplayName);
    setQuantity(initialQuantity);
    setUnit(initialUnit);
    setCategory(initialCategory);
  }, [initialDisplayName, initialQuantity, initialUnit, initialCategory, item]);

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
    const trimmedName = name.trim();
    const q = parseFloat(quantity);
    if (!trimmedName || !isFinite(q) || q <= 0) {
      onClose();
      return;
    }
    haptics.success();
    onSave(trimmedName, q, unit.trim() || 'each', category);
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
    transform: [{ translateY: dragY.value + (1 - entered.value) * 24 }],
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
                  <GlassSurface variant="chrome" radius={t.radius.xl} shadow="strong" rim>
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
                    <View style={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.xl }}>
                      <Text variant="eyebrow" tone="tertiary" style={{ marginBottom: 6 }}>
                        Edit item
                      </Text>
                      <Text variant="display" numberOfLines={2}>
                        {item?.displayName ?? ''}
                      </Text>
                      <Text
                        variant="small"
                        tone="secondary"
                        style={{ marginTop: 6, marginBottom: t.spacing.xl }}
                      >
                        Update the name, quantity, unit, or category for this item.
                      </Text>

                      <Input
                        label="Name"
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="words"
                        containerStyle={{ marginBottom: t.spacing.md }}
                      />

                      <View
                        style={{
                          flexDirection: 'row',
                          gap: t.spacing.sm,
                          marginBottom: t.spacing.md,
                        }}
                      >
                        <Input
                          label="Qty"
                          value={quantity}
                          onChangeText={setQuantity}
                          keyboardType="decimal-pad"
                          placeholder="1"
                          containerStyle={{ flex: 1 }}
                        />
                        <Input
                          label="Unit"
                          value={unit}
                          onChangeText={setUnit}
                          autoCapitalize="none"
                          placeholder="each"
                          containerStyle={{ flex: 1.4 }}
                        />
                      </View>

                      <Text variant="caption" weight="medium" tone="secondary" style={{ marginBottom: 8 }}>
                        Category
                      </Text>
                      <ScrollView
                        style={{ maxHeight: 140, marginBottom: t.spacing.xl }}
                        showsVerticalScrollIndicator={false}
                      >
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {CATEGORY_ORDER.map((cat) => {
                            const selected = cat === category;
                            return (
                              <Pressable
                                key={cat}
                                onPress={() => {
                                  haptics.selection();
                                  setCategory(cat);
                                }}
                                hitSlop={4}
                              >
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 6,
                                    backgroundColor: selected
                                      ? t.palette.primarySoft
                                      : t.palette.surfaceMuted,
                                    paddingHorizontal: 12,
                                    paddingVertical: 8,
                                    borderRadius: t.radius.pill,
                                  }}
                                >
                                  <Icon
                                    name={CATEGORY_ICON[cat] ?? 'tag-outline'}
                                    size={14}
                                    color={selected ? t.palette.primarySoftText : t.palette.textPrimary}
                                  />
                                  <Text
                                    variant="small"
                                    weight="semibold"
                                    style={{
                                      color: selected ? t.palette.primarySoftText : t.palette.textPrimary,
                                    }}
                                  >
                                    {cat}
                                  </Text>
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      </ScrollView>

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
