import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useRecipeStore } from '../store/useRecipeStore';
import {
  parseRecipeFromUrl,
  RecipeParseError,
  RecipeParseErrorKind,
  ParsedRecipe,
  sanitizeImageUrl,
} from '../utils/recipeUrlParser';
import { IngredientEditor } from '../components/IngredientEditor';
import { ServingStepper } from '../components/ServingStepper';
import { Ingredient, NutritionPerServing } from '../types';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import {
  AmbientBackground,
  Button,
  GlassSurface,
  IconButton,
  Input,
  SectionHeader,
  SegmentedControl,
  Surface,
  Text,
  useToast,
} from '../components/ui';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { haptics } from '../utils/haptics';

type ImportErrorKind = RecipeParseErrorKind | 'unknown';

type ImportErrorCopy = {
  title: string;
  body: string;
  primaryAction: 'manual' | 'retry';
  primaryLabel: string;
};

function buildImportErrorCopy(kind: ImportErrorKind, rawMessage: string): ImportErrorCopy {
  switch (kind) {
    case 'cors':
      return {
        title: 'Your browser blocked this site.',
        body:
          "Most recipe sites don't allow importing from a browser (CORS). Open the app on Android or iOS to import, or paste the recipe manually.",
        primaryAction: 'manual',
        primaryLabel: 'Switch to Manual',
      };
    case 'not-found':
      return {
        title: 'No recipe found on that page.',
        body:
          "The page didn't include a recipe schema (JSON-LD). Try the site's main recipe page, not a category or listing.",
        primaryAction: 'manual',
        primaryLabel: 'Switch to Manual',
      };
    case 'malformed':
      return {
        title: "That page's recipe data is corrupted.",
        body:
          "The site's recipe schema has invalid JSON. This is a site bug; you'll need to enter it manually.",
        primaryAction: 'manual',
        primaryLabel: 'Switch to Manual',
      };
    case 'network':
      return {
        title: "Couldn't reach that page.",
        body: `${rawMessage}. Check the URL or your connection, then retry.`,
        primaryAction: 'retry',
        primaryLabel: 'Retry',
      };
    default:
      return {
        title: 'Import failed.',
        body: 'Something unexpected went wrong. Try again or enter manually.',
        primaryAction: 'manual',
        primaryLabel: 'Switch to Manual',
      };
  }
}

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'AddRecipe'>;

type Mode = 'url' | 'manual';

