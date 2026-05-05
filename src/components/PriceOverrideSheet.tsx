import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/tokens';
import { Text } from './ui/Text';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { GroceryItem } from '../types';
import { haptics } from '../utils/haptics';

interface Props {
  item: GroceryItem | null;
  initialPrice: string;
  initialUnit: string;
  onSave: (price: number, unit: string) => void;
  onClear: () => void;
  onClose: () => void;
}

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
  const [price, setPrice] = useState(initialPrice);
  const [unit, setUnit] = useState(initialUnit);

  useEffect(() => {
    setPrice(initialPrice);
    setUnit(initialUnit);
  }, [initialPrice, initialUnit, item]);

  const visible = !!item;

  const handleSave = () => {
    const p = parseFloat(price);
    if (!isFinite(p) || p < 0) {
      onClose();
      return;
    }
    haptics.success();
    onSave(p, unit.trim() || 'each');
  };

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
              entering={SlideInDown.springify().damping(22).stiffness(220)}
              exiting={SlideOutDown.duration(220)}
              style={[
                styles.sheetWrap,
                {
                  paddingBottom: insets.bottom + 16,
                  paddingHorizontal: t.spacing.md,
                },
              ]}
            >
              <View
                style={{
                  backgroundColor: t.palette.surface,
                  borderRadius: t.radius.xl,
                  borderColor: t.palette.border,
                  borderWidth: StyleSheet.hairlineWidth,
                  overflow: 'hidden',
                  ...t.shadow.strong,
                }}
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
                <View style={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.xl }}>
                  <Text variant="eyebrow" tone="tertiary" style={{ marginBottom: 6 }}>
                    Price override
                  </Text>
                  <Text variant="display" numberOfLines={2}>
                    {item?.displayName ?? ''}
                  </Text>
                  <Text variant="small" tone="secondary" style={{ marginTop: 6, marginBottom: t.spacing.xl }}>
                    Set a price-per-unit. Applies to this ingredient across all future lists.
                  </Text>

                  <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.xl }}>
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

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
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
              </View>
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
