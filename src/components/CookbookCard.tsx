import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../theme/tokens';
import { DeckCard } from '../utils/mealDeck';
import { Text } from './ui/Text';

interface Props {
  card: DeckCard;
  width: number;
  height: number;
}

function prettyCuisine(cuisine?: string): string {
  if (!cuisine) return '';
  return cuisine.replace(/_/g, ' ');
}

// A single cookbook "page": parchment surface with a bound left spine, a hero
// photo, and the recipe's title + macros. Purely presentational — the swipe
// gestures, intent stamps, and tear/flip animation live in MealSwipeScreen.
export function CookbookCard({ card, width, height }: Props) {
  const t = useAppTheme();
  const imageHeight = Math.round(height * 0.56);

  const cal = card.nutrition?.calories;
  const protein = card.nutrition?.proteinG;
  const macroParts: string[] = [];
  if (cal) macroParts.push(`${Math.round(cal)} cal`);
  if (protein) macroParts.push(`${Math.round(protein)}g protein`);
  const macroLine = macroParts.join('   ·   ');

  const initial = (card.title.trim().charAt(0) || '?').toUpperCase();
  const cuisine = prettyCuisine(card.cuisine);

  return (
    <View
      style={{
        width,
        height,
        borderRadius: t.radius.lg,
        backgroundColor: t.palette.bgElevated,
        borderWidth: 1,
        borderColor: t.palette.rimLight,
        overflow: 'hidden',
        ...t.shadow.strong,
        // Page-flip pivots about the bound left edge.
        transformOrigin: 'left center',
      }}
    >
      {/* Bound spine — a darker strip down the left edge. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 8,
          backgroundColor: t.palette.surfaceSunken,
          borderRightWidth: 1,
          borderRightColor: t.palette.border,
          zIndex: 2,
        }}
      />

      {/* Hero image / fallback */}
      <View style={{ height: imageHeight, width: '100%', backgroundColor: t.palette.surfaceMuted }}>
        {card.imageUrl ? (
          <Image
            source={{ uri: card.imageUrl }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={180}
            recyclingKey={card.id}
          />
        ) : (
          <LinearGradient
            colors={[t.palette.primary, t.palette.primarySoftText]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="mega" weight="bold" style={{ color: t.palette.primaryContrast }}>
              {initial}
            </Text>
          </LinearGradient>
        )}
      </View>

      {/* Recipe body */}
      <View style={{ flex: 1, paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, paddingLeft: t.spacing.lg + 8 }}>
        {cuisine ? (
          <Text variant="eyebrow" tone="tertiary" style={{ marginBottom: 4 }}>
            {cuisine}
          </Text>
        ) : null}
        <Text variant="headline" weight="bold" numberOfLines={2}>
          {card.title}
        </Text>
        {macroLine ? (
          <Text variant="small" tone="secondary" style={{ marginTop: t.spacing.sm }}>
            {macroLine}
          </Text>
        ) : null}

        {/* Dog-ear corner accent. */}
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 0,
            height: 0,
            borderRightWidth: 22,
            borderTopWidth: 22,
            borderRightColor: t.palette.surfaceSunken,
            borderTopColor: 'transparent',
          }}
        />
      </View>
    </View>
  );
}
