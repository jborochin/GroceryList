import React, { useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { Image } from 'expo-image';
import { confirm } from '../utils/confirm';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryRecipeStore } from '../store/useGroceryRecipeStore';
import { useCookSessionStore } from '../store/useCookSessionStore';
import { Recipe, NutritionPerServing } from '../types';
import { IngredientEditor } from '../components/IngredientEditor';
import { ServingStepper } from '../components/ServingStepper';
import { AddToGroceryListSheet } from '../components/AddToGroceryListSheet';
import { scaleIngredients, scaleNutrition } from '../utils/recipeScaling';
import { ingredientToNutritionQuery } from '../utils/nutritionQuery';
import { computeMissingMacros } from '../utils/computeNutrition';
import { formatEntry } from '../utils/formatters';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import {
  Button,
  CollapsingHeader,
  GlassSurface,
  IconButton,
  Input,
  SectionHeader,
  Surface,
  Text,
  useToast,
} from '../components/ui';
import { useParallax } from '../components/ui/ParallaxContext';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'RecipeDetail'>;

export function RecipeDetailScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const parallax = useParallax();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { recipeId } = route.params;
  const recipe = useRecipeStore((s) => s.getById(recipeId));
  const updateRecipe = useRecipeStore((s) => s.updateRecipe);
  const deleteRecipe = useRecipeStore((s) => s.deleteRecipe);
  // Adds land on the grocery list only — never the meal plan, so the recipe
  // doesn't turn up on the Week tab. See useGroceryRecipeStore.
  const addGroceryRecipe = useGroceryRecipeStore((s) => s.addEntry);
  const removeGroceryRecipe = useGroceryRecipeStore((s) => s.removeEntry);
  // A session left open means the user walked away mid-cook; the button says so
  // rather than silently reopening a half-checked list.
  const cooking = useCookSessionStore((s) => s.sessions[recipeId] !== undefined);
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [previewServings, setPreviewServings] = useState(0);
  const [recomputing, setRecomputing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The preview is seeded from the recipe's own servings and stays independent of
  // the grocery list — adding to the list is a fire-and-forget action, so nothing
  // on this screen reflects what's already queued.
  useEffect(() => {
    if (recipe && previewServings === 0) {
      setPreviewServings(recipe.servings);
    }
  }, [recipe, previewServings]);

  if (!recipe) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.palette.bg,
        }}
      >
        <Text variant="body" tone="secondary">
          Recipe not found.
        </Text>
      </View>
    );
  }

  const active = editing && draft ? draft : recipe;
  const ratio = previewServings > 0 ? previewServings / Math.max(1, recipe.servings) : 1;
  const previewIngredients = editing ? active.ingredients : scaleIngredients(recipe.ingredients, ratio);
  const previewNutrition: NutritionPerServing | undefined = editing
    ? active.nutritionPerServing
    : scaleNutrition(recipe.nutritionPerServing, 1);

  // The add button is deliberately stateless — it never reads back from the
  // grocery list, so it always reads "Add" and never toggles. Undo lives on the
  // toast instead.
  const handleConfirmAdd = (servings: number) => {
    setSheetOpen(false);
    addGroceryRecipe(recipe.id, servings);
    toast.show({
      message: `Added ${recipe.title} (${servings} servings) to your grocery list`,
      tone: 'success',
      action: { label: 'Undo', onPress: () => removeGroceryRecipe(recipe.id) },
    });
  };

  const handleSave = () => {
    if (!draft) return;
    updateRecipe(recipe.id, {
      title: draft.title,
      servings: draft.servings,
      ingredients: draft.ingredients,
      instructions: draft.instructions,
      nutritionPerServing: draft.nutritionPerServing,
    });
    setEditing(false);
    setDraft(null);
    setPreviewServings(draft.servings);
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete recipe?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteRecipe(recipe.id);
    navigation.goBack();
  };

  const startEdit = () => {
    setDraft(JSON.parse(JSON.stringify(recipe)));
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditing(false);
  };

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
      if (parallax) parallax.value = e.contentOffset.y;
    },
  });

  const handleRecompute = async () => {
    const queries = recipe.ingredients.map(ingredientToNutritionQuery).filter(Boolean);
    if (queries.length === 0) {
      Alert.alert('No ingredients', 'Add ingredients before estimating nutrition.');
      return;
    }
    setRecomputing(true);
    try {
      const computed = await computeMissingMacros(queries, recipe.servings, [
        'calories',
        'proteinG',
        'carbsG',
        'fatG',
      ]);
      if (!computed) {
        Alert.alert(
          "Couldn't estimate",
          'Nutrition lookup is unavailable right now. Try again later.',
        );
        return;
      }
      const base: NutritionPerServing = recipe.nutritionPerServing ?? {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
      };
      updateRecipe(recipe.id, { nutritionPerServing: { ...base, ...computed } });
    } finally {
      setRecomputing(false);
    }
  };

  const setNutritionField = (key: keyof NutritionPerServing, value: string) => {
    if (!draft) return;
    const num = parseFloat(value) || 0;
    setDraft({
      ...draft,
      nutritionPerServing: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        ...(draft.nutritionPerServing ?? {}),
        [key]: num,
      },
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + t.spacing.sm,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: insets.bottom + t.spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.md, gap: t.spacing.sm }}>
        <IconButton
          icon="chevron-left"
          onPress={() => navigation.goBack()}
          variant="tonal"
          size={20}
          accessibilityLabel="Back"
        />
        <View style={{ flex: 1 }} />
        {!editing ? (
          <Button
            label={cooking ? 'Resume' : 'Cook'}
            icon="chef-hat"
            size="sm"
            variant="primary"
            onPress={() =>
              navigation.navigate('CookMode', { recipeId, servings: previewServings })
            }
          />
        ) : null}
        {!editing ? (
          <Button
            label="Add"
            icon="cart-plus"
            size="sm"
            variant="secondary"
            onPress={() => setSheetOpen(true)}
          />
        ) : null}
        {!editing ? (
          <IconButton
            icon="delete-outline"
            onPress={handleDelete}
            variant="danger"
            size={18}
            accessibilityLabel="Delete recipe"
          />
        ) : null}
      </View>

      {!editing && recipe.imageUrl ? (
        <Image
          source={{ uri: recipe.imageUrl }}
          style={{
            width: '100%',
            height: 200,
            borderRadius: t.radius.lg,
            marginBottom: t.spacing.md,
            backgroundColor: t.palette.surfaceMuted,
          }}
          contentFit="cover"
          transition={200}
          accessibilityLabel={`Photo of ${recipe.title}`}
        />
      ) : null}

      {editing && draft ? (
        <Input
          label="Title"
          value={draft.title}
          onChangeText={(text) => setDraft({ ...draft, title: text })}
          containerStyle={{ marginBottom: t.spacing.md }}
        />
      ) : (
        <GlassSurface variant="hero" pad={t.spacing.lg} radius={t.radius.lg}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: t.palette.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="display" weight="bold" style={{ color: t.palette.primarySoftText }}>
                {recipe.title.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="hero" numberOfLines={2}>
                {recipe.title}
              </Text>
              {recipe.sourceUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Icon name="link-variant" size={14} color={t.palette.textTertiary} />
                  <Text
                    variant="caption"
                    tone="accent"
                    onPress={() => openSourceUrl(recipe.sourceUrl!)}
                    style={{ textDecorationLine: 'underline' }}
                  >
                    {formatSourceHost(recipe.sourceUrl)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </GlassSurface>
      )}

      <Surface variant="outlined" pad={t.spacing.lg} style={{ marginTop: t.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="tertiary" style={{ marginBottom: 4 }}>
              {editing ? 'Recipe servings' : 'Preview at'}
            </Text>
            <Text variant="title">
              {editing && draft ? draft.servings : previewServings} servings
            </Text>
          </View>
          {editing && draft ? (
            <ServingStepper
              value={draft.servings}
              onChange={(v) => setDraft({ ...draft, servings: v })}
            />
          ) : (
            <ServingStepper value={previewServings} onChange={setPreviewServings} />
          )}
        </View>
      </Surface>

      <SectionHeader title="Ingredients" count={previewIngredients.length} />
      <Surface variant="outlined" pad={editing ? t.spacing.md : t.spacing.lg}>
        {editing && draft ? (
          <IngredientEditor
            ingredients={draft.ingredients}
            onChange={(next) => setDraft({ ...draft, ingredients: next })}
          />
        ) : (
          previewIngredients.map((i, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 10,
                gap: t.spacing.md,
                borderBottomWidth: idx === previewIngredients.length - 1 ? 0 : 1,
                borderBottomColor: t.palette.border,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: t.palette.primary,
                }}
              />
              <Text variant="body" style={{ flex: 1 }}>
                {i.name}
              </Text>
              <Text variant="small" tone="secondary" tabularNums>
                {formatEntry(i.quantity, i.unit)}
              </Text>
            </View>
          ))
        )}
      </Surface>

      <SectionHeader title="Instructions" />
      <Surface variant="outlined" pad={t.spacing.lg}>
        {editing && draft ? (
          <Input
            placeholder="One step per line"
            value={(draft.instructions ?? []).join('\n')}
            onChangeText={(text) =>
              setDraft({
                ...draft,
                instructions: text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
              })
            }
            multiline
          />
        ) : active.instructions && active.instructions.length > 0 ? (
          active.instructions.map((step, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                paddingVertical: 8,
                gap: t.spacing.md,
                alignItems: 'flex-start',
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: t.palette.primarySoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: 1,
                }}
              >
                <Text
                  variant="caption"
                  weight="bold"
                  style={{ color: t.palette.primarySoftText }}
                  tabularNums
                >
                  {idx + 1}
                </Text>
              </View>
              <Text variant="body" style={{ flex: 1, lineHeight: 22 }}>
                {step}
              </Text>
            </View>
          ))
        ) : (
          <Text variant="body" tone="tertiary">
            No steps saved.
          </Text>
        )}
      </Surface>

      <SectionHeader title="Nutrition" trailing={<Text variant="caption" tone="tertiary">per serving</Text>} />
      <Surface variant="outlined" pad={t.spacing.lg}>
        {editing && draft ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <Input
              label="Calories"
              keyboardType="numeric"
              value={String(draft.nutritionPerServing?.calories ?? '')}
              onChangeText={(v) => setNutritionField('calories', v)}
              containerStyle={{ width: '48%' }}
            />
            <Input
              label="Protein (g)"
              keyboardType="numeric"
              value={String(draft.nutritionPerServing?.proteinG ?? '')}
              onChangeText={(v) => setNutritionField('proteinG', v)}
              containerStyle={{ width: '48%' }}
            />
            <Input
              label="Carbs (g)"
              keyboardType="numeric"
              value={String(draft.nutritionPerServing?.carbsG ?? '')}
              onChangeText={(v) => setNutritionField('carbsG', v)}
              containerStyle={{ width: '48%' }}
            />
            <Input
              label="Fat (g)"
              keyboardType="numeric"
              value={String(draft.nutritionPerServing?.fatG ?? '')}
              onChangeText={(v) => setNutritionField('fatG', v)}
              containerStyle={{ width: '48%' }}
            />
          </View>
        ) : previewNutrition ? (
          <>
            <View style={{ flexDirection: 'row' }}>
              <NutritionStat label="Calories" value={`${Math.round(previewNutrition.calories)}`} />
              <NutritionStat label="Protein" value={`${Math.round(previewNutrition.proteinG)}g`} />
              <NutritionStat label="Carbs" value={`${Math.round(previewNutrition.carbsG)}g`} />
              <NutritionStat label="Fat" value={`${Math.round(previewNutrition.fatG)}g`} />
            </View>
            <Button
              label={recomputing ? 'Estimating…' : 'Recompute from ingredients'}
              icon="calculator-variant-outline"
              variant="secondary"
              onPress={handleRecompute}
              disabled={recomputing}
              fullWidth
              style={{ marginTop: t.spacing.md }}
            />
          </>
        ) : (
          <View>
            <Text variant="body" tone="tertiary">
              Not set
            </Text>
            <Button
              label={recomputing ? 'Estimating…' : 'Estimate from ingredients'}
              icon="calculator-variant-outline"
              variant="secondary"
              onPress={handleRecompute}
              disabled={recomputing}
              fullWidth
              style={{ marginTop: t.spacing.md }}
            />
          </View>
        )}
      </Surface>

      <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginTop: t.spacing.xl }}>
        {editing ? (
          <>
            <Button label="Save changes" icon="check" onPress={handleSave} fullWidth style={{ flex: 1 }} />
            <Button label="Cancel" variant="secondary" onPress={cancelEdit} fullWidth style={{ flex: 1 }} />
          </>
        ) : (
          <Button label="Edit recipe" icon="pencil" onPress={startEdit} fullWidth style={{ flex: 1 }} variant="primary" />
        )}
      </View>
      </Animated.ScrollView>
      <CollapsingHeader title={recipe.title} scrollY={scrollY} threshold={64} />
      <AddToGroceryListSheet
        visible={sheetOpen}
        title={recipe.title}
        initialServings={previewServings}
        onConfirm={handleConfirmAdd}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

async function openSourceUrl(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert("Can't open link", url);
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert("Can't open link", url);
  }
}

function formatSourceHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function NutritionStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text variant="title" tabularNums>
        {value}
      </Text>
      <Text variant="caption" tone="tertiary" style={{ marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}