export function AddRecipeScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const addRecipe = useRecipeStore((s) => s.addRecipe);

  const [mode, setMode] = useState<Mode>(route.params?.prefilledUrl ? 'url' : 'manual');
  const [url, setUrl] = useState(route.params?.prefilledUrl ?? '');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<{ kind: ImportErrorKind; message: string } | null>(null);

  // Pulse the URL input border while parsing; shake on error.
  const pulse = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (importing && !reduceMotion) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 220 });
    }
  }, [importing, reduceMotion, pulse]);

  useEffect(() => {
    if (importError && !reduceMotion) {
      shake.value = 0;
      shake.value = withSequence(
        withTiming(-8, { duration: 60 }),
        withTiming(8, { duration: 60 }),
        withTiming(-4, { duration: 60 }),
        withTiming(4, { duration: 60 }),
        withTiming(0, { duration: 60 })
      );
      haptics.warn();
    }
  }, [importError, reduceMotion, shake]);

  const urlBoxStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
    // Pulse: tighten the visible glow via opacity-driven shadow halo.
    opacity: 1 - pulse.value * 0.08,
  }));

  const [title, setTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [servings, setServings] = useState(4);
  const [ingredients, setIngredients] = useState<Ingredient[]>([{ name: '', quantity: 1, unit: 'each' }]);
  const [instructionsText, setInstructionsText] = useState('');
  const [nutrition, setNutrition] = useState<NutritionPerServing | undefined>(undefined);
  const [estimatedFields, setEstimatedFields] = useState<Set<keyof NutritionPerServing>>(new Set());

  const applyParsed = (parsed: ParsedRecipe) => {
    setTitle(parsed.title);
    setImageUrl(parsed.imageUrl ?? '');
    setSourceUrl(parsed.sourceUrl);
    setServings(parsed.servings);
    setIngredients(
      parsed.ingredients.length ? parsed.ingredients : [{ name: '', quantity: 1, unit: 'each' }]
    );
    setInstructionsText((parsed.instructions ?? []).join('\n'));
    setNutrition(parsed.nutritionPerServing);
    setEstimatedFields(new Set(parsed.estimatedMacros ?? []));
  };

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setImporting(true);
    setImportError(null);
    try {
      const parsed = await parseRecipeFromUrl(trimmed);
      applyParsed(parsed);
      setMode('manual');
      haptics.success();
      toast.show({ message: `Imported "${parsed.title}"`, tone: 'success' });
    } catch (err) {
      if (err instanceof RecipeParseError) {
        setImportError({ kind: err.kind, message: err.message });
      } else {
        setImportError({
          kind: 'unknown',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setImporting(false);
    }
  };

  const onUrlChange = (v: string) => {
    setUrl(v);
    if (importError) setImportError(null);
  };

  const handleSave = () => {
    if (!title.trim()) {
      Alert.alert('Title required');
      return;
    }
    const cleaned = ingredients.filter((i) => i.name.trim());
    if (cleaned.length === 0) {
      Alert.alert('At least one ingredient required');
      return;
    }
    const steps = instructionsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    addRecipe({
      title: title.trim(),
      sourceUrl,
      servings: Math.max(1, servings),
      ingredients: cleaned,
      instructions: steps.length > 0 ? steps : undefined,
      nutritionPerServing: nutrition,
      imageUrl: sanitizeImageUrl(imageUrl.trim()),
    });
    navigation.goBack();
  };

  const setNutritionField = (key: keyof NutritionPerServing, v: string) => {
    const num = parseFloat(v) || 0;
    setNutrition({
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      ...(nutrition ?? {}),
      [key]: num,
    });
    if (estimatedFields.has(key)) {
      const next = new Set(estimatedFields);
      next.delete(key);
      setEstimatedFields(next);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + t.spacing.sm,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: insets.bottom + t.spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: t.spacing.md }}>
        <IconButton
          icon="chevron-left"
          onPress={() => navigation.goBack()}
          variant="tonal"
          size={20}
          accessibilityLabel="Back"
        />
      </View>

      <Text variant="hero" style={{ marginBottom: t.spacing.lg }}>
        Add a recipe
      </Text>

      <SegmentedControl
        items={[
          { value: 'url', label: 'Paste URL', icon: 'link-variant' },
          { value: 'manual', label: 'Manual', icon: 'pencil-outline' },
        ]}
        value={mode}
        onChange={(v) => setMode(v)}
        style={{ marginBottom: t.spacing.lg }}
      />

      {mode === 'url' ? (
        <Animated.View style={urlBoxStyle}>
          <GlassSurface variant="hero" pad={t.spacing.lg}>
            <Input
              label="Recipe URL"
              value={url}
              onChangeText={onUrlChange}
              placeholder="https://..."
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              leftIcon="link-variant"
              containerStyle={{ marginBottom: t.spacing.md }}
            />
            <Button
              label={importing ? 'Importing…' : 'Import recipe'}
              icon="download"
              onPress={handleImport}
              disabled={importing || !url.trim()}
              loading={importing}
              fullWidth
            />

          {importing ? (
            <View style={{ marginTop: t.spacing.md, alignItems: 'center' }}>
              <ActivityIndicator color={t.palette.primary} />
              <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.sm }}>
                Fetching and parsing…
              </Text>
            </View>
          ) : null}

          {importError ? (
            <Surface
              variant="flat"
              pad={t.spacing.md}
              tint="danger"
              style={{ marginTop: t.spacing.md }}
            >
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Icon
                  name="alert-circle-outline"
                  size={18}
                  color={t.palette.dangerSoftText}
                  style={{ marginTop: 1 }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    variant="body"
                    weight="semibold"
                    style={{ color: t.palette.dangerSoftText, marginBottom: 4 }}
                  >
                    {buildImportErrorCopy(importError.kind, importError.message).title}
                  </Text>
                  <Text variant="caption" style={{ color: t.palette.dangerSoftText }}>
                    {buildImportErrorCopy(importError.kind, importError.message).body}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'flex-end',
                      gap: t.spacing.sm,
                      marginTop: t.spacing.md,
                    }}
                  >
                    <Button
                      label="Dismiss"
                      variant="ghost"
                      size="sm"
                      onPress={() => setImportError(null)}
                    />
                    <Button
                      label={buildImportErrorCopy(importError.kind, importError.message).primaryLabel}
                      variant="primary"
                      size="sm"
                      onPress={() => {
                        const copy = buildImportErrorCopy(importError.kind, importError.message);
                        if (copy.primaryAction === 'manual') {
                          setImportError(null);
                          setMode('manual');
                        } else {
                          handleImport();
                        }
                      }}
                    />
                  </View>
                </View>
              </View>
            </Surface>
          ) : (
            <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.md }}>
              {Platform.OS === 'web'
                ? "Heads up: some recipe sites block browser imports. If this fails, try the app on a device or switch to Manual."
                : "We read the page's embedded recipe schema (JSON-LD). If the page doesn't have one, switch to Manual."}
            </Text>
          )}
          </GlassSurface>
        </Animated.View>
      ) : (
        <View>
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="What are you making?"
            containerStyle={{ marginBottom: t.spacing.md }}
          />

          <Input
            label="Image URL (optional)"
            value={imageUrl}
            onChangeText={setImageUrl}
            placeholder="https://…/photo.jpg"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            containerStyle={{ marginBottom: t.spacing.md }}
          />

          <Surface variant="outlined" pad={t.spacing.md}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text variant="body" weight="medium" style={{ flex: 1 }}>
                Servings
              </Text>
              <ServingStepper value={servings} onChange={setServings} />
            </View>
          </Surface>

          <SectionHeader title="Ingredients" />
          <IngredientEditor ingredients={ingredients} onChange={setIngredients} />

          <SectionHeader title="Instructions" trailing={<Text variant="caption" tone="tertiary">optional</Text>} />
          <Input
            placeholder="One step per line"
            value={instructionsText}
            onChangeText={setInstructionsText}
            multiline
          />

          <SectionHeader title="Nutrition" trailing={<Text variant="caption" tone="tertiary">per serving · optional</Text>} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            <View style={{ width: '48%' }}>
              <Input
                label="Calories"
                keyboardType="numeric"
                value={String(nutrition?.calories ?? '')}
                onChangeText={(v) => setNutritionField('calories', v)}
              />
              {estimatedFields.has('calories') ? (
                <Text variant="caption" tone="tertiary" style={{ marginTop: 4 }}>estimated</Text>
              ) : null}
            </View>
            <View style={{ width: '48%' }}>
              <Input
                label="Protein (g)"
                keyboardType="numeric"
                value={String(nutrition?.proteinG ?? '')}
                onChangeText={(v) => setNutritionField('proteinG', v)}
              />
              {estimatedFields.has('proteinG') ? (
                <Text variant="caption" tone="tertiary" style={{ marginTop: 4 }}>estimated</Text>
              ) : null}
            </View>
            <View style={{ width: '48%' }}>
              <Input
                label="Carbs (g)"
                keyboardType="numeric"
                value={String(nutrition?.carbsG ?? '')}
                onChangeText={(v) => setNutritionField('carbsG', v)}
              />
              {estimatedFields.has('carbsG') ? (
                <Text variant="caption" tone="tertiary" style={{ marginTop: 4 }}>estimated</Text>
              ) : null}
            </View>
            <View style={{ width: '48%' }}>
              <Input
                label="Fat (g)"
                keyboardType="numeric"
                value={String(nutrition?.fatG ?? '')}
                onChangeText={(v) => setNutritionField('fatG', v)}
              />
              {estimatedFields.has('fatG') ? (
                <Text variant="caption" tone="tertiary" style={{ marginTop: 4 }}>estimated</Text>
              ) : null}
            </View>
          </View>

          <Button
            label="Save recipe"
            icon="check"
            onPress={handleSave}
            fullWidth
            size="lg"
            style={{ marginTop: t.spacing.xl }}
          />
        </View>
      )}
      </ScrollView>
    </View>
  );
}
