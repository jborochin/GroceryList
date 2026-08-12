import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { parseRecipeFromCaption } from '../utils/instagramCaptionParser';
import { importInstagramRecipe, InstagramImportError } from '../utils/instagramImport';
import { parseSharedUrl } from '../utils/instagramUrl';
import { estimateMissingMacros } from '../utils/recipeMacros';
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
type ImportSource = 'url' | 'caption' | 'instagram';

type ImportErrorCopy = {
  title: string;
  body: string;
  primaryAction: 'manual' | 'retry';
  primaryLabel: string;
};

function buildImportErrorCopy(
  kind: ImportErrorKind,
  rawMessage: string,
  source: ImportSource = 'url',
): ImportErrorCopy {
  // A link import that got far enough to read the caption hands the text back, so
  // the useful next step is "tidy what we found", not "start over".
  if (source === 'instagram') {
    switch (kind) {
      case 'not-found':
        return {
          title: "Couldn't find a recipe in that post.",
          body:
            'We read the caption but found no ingredients list — plenty of reels keep the recipe in the video or a link in bio. The caption is below, so you can tidy it up, or switch to Manual.',
          primaryAction: 'manual',
          primaryLabel: 'Enter manually',
        };
      case 'malformed':
        return {
          title: "Couldn't read the ingredients.",
          body:
            "We found an ingredients section but couldn't make sense of the lines. Edit the caption below and import again, or enter it manually.",
          primaryAction: 'manual',
          primaryLabel: 'Enter manually',
        };
      case 'cors':
        return {
          title: 'Instagram imports need the app.',
          body:
            "A browser can't read instagram.com directly. Open MealFlow on your phone and share the reel to it, or paste the caption below.",
          primaryAction: 'manual',
          primaryLabel: 'Switch to Manual',
        };
      case 'network':
        return {
          title: "Couldn't reach that post.",
          body: `${rawMessage}. It may be private, deleted, or age-restricted — check your connection and retry.`,
          primaryAction: 'retry',
          primaryLabel: 'Retry',
        };
      default:
        return {
          title: 'Import failed.',
          body: 'Something unexpected went wrong reading that post. Try again, or paste the caption below.',
          primaryAction: 'manual',
          primaryLabel: 'Switch to Manual',
        };
    }
  }
  if (source === 'caption') {
    switch (kind) {
      case 'not-found':
        return {
          title: "Couldn't find a recipe in that caption.",
          body:
            "We couldn't spot an ingredients list. Make sure you copied the full caption (including the ingredients), or switch to Manual.",
          primaryAction: 'manual',
          primaryLabel: 'Switch to Manual',
        };
      case 'malformed':
        return {
          title: "Couldn't read the ingredients.",
          body:
            "We found an ingredients section but couldn't make sense of the lines. Tidy it up here, or enter it manually.",
          primaryAction: 'manual',
          primaryLabel: 'Switch to Manual',
        };
      default:
        return {
          title: 'Import failed.',
          body: 'Something unexpected went wrong reading that caption. Try again or enter manually.',
          primaryAction: 'manual',
          primaryLabel: 'Switch to Manual',
        };
    }
  }
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

type Mode = 'url' | 'manual' | 'instagram';

export function AddRecipeScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const addRecipe = useRecipeStore((s) => s.addRecipe);

  // A URL handed over by the OS share sheet. Classified here rather than by the
  // router so parseSharedUrl stays the single source of truth for what a link is.
  const sharedUrl = route.params?.sharedUrl;
  const sharedTarget = useMemo(() => (sharedUrl ? parseSharedUrl(sharedUrl) : null), [sharedUrl]);

  const [mode, setMode] = useState<Mode>(() => {
    if (sharedTarget?.kind === 'instagram') return 'instagram';
    if (sharedTarget?.kind === 'web') return 'url';
    return route.params?.prefilledUrl ? 'url' : 'manual';
  });
  const [url, setUrl] = useState(
    sharedTarget?.kind === 'web' ? sharedTarget.url : route.params?.prefilledUrl ?? '',
  );
  const [postUrl, setPostUrl] = useState(
    sharedTarget?.kind === 'instagram' ? sharedTarget.url : '',
  );
  const [caption, setCaption] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<{
    kind: ImportErrorKind;
    message: string;
    source: ImportSource;
  } | null>(null);

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

  // Bumped by anything that establishes new macro state, so a background estimate
  // that resolves late can tell whether it is still the current one.
  const importSeq = useRef(0);

  const applyParsed = (parsed: ParsedRecipe) => {
    importSeq.current += 1;
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

  const runUrlImport = useCallback(
    async (target: string) => {
      const trimmed = target.trim();
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
          setImportError({ kind: err.kind, message: err.message, source: 'url' });
        } else {
          setImportError({
            kind: 'unknown',
            message: err instanceof Error ? err.message : String(err),
            source: 'url',
          });
        }
      } finally {
        setImporting(false);
      }
    },
    // applyParsed and toast are stable enough for this screen's lifetime; the
    // import is driven by explicit user action, never by a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleImport = () => {
    void runUrlImport(url);
  };

  // Fetches the post and reads its caption. When the caption came back but held no
  // recipe, InstagramImportError carries it — drop it into the paste box so the
  // user can fix a line or two instead of retyping everything.
  const runInstagramImport = useCallback(
    async (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) return;
      setImporting(true);
      setImportError(null);
      try {
        const parsed = await importInstagramRecipe(trimmed);
        applyParsed(parsed);
        setMode('manual');
        haptics.success();
        toast.show({ message: `Imported "${parsed.title}"`, tone: 'success' });
      } catch (err) {
        if (err instanceof InstagramImportError && err.recoveredCaption) {
          setCaption(err.recoveredCaption);
        }
        if (err instanceof RecipeParseError) {
          setImportError({ kind: err.kind, message: err.message, source: 'instagram' });
        } else {
          setImportError({
            kind: 'unknown',
            message: err instanceof Error ? err.message : String(err),
            source: 'instagram',
          });
        }
      } finally {
        setImporting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleImportPost = () => {
    void runInstagramImport(postUrl);
  };

  // Arriving from the share sheet should feel like the work is already done, so
  // import immediately rather than waiting for a button press. Guarded by a ref so
  // a re-render can't fire a second request for the same share.
  const autoImported = useRef(false);
  useEffect(() => {
    if (!sharedTarget || autoImported.current) return;
    autoImported.current = true;
    if (sharedTarget.kind === 'instagram') {
      void runInstagramImport(sharedTarget.url);
    } else if (sharedTarget.kind === 'web') {
      void runUrlImport(sharedTarget.url);
    }
  }, [sharedTarget, runInstagramImport, runUrlImport]);

  // Caption parsing is pure + synchronous — no network, so no importing spinner.
  // When the caption states no macros we still estimate them, but in the
  // background: the form is usable immediately and the numbers land a second or
  // two later rather than holding a 0ms interaction open on a network call.
  const handleImportCaption = () => {
    const trimmed = caption.trim();
    if (!trimmed) return;
    setImportError(null);
    try {
      const parsed = parseRecipeFromCaption(trimmed);
      applyParsed(parsed);
      setMode('manual');
      haptics.success();
      toast.show({ message: `Imported "${parsed.title}"`, tone: 'success' });
      if (parsed.missingMacros?.length) {
        const seq = ++importSeq.current;
        void estimateMissingMacros(parsed, parsed.missingMacros).then((enriched) => {
          // A newer import — or a value the user has already typed over — must win.
          if (seq !== importSeq.current) return;
          if (!enriched.estimatedMacros?.length) return;
          setNutrition(enriched.nutritionPerServing);
          setEstimatedFields(new Set(enriched.estimatedMacros));
        });
      }
    } catch (err) {
      if (err instanceof RecipeParseError) {
        setImportError({ kind: err.kind, message: err.message, source: 'caption' });
      } else {
        setImportError({
          kind: 'unknown',
          message: err instanceof Error ? err.message : String(err),
          source: 'caption',
        });
      }
    }
  };

  const onUrlChange = (v: string) => {
    setUrl(v);
    if (importError) setImportError(null);
  };

  const onCaptionChange = (v: string) => {
    setCaption(v);
    if (importError) setImportError(null);
  };

  const onPostUrlChange = (v: string) => {
    setPostUrl(v);
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
    // Typed macros outrank a background estimate still in flight.
    importSeq.current += 1;
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

  // Shared by the URL and Instagram import branches — same error card, copy
  // varies by the error's source (see buildImportErrorCopy).
  const renderImportError = () => {
    if (!importError) return null;
    const copy = buildImportErrorCopy(importError.kind, importError.message, importError.source);
    return (
      <Surface variant="flat" pad={t.spacing.md} tint="danger" style={{ marginTop: t.spacing.md }}>
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
              {copy.title}
            </Text>
            <Text variant="caption" style={{ color: t.palette.dangerSoftText }}>
              {copy.body}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: t.spacing.sm,
                marginTop: t.spacing.md,
              }}
            >
              <Button label="Dismiss" variant="ghost" size="sm" onPress={() => setImportError(null)} />
              <Button
                label={copy.primaryLabel}
                variant="primary"
                size="sm"
                onPress={() => {
                  if (copy.primaryAction === 'manual') {
                    setImportError(null);
                    setMode('manual');
                  } else if (importError.source === 'instagram') {
                    handleImportPost();
                  } else {
                    handleImport();
                  }
                }}
              />
            </View>
          </View>
        </View>
      </Surface>
    );
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
          { value: 'url', label: 'URL', icon: 'link-variant' },
          { value: 'instagram', label: 'Instagram', icon: 'instagram' },
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
            renderImportError()
          ) : (
            <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.md }}>
              {Platform.OS === 'web'
                ? "Heads up: some recipe sites block browser imports. If this fails, try the app on a device or switch to Manual."
                : "We read the page's embedded recipe schema (JSON-LD). If the page doesn't have one, switch to Manual."}
            </Text>
          )}
          </GlassSurface>
        </Animated.View>
      ) : mode === 'instagram' ? (
        <Animated.View style={urlBoxStyle}>
          <GlassSurface variant="hero" pad={t.spacing.lg}>
            <Input
              label="Reel or post link"
              value={postUrl}
              onChangeText={onPostUrlChange}
              placeholder="https://www.instagram.com/reel/…"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              leftIcon="instagram"
              containerStyle={{ marginBottom: t.spacing.md }}
            />
            <Button
              label={importing ? 'Reading caption…' : 'Import from link'}
              icon="download"
              onPress={handleImportPost}
              disabled={importing || !postUrl.trim()}
              loading={importing}
              fullWidth
            />

            {importing ? (
              <View style={{ marginTop: t.spacing.md, alignItems: 'center' }}>
                <ActivityIndicator color={t.palette.primary} />
                <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.sm }}>
                  Fetching the caption…
                </Text>
              </View>
            ) : null}

            {importError ? (
              renderImportError()
            ) : (
              <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.md }}>
                In Instagram, tap Share on a recipe reel and pick MealFlow — or paste the link here.
                We read the post&apos;s caption and pull out the title, ingredients, and steps.
              </Text>
            )}
          </GlassSurface>

          {/* Not every caption holds a recipe — some keep it in the video or a link
              in bio. When the link import recovers text but can't parse it, it
              lands here already filled in, so a fix is a couple of edits away. */}
          <SectionHeader
            title="Or paste the caption"
            trailing={<Text variant="caption" tone="tertiary">fallback</Text>}
          />
          <Surface variant="outlined" pad={t.spacing.md}>
            <Input
              label="Instagram caption"
              value={caption}
              onChangeText={onCaptionChange}
              placeholder={'Paste the full caption from a reel or post…\n\nIncludes the title, ingredients, and steps.'}
              multiline
              inputStyle={{ minHeight: 140, textAlignVertical: 'top' }}
              containerStyle={{ marginBottom: t.spacing.md }}
            />
            <Button
              label="Import from caption"
              icon="text-box-check-outline"
              variant="secondary"
              onPress={handleImportCaption}
              disabled={!caption.trim()}
              fullWidth
            />
          </Surface>
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
