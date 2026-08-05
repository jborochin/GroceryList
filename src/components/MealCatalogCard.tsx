import React from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../theme/tokens';
import { Meal } from '../types';
import { Text } from './ui/Text';
import { IconButton } from './ui/IconButton';

interface Props {
  meal: Meal;
  onPress?: () => void;
  isFavorited?: boolean;
  onFavorite?: () => void;
  // Whether this meal's recipe is already queued in the weekly plan — controls
  // the bottom-right affordance (add vs. queued).
  queued?: boolean;
  onQueue?: () => void;
  // Horizontal padding + column gap the parent grid applies (see RecipeGridCard).
  horizontalPadding: number;
  columnGap: number;
}

// Visual twin of RecipeGridCard, but bound to a catalog `Meal` — favorite and
// queue affordances only, no delete/edit. Kept separate so the recipe card stays
// focused on user-owned recipes (delete, edit) and types stay honest.
export function MealCatalogCard({
  meal,
  onPress,
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

  const cal = meal.nutritionPerServing?.calories;
  const protein = meal.nutritionPerServing?.proteinG;
  const macroParts: string[] = [];
  if (cal) macroParts.push(`${Math.round(cal)} cal`);
  if (protein) macroParts.push(`${Math.round(protein)}g protein`);
  const macroLine = macroParts.join('  ·  ');

  const initial = (meal.title.trim().charAt(0) || '?').toUpperCase();
  const a11yLabel = [meal.title, macroParts.join(', ')].filter(Boolean).join('. ');

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
        {meal.imageUrl ? (
          <Image
            source={{ uri: meal.imageUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={200}
            recyclingKey={meal.id}
          />
        ) : (
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
            {meal.title}
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

      {/* Heart — top-left. */}
      {onFavorite != null ? (
        <View style={{ position: 'absolute', top: t.spacing.xs, left: t.spacing.xs }}>
          <IconButton
            icon={isFavorited ? 'heart' : 'heart-outline'}
            variant="overlay"
            size={20}
            color={isFavorited ? t.palette.primary : '#FFFFFF'}
            onPress={onFavorite}
            accessibilityLabel={isFavorited ? `Unfavorite ${meal.title}` : `Favorite ${meal.title}`}
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
            accessibilityLabel={queued ? `${meal.title} is queued for this week` : `Add ${meal.title} to this week`}
          />
        </View>
      ) : null}
    </View>
  );
}
