import React from 'react';
import { View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../theme/tokens';
import { Recipe } from '../types';
import { GlassSurface } from './ui/GlassSurface';
import { Text } from './ui/Text';
import { Pill } from './ui/Pill';

interface Props {
  recipe: Recipe;
  onPress?: () => void;
  trailing?: React.ReactNode;
  subtitle?: string;
  compact?: boolean;
}

export function RecipeCard({ recipe, onPress, trailing, subtitle, compact }: Props) {
  const t = useAppTheme();
  const cal = recipe.nutritionPerServing?.calories;
  const protein = recipe.nutritionPerServing?.proteinG;
  const subtitleText = subtitle ?? `${recipe.servings} servings`;

  const initial = (recipe.title.trim().charAt(0) || '?').toUpperCase();

  return (
    <GlassSurface
      variant="content"
      onPress={onPress}
      pad={t.spacing.md}
      style={{ marginBottom: t.spacing.sm }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <View
          style={{
            width: compact ? 44 : 52,
            height: compact ? 44 : 52,
            borderRadius: t.radius.sm,
            backgroundColor: t.palette.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="title" weight="bold" style={{ color: t.palette.primarySoftText }}>
            {initial}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyLg" weight="semibold" numberOfLines={1}>
            {recipe.title}
          </Text>
          <Text variant="small" tone="secondary" style={{ marginTop: 2 }} numberOfLines={1}>
            {subtitleText}
          </Text>
          {!compact && (cal || protein) ? (
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
              {cal ? (
                <Pill size="sm" tone="neutral" icon="fire" label={`${Math.round(cal)} cal`} />
              ) : null}
              {protein ? (
                <Pill size="sm" tone="primary" label={`${Math.round(protein)}g protein`} />
              ) : null}
            </View>
          ) : null}
        </View>
        {trailing ?? (
          <Icon name="chevron-right" size={20} color={t.palette.textTertiary} />
        )}
      </View>
    </GlassSurface>
  );
}
