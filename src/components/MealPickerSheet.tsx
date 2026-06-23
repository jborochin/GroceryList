import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Meal, Recipe } from '../types';
import { useAppTheme } from '../theme/tokens';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Text, Button, IconButton, SegmentedControl } from './ui';

type Source = 'recipes' | 'catalog';

interface Props {
  visible: boolean;
  /** Header line describing where the chosen meal lands, e.g. "Mon · Dinner". */
  destinationLabel: string;
  recipes: Recipe[];
  catalog: Meal[];
  onSelectRecipe: (recipeId: string, defaultServings: number) => void;
  onSelectMeal: (meal: Meal) => void;
  onClose: () => void;
  onAddRecipe: () => void;
}

export function MealPickerSheet({
  visible,
  destinationLabel,
  recipes,
  catalog,
  onSelectRecipe,
  onSelectMeal,
  onClose,
  onAddRecipe,
}: Props) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [source, setSource] = useState<Source>(recipes.length > 0 ? 'recipes' : 'catalog');

  const thumb = (uri: string | undefined, icon: string) =>
    uri ? (
      <Image
        source={{ uri }}
        style={{ width: 40, height: 40, borderRadius: t.radius.sm, backgroundColor: t.palette.surfaceMuted }}
      />
    ) : (
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: t.radius.sm,
          backgroundColor: t.palette.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={t.palette.primarySoftText} />
      </View>
    );

  const row = (
    key: string,
    image: string | undefined,
    title: string,
    subtitle: string,
    onPress: () => void,
    accessibilityLabel: string
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingVertical: t.spacing.sm,
        paddingHorizontal: t.spacing.md,
        borderRadius: t.radius.md,
        backgroundColor: pressed ? t.palette.surfaceMuted : 'transparent',
      })}
    >
      {thumb(image, 'silverware-fork-knife')}
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="medium" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" tone="secondary" style={{ marginTop: 2 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Icon name="plus-circle" size={22} color={t.palette.primary} />
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityLabel="Dismiss"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: t.palette.scrim }]}
        />
        <View
          style={{
            backgroundColor: t.palette.bgElevated,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            paddingTop: t.spacing.sm,
            paddingBottom: insets.bottom + t.spacing.lg,
            maxHeight: '85%',
            ...t.shadow.strong,
          }}
        >
          {/* Grabber */}
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 5,
              borderRadius: t.radius.pill,
              backgroundColor: t.palette.borderStrong,
              marginBottom: t.spacing.sm,
            }}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: t.spacing.lg,
              marginBottom: t.spacing.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="eyebrow" tone="secondary">
                Add a meal
              </Text>
              <Text variant="title" weight="semibold" numberOfLines={1}>
                {destinationLabel}
              </Text>
            </View>
            <IconButton icon="close" onPress={onClose} variant="tonal" size={18} accessibilityLabel="Close" />
          </View>

          <View style={{ paddingHorizontal: t.spacing.lg, marginBottom: t.spacing.sm }}>
            <SegmentedControl<Source>
              value={source}
              onChange={setSource}
              items={[
                { value: 'recipes', label: 'My recipes', icon: 'book-open-variant' },
                { value: 'catalog', label: 'Browse catalog', icon: 'silverware-variant' },
              ]}
            />
          </View>

          {source === 'recipes' && recipes.length === 0 ? (
            <View style={{ paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.xl, gap: t.spacing.md }}>
              <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
                You haven't added any recipes yet. Browse the catalog or add your own.
              </Text>
              <Button label="Browse catalog" icon="silverware-variant" onPress={() => setSource('catalog')} fullWidth />
              <Button label="Add a recipe" icon="plus" variant="tonal" onPress={onAddRecipe} fullWidth />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.sm, gap: t.spacing.xs }}
              showsVerticalScrollIndicator={false}
            >
              {source === 'recipes'
                ? recipes.map((recipe) =>
                    row(
                      recipe.id,
                      recipe.imageUrl,
                      recipe.title,
                      `${recipe.servings} servings${
                        recipe.nutritionPerServing
                          ? ` · ${Math.round(recipe.nutritionPerServing.calories)} cal`
                          : ''
                      }`,
                      () => onSelectRecipe(recipe.id, recipe.servings),
                      `Add ${recipe.title}`
                    )
                  )
                : catalog.map((meal) =>
                    row(
                      meal.id,
                      meal.imageUrl,
                      meal.title,
                      `${Math.round(meal.nutritionPerServing.calories)} cal · ${Math.round(
                        meal.nutritionPerServing.proteinG
                      )}g protein`,
                      () => onSelectMeal(meal),
                      `Add ${meal.title} from catalog`
                    )
                  )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
