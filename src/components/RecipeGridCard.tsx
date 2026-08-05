import React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../theme/tokens';
import { Recipe } from '../types';
import { Text } from './ui/Text';
import { IconButton } from './ui/IconButton';

interface Props {
  recipe: Recipe;
  onPress?: () => void;
  onDelete?: () => void;
  isFavorited?: boolean;
  onFavorite?: () => void;
  // Whether this recipe is already queued in the weekly plan (any servings,
  // scheduled or not) — controls the bottom-right affordance (add vs. queued).
  queued?: boolean;
  onQueue?: () => void;
  // Horizontal padding + column gap the parent grid applies, so the card can
  // size itself to exactly half the row (keeps a lone trailing card half-width
  // instead of stretching, which `flex: 1` would do).
  horizontalPadding: number;
  columnGap: number;
}

export function RecipeGridCard({
  recipe,
  onPress,
  onDelete,
  isFavorited,
  onFavorite,
  queued,
  onQueue,
  horizontalPadding,
  columnGap,
}: Props) {
  const t = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = (screenWidth - horizontalPadding * 2 - columnGap) / 2;

  const cal = recipe.nutritionPerServing?.calories;
  const protein = recipe.nutritionPerServing?.proteinG;
  const macroParts: string[] = [];
  if (cal) macroParts.push(`${Math.round(cal)} cal`);
  if (protein) macroParts.push(`${Math.round(protein)}g protein`);
  const macroLine = macroParts.join('  ·  ');

  const initial = (recipe.title.trim().charAt(0) || '?').toUpperCase();
  const a11yLabel = [recipe.title, macroParts.join(', ')].filter(Boolean).join('. ');

  // The delete and favorite controls are sibling overlays (not children of the
  // card Pressable): nesting a button inside a button is invalid DOM on web and
  // breaks hit-testing.
  return (
    <View
      style={{
        width: cardWidth,
        aspectRatio: 0.82,
        borderRadius: t.radius.md,
        overflow: 'hidden',
        backgroundColor: t.palette.surfaceMuted,
        ...t.shadow.soft,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.92 : 1 })}
      >
        {recipe.imageUrl ? (
          <Image
            source={{ uri: recipe.imageUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={200}
            recyclingKey={recipe.id}
          />
        ) : (
          // Fallback: themed gradient tile with the recipe initial — mirrors the
          // letter avatar used by the list RecipeCard so the grid stays cohesive.
          <LinearGradient
            colors={[t.palette.primary, t.palette.primarySoftText]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="hero" weight="bold" style={{ color: t.palette.primaryContrast }}>
              {initial}
            </Text>
          </LinearGradient>
        )}

        {/* Top scrim so the bare overlay icons stay legible over bright photos. */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.28)', 'transparent']}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: '30%',
          }}
        />

        {/* Bottom scrim so the title/macros stay legible over any photo. */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.72)']}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '60%',
            justifyContent: 'flex-end',
            padding: t.spacing.md,
          }}
        >
          <Text variant="body" weight="semibold" numberOfLines={2} style={{ color: '#FFFFFF' }}>
            {recipe.title}
          </Text>
          {macroLine ? (
            <Text
              variant="caption"
              numberOfLines={1}
              style={{ color: 'rgba(255,255,255,0.92)', marginTop: 2 }}
            >
              {macroLine}
            </Text>
          ) : null}
        </LinearGradient>
      </Pressable>

      {/* Heart — top-left; delete — top-right. Shown independently. */}
      {onFavorite != null ? (
        <View style={{ position: 'absolute', top: t.spacing.xs, left: t.spacing.xs }}>
          <IconButton
            icon={isFavorited ? 'heart' : 'heart-outline'}
            variant="overlay"
            size={20}
            color={isFavorited ? t.palette.primary : '#FFFFFF'}
            onPress={onFavorite}
            accessibilityLabel={isFavorited ? `Unfavorite ${recipe.title}` : `Favorite ${recipe.title}`}
          />
        </View>
      ) : null}

      {onDelete ? (
        <View style={{ position: 'absolute', top: t.spacing.xs, right: t.spacing.xs }}>
          <IconButton
            icon="delete-outline"
            variant="overlay"
            size={20}
            onPress={onDelete}
            accessibilityLabel={`Delete ${recipe.title}`}
          />
        </View>
      ) : null}

      {onQueue != null ? (
        <View style={{ position: 'absolute', bottom: t.spacing.xs, right: t.spacing.xs }}>
          <IconButton
            icon={queued ? 'calendar-check' : 'calendar-plus'}
            variant="overlay"
            size={20}
            color={queued ? t.palette.primary : '#FFFFFF'}
            onPress={queued ? undefined : onQueue}
            haptic={!queued}
            accessibilityLabel={queued ? `${recipe.title} is queued for this week` : `Add ${recipe.title} to this week`}
          />
        </View>
      ) : null}
    </View>
  );
}
