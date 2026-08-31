import React from 'react';
import { View } from 'react-native';
import { useAppTheme } from '../theme/tokens';
import { Ingredient } from '../types';
import { toSections } from '../utils/ingredientSections';
import { Input } from './ui/Input';
import { IconButton } from './ui/IconButton';
import { Button } from './ui/Button';
import { Text } from './ui/Text';

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
    // Inherit the last row's sub-recipe so a new ingredient joins the section
    // on screen instead of opening an unlabelled block underneath it.
    const section = ingredients[ingredients.length - 1]?.section;
    onChange([...ingredients, { name: '', quantity: 1, unit: 'each', ...(section ? { section } : {}) }]);
  };

  // Rows stay addressed by their flat index — update/remove operate on the
  // original array, so the sections are purely a way of showing which
  // sub-recipe an imported ingredient came from.
  const rows = toSections(ingredients).flatMap((section) =>
    section.items.map((item, within) => ({
      ...item,
      sectionTitle: within === 0 ? section.title : undefined,
    })),
  );

  return (
    <View>
      {rows.map(({ ingredient: ing, index: i, sectionTitle }) => (
        <View key={`ing-${i}`}>
          {sectionTitle ? (
            <Text
              variant="caption"
              tone="tertiary"
              style={{ marginBottom: t.spacing.xs, marginTop: t.spacing.xs }}
            >
              {sectionTitle.toUpperCase()}
            </Text>
          ) : null}
          <View
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
        </View>
      ))}
      <Button label="Add ingredient" icon="plus" onPress={add} variant="tonal" size="sm" />
    </View>
  );
}
