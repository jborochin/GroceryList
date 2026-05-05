import React, { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { usePantryStore } from '../store/usePantryStore';
import { EmptyState } from '../components/EmptyState';
import { formatEntry } from '../utils/formatters';
import { useAppTheme } from '../theme/tokens';
import { Button, IconButton, Input, Surface, Text, Header } from '../components/ui';

export function PantryScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const items = usePantryStore((s) => s.items);
  const addItem = usePantryStore((s) => s.addItem);
  const removeItem = usePantryStore((s) => s.removeItem);

  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const quantity = qty ? parseFloat(qty) : undefined;
    addItem({
      name: trimmed,
      quantity: Number.isFinite(quantity) ? (quantity as number) : undefined,
      unit: unit.trim() || undefined,
    });
    setName('');
    setQty('');
    setUnit('');
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: insets.bottom + t.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <Header
              title="Pantry"
              subtitle="Mark what you already have so it's left out of grocery lists."
            />

            <Surface variant="outlined" pad={t.spacing.lg} style={{ marginBottom: t.spacing.lg }}>
              <Text variant="title" style={{ marginBottom: t.spacing.md }}>
                Add an item
              </Text>
              <Input
                placeholder="e.g. Olive oil"
                value={name}
                onChangeText={setName}
                containerStyle={{ marginBottom: t.spacing.sm }}
              />
              <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.md }}>
                <Input
                  placeholder="Qty"
                  keyboardType="decimal-pad"
                  value={qty}
                  onChangeText={setQty}
                  containerStyle={{ flex: 1 }}
                />
                <Input
                  placeholder="Unit (optional)"
                  autoCapitalize="none"
                  value={unit}
                  onChangeText={setUnit}
                  containerStyle={{ flex: 1.4 }}
                />
              </View>
              <Button label="Add" icon="plus" onPress={handleAdd} disabled={!name.trim()} fullWidth />
              <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.sm }}>
                Items without a quantity are treated as "always have" (fully excluded).
              </Text>
            </Surface>

            {items.length > 0 ? (
              <Text
                variant="eyebrow"
                tone="tertiary"
                style={{ marginBottom: t.spacing.sm }}
              >
                In your pantry · {items.length}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Surface variant="outlined" pad={t.spacing.md} style={{ marginBottom: t.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: t.palette.surfaceMuted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="basket-outline" size={18} color={t.palette.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyLg" weight="semibold" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text variant="caption" tone="secondary" tabularNums>
                  {item.quantity && item.unit ? formatEntry(item.quantity, item.unit) : 'always have'}
                </Text>
              </View>
              <IconButton
                icon="close"
                onPress={() => removeItem(item.id)}
                variant="tonal"
                size={16}
                accessibilityLabel="Remove from pantry"
              />
            </View>
          </Surface>
        )}
        ListEmptyComponent={
          <View style={{ marginTop: t.spacing.xl }}>
            <EmptyState
              icon="fridge-outline"
              title="Pantry is empty"
              subtitle="Add what you already have so it doesn't end up on your grocery list."
            />
          </View>
        }
      />
    </View>
  );
}
