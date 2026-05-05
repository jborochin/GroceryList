import React from 'react';
import { View } from 'react-native';
import { useAppTheme } from '../theme/tokens';
import { Ingredient } from '../types';
import { Input } from './ui/Input';
import { IconButton } from './ui/IconButton';
import { Button } from './ui/Button';

interface Props {
  ingredients: Ingredient[];
  onChange: (next: Ingredient[]) => void;
}

export function IngredientEditor({ ingredients, onChange }: Props) {
  const t = useAppTheme();

  const update = (i: number, patch: Partial<Ingredient>) => {
    const copy = ingredients.slice();
    copy[i] = { ...copy[i], ...patch };
    onChange(copy);
  };

  const remove = (i: number) => {
    onChange(ingredients.filter((_, idx) => idx !== i));
  };

  const add = () => {
    onChange([...ingredients, { name: '', quantity: 1, unit: 'each' }]);
  };

  return (
    <View>
      {ingredients.map((ing, i) => (
        <View
          key={`ing-${i}`}
          style={{
            backgroundColor: t.palette.surface,
            borderColor: t.palette.border,
            borderWidth: 1,
            borderRadius: t.radius.sm,
            padding: t.spacing.md,
            marginBottom: t.spacing.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}>
            <Input
              placeholder="Ingredient name"
              value={ing.name}
              onChangeText={(text) => update(i, { name: text })}
              containerStyle={{ flex: 1 }}
            />
            <IconButton icon="close" onPress={() => remove(i)} variant="tonal" size={18} />
          </View>
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginTop: t.spacing.sm }}>
            <Input
              placeholder="Qty"
              keyboardType="decimal-pad"
              value={String(ing.quantity ?? '')}
              onChangeText={(text) => update(i, { quantity: parseFloat(text) || 0 })}
              containerStyle={{ flex: 1 }}
            />
            <Input
              placeholder="unit (cup, g, each…)"
              autoCapitalize="none"
              value={ing.unit}
              onChangeText={(text) => update(i, { unit: text.trim() || 'each' })}
              containerStyle={{ flex: 1.5 }}
            />
          </View>
        </View>
      ))}
      <Button label="Add ingredient" icon="plus" onPress={add} variant="tonal" size="sm" />
    </View>
  );
}
