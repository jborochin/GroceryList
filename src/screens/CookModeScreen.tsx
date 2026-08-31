import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MealSlot } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useCookSessionStore } from '../store/useCookSessionStore';
import { useMealScheduleStore } from '../store/useMealScheduleStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useCookTimers } from '../hooks/useCookTimers';
import { scaleIngredients } from '../utils/recipeScaling';
import { toSections } from '../utils/ingredientSections';
import { scaleNutrition } from '../utils/foodLogDay';
import { sessionProgress } from '../utils/cookSession';
import { parseStepDurations } from '../utils/stepTimers';
import { resolveCookFinish } from '../utils/cookFinish';
import { todayKey } from '../utils/planningWeek';
import { formatEntry } from '../utils/formatters';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import { ServingStepper } from '../components/ServingStepper';
import { Button, IconButton, ProgressBar, SectionHeader, Surface, Text, useToast } from '../components/ui';
import { CookIngredientRow } from '../components/cook/CookIngredientRow';
import { CookStepRow } from '../components/cook/CookStepRow';
import { TimerBar } from '../components/cook/TimerBar';
import { CookFinishSheet } from '../components/cook/CookFinishSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'CookMode'>;

// Cook mode: the recipe as a working surface rather than a document.
//
// Everything the user touches here is session state (see useCookSessionStore),
// which persists — walking away mid-cook, backgrounding the app, even killing
// it, all leave the checks and the running timers intact. Closing this screen
// is therefore safe and needs no confirmation; only "Finish" ends the session.
export function CookModeScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const toast = useToast();
  const { recipeId, servings: requestedServings } = route.params;

  // A cook is a screen you stare at with your hands full — never let it sleep.
  useKeepAwake();

  const recipe = useRecipeStore((s) => s.getById(recipeId));
  const session = useCookSessionStore((s) => s.sessions[recipeId]);
  const ensure = useCookSessionStore((s) => s.ensure);
  const toggleIngredient = useCookSessionStore((s) => s.toggleIngredient);
  const toggleStep = useCookSessionStore((s) => s.toggleStep);
  const setServings = useCookSessionStore((s) => s.setServings);
  const endSession = useCookSessionStore((s) => s.end);

  const cells = useMealScheduleStore((s) => s.cells);
  const logEntries = useFoodLogStore((s) => s.entries);
  const addLogEntry = useFoodLogStore((s) => s.addEntry);

  const timerControls = useCookTimers(recipeId, recipe?.title ?? '');
  const [finishOpen, setFinishOpen] = useState(false);

  const steps = useMemo(() => recipe?.instructions ?? [], [recipe]);

  // Open the session, or bring a resumed one back in line with a recipe that
  // was edited since — see reconcileSession.
  useEffect(() => {
    if (!recipe) return;
    ensure({
      recipeId,
      title: recipe.title,
      servings: requestedServings ?? recipe.servings,
      ingredientCount: recipe.ingredients.length,
      stepCount: steps.length,
    });
  }, [recipe, recipeId, requestedServings, steps.length, ensure]);

  const servings = session?.servings ?? requestedServings ?? recipe?.servings ?? 1;

  const ingredients = useMemo(() => {
    if (!recipe) return [];
    return scaleIngredients(recipe.ingredients, servings / Math.max(1, recipe.servings));
  }, [recipe, servings]);

  // Parsed once per recipe: the instruction text doesn't change while cooking.
  const stepDurations = useMemo(() => steps.map(parseStepDurations), [steps]);

  const finishDefaults = useMemo(
    () => resolveCookFinish({ date: todayKey(), recipeId, cells, entries: logEntries }),
    [recipeId, cells, logEntries]
  );

  if (!recipe || !session) {
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

  const progress = sessionProgress(session);
  const usedCount = session.checkedIngredients.length;

  const closeSession = () => {
    timerControls.cancelAll();
    endSession(recipeId);
    navigation.goBack();
  };

  const handleLog = (eaten: number, slot: MealSlot) => {
    if (recipe.nutritionPerServing) {
      addLogEntry({
        date: todayKey(),
        slot,
        displayName: recipe.title,
        source: 'recipe',
        sourceId: recipe.id,
        servingQty: eaten,
        servingLabel: eaten === 1 ? 'serving' : 'servings',
        nutrition: scaleNutrition(recipe.nutritionPerServing, eaten),
        // Confirms the plan cell without removing it — the ingredients were
        // already bought, so the grocery list must not move. See resolveDay().
        fromCellId: finishDefaults.cell?.id,
      });
    }
    setFinishOpen(false);
    closeSession();
    toast.show({ message: `Logged ${recipe.title}`, tone: 'success' });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <View
        style={{
          paddingTop: insets.top + t.spacing.sm,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: t.spacing.md,
          backgroundColor: t.palette.bgElevated,
          borderBottomWidth: 1,
          borderBottomColor: t.palette.border,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <IconButton
            icon="close"
            onPress={() => navigation.goBack()}
            variant="tonal"
            size={20}
            accessibilityLabel="Close cook mode, keeping your progress"
          />
          <View style={{ flex: 1 }}>
            <Text variant="title" weight="semibold" numberOfLines={1}>
              {recipe.title}
            </Text>
            <Text variant="caption" tone="tertiary" tabularNums>
              {progress.total > 0
                ? `${progress.checked} of ${progress.total} steps`
                : 'No steps saved'}
            </Text>
          </View>
        </View>
        {progress.total > 0 ? (
          <ProgressBar progress={progress.ratio} height={5} />
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: t.spacing.lg,
          paddingTop: t.spacing.md,
          // Leave room for the sticky timer bar; it floats over this list.
          paddingBottom:
            insets.bottom + t.spacing.xxl + (timerControls.timers.length > 0 ? 92 : 0),
        }}
        showsVerticalScrollIndicator={false}
      >
        <Surface variant="outlined" pad={t.spacing.lg}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="tertiary" style={{ marginBottom: 4 }}>
                Cooking
              </Text>
              <Text variant="title">
                {servings} {servings === 1 ? 'serving' : 'servings'}
              </Text>
            </View>
            <ServingStepper
              value={servings}
              onChange={(v) => setServings(recipeId, v)}
            />
          </View>
        </Surface>

        <SectionHeader
          title="Ingredients"
          trailing={
            <Text variant="caption" tone="tertiary" tabularNums>
              {usedCount} of {ingredients.length} used
            </Text>
          }
        />
        <Surface variant="outlined" pad={t.spacing.lg}>
          {ingredients.length > 0 ? (
            // Grouped by sub-recipe so you can gather one component at a time.
            // Checks stay keyed by the FLAT index (`idx`), which is what the
            // session stores — never the position within a section.
            toSections(ingredients).map((section, sectionIdx) => (
              <View key={section.title ?? `unsectioned-${sectionIdx}`}>
                {section.title ? (
                  <Text
                    variant="caption"
                    tone="tertiary"
                    style={{
                      marginTop: sectionIdx === 0 ? 0 : t.spacing.md,
                      marginBottom: t.spacing.xs,
                      letterSpacing: 0.6,
                    }}
                  >
                    {section.title.toUpperCase()}
                  </Text>
                ) : null}
                {section.items.map(({ ingredient, index: idx }) => (
                  <CookIngredientRow
                    key={`${ingredient.name}-${idx}`}
                    name={ingredient.name}
                    amount={formatEntry(ingredient.quantity, ingredient.unit)}
                    checked={session.checkedIngredients.includes(idx)}
                    onToggle={() => toggleIngredient(recipeId, idx)}
                    isLast={idx === ingredients.length - 1}
                  />
                ))}
              </View>
            ))
          ) : (
            <Text variant="body" tone="tertiary">
              No ingredients saved.
            </Text>
          )}
        </Surface>

        <SectionHeader title="Steps" />
        <Surface variant="outlined" pad={t.spacing.lg}>
          {steps.length > 0 ? (
            steps.map((step, idx) => (
              <CookStepRow
                key={idx}
                index={idx}
                text={step}
                checked={session.checkedSteps.includes(idx)}
                onToggle={() => toggleStep(recipeId, idx)}
                durations={stepDurations[idx]}
                timers={timerControls.timers.filter((timer) => timer.stepIndex === idx)}
                now={timerControls.now}
                onStartTimer={(duration) =>
                  timerControls.start(`Step ${idx + 1}`, duration.seconds, idx)
                }
                isLast={idx === steps.length - 1}
              />
            ))
          ) : (
            <Text variant="body" tone="tertiary">
              This recipe has no steps saved — the ingredient list above still works
              as a checklist.
            </Text>
          )}
        </Surface>

        <Button
          label="Finish cooking"
          icon="check-circle-outline"
          onPress={() => setFinishOpen(true)}
          fullWidth
          size="lg"
          style={{ marginTop: t.spacing.xl }}
        />
        <Text
          variant="caption"
          tone="tertiary"
          style={{ textAlign: 'center', marginTop: t.spacing.sm }}
        >
          Closing this screen keeps your progress.
        </Text>
      </ScrollView>

      <TimerBar
        timers={timerControls.timers}
        now={timerControls.now}
        onPause={timerControls.pause}
        onResume={timerControls.resume}
        onDismiss={timerControls.dismiss}
      />

      <CookFinishSheet
        visible={finishOpen}
        title={recipe.title}
        defaults={finishDefaults}
        nutritionPerServing={recipe.nutritionPerServing}
        onLog={handleLog}
        onSkip={() => {
          setFinishOpen(false);
          closeSession();
        }}
        onClose={() => setFinishOpen(false)}
      />
    </View>
  );
}
