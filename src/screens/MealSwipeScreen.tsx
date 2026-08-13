import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RootStackParamList } from '../navigation/types';
import { MealSlot } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useMealScheduleStore } from '../store/useMealScheduleStore';
import { useMealDispositionStore } from '../store/useMealDispositionStore';
import { buildMealDeck, DeckCard } from '../utils/mealDeck';
import { arrangeAndCommitChosen } from '../utils/commitMealPlan';
import { SlotConfig } from '../utils/mealPlanner';
import {
  getMealCatalog,
  loadMealCatalogCache,
  refreshMealCatalogCache,
} from '../lib/mealCatalogSync';
import { confirm } from '../utils/confirm';
import { haptics } from '../utils/haptics';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useAppTheme } from '../theme/tokens';
import { CookbookCard } from '../components/CookbookCard';
import { TornEdge } from '../components/TornEdge';
import { CompletionBurst } from '../components/animations/CompletionBurst';
import { AmbientBackground, Button, CountUpText, Header, IconButton, Text, useToast } from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Direction = 'up' | 'right' | 'left';

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const DEFAULT_SLOT_COUNTS: Record<MealSlot, number> = {
  breakfast: 1,
  lunch: 1,
  dinner: 1,
  snack: 0,
};

const X_THRESHOLD = 110;
const UP_THRESHOLD = 130;

export function MealSwipeScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'MealSwipe'>>();
  const reduceMotion = useReducedMotion();

  const settings = useSettingsStore((s) => s.settings);
  const recipes = useRecipeStore((s) => s.recipes);
  const planEntries = useMealPlanStore((s) => s.entries);

  const { width: screenW, height: screenH } = useWindowDimensions();
  const cardW = Math.min(screenW - t.spacing.xl * 2, 420);
  const cardH = Math.min(Math.round(cardW / 0.66), screenH - insets.top - insets.bottom - 280);

  const days = route.params?.days ?? 7;
  const slotCounts = route.params?.slotCounts ?? DEFAULT_SLOT_COUNTS;
  const slots: SlotConfig[] = SLOT_ORDER.map((slot) => ({ slot, mealsPerDay: slotCounts[slot] })).filter(
    (s) => s.mealsPerDay > 0
  );

  const targets = {
    dailyCalories: settings.dailyCalorieTarget,
    macroGrams: settings.macroGrams,
  };
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  // Freeze the deck for the session so swiping doesn't reshuffle the order
  // underneath the user as dispositions change. Rebuilt only on "bring back".
  const [deck, setDeck] = useState<DeckCard[]>(() =>
    buildMealDeck(
      getMealCatalog(),
      useRecipeStore.getState().recipes,
      useMealDispositionStore.getState().dispositions,
      targets
    )
  );
  const deckRef = useRef(deck);
  deckRef.current = deck;

  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const [chosen, setChosen] = useState<DeckCard[]>([]);
  const [sparkle, setSparkle] = useState(0);
  const [tearing, setTearing] = useState(false);

  useEffect(() => {
    void loadMealCatalogCache().then(refreshMealCatalogCache);
  }, []);

  // Shared values driving the top card. Reset to 0 when a new card takes over.
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const flip = useSharedValue(0); // 0..1 → page-flip rotateY (swipe right)
  const lift = useSharedValue(0); // 0..1 → curl-up scale (swipe up)
  const fade = useSharedValue(0); // 0..1 → opacity out
  const locked = useSharedValue(0); // 1 while an exit animation is in flight
  const ribbonScale = useSharedValue(1);

  const onKeepEffects = useCallback(() => {
    haptics.success();
    setSparkle((s) => s + 1);
    ribbonScale.value = withSequence(
      withTiming(1.25, { duration: 120 }),
      withTiming(1, { duration: 200 })
    );
  }, [ribbonScale]);

  const onTearEffects = useCallback(() => {
    haptics.warn();
    setTearing(true);
  }, []);

  // JS: record the swipe outcome, reset transforms, advance to the next card.
  const advance = useCallback(
    (dir: Direction) => {
      const card = deckRef.current[indexRef.current];
      if (card) {
        const disp = useMealDispositionStore.getState();
        if (dir === 'up') {
          setChosen((prev) => (prev.some((c) => c.id === card.id) ? prev : [...prev, card]));
          disp.clearDisposition(card.id);
        } else if (dir === 'right') {
          disp.setDisposition(card.id, 'later');
        } else {
          disp.setDisposition(card.id, 'rejected');
        }
      }
      tx.value = 0;
      ty.value = 0;
      flip.value = 0;
      lift.value = 0;
      fade.value = 0;
      locked.value = 0;
      setTearing(false);
      indexRef.current += 1;
      setIndex(indexRef.current);
    },
    [tx, ty, flip, lift, fade, locked]
  );

  // UI-thread: play the exit animation for a direction, then hand off to JS.
  const kickExit = useCallback(
    (dir: Direction) => {
      'worklet';
      if (locked.value) return;
      locked.value = 1;

      if (reduceMotion) {
        if (dir === 'up') runOnJS(onKeepEffects)();
        fade.value = withTiming(1, { duration: 120 }, (fin) => {
          if (fin) runOnJS(advance)(dir);
        });
        return;
      }

      if (dir === 'up') {
        runOnJS(onKeepEffects)();
        lift.value = withTiming(1, { duration: 110 });
        tx.value = withTiming(0, { duration: 110 });
        ty.value = withTiming(-screenH, { duration: 420, easing: Easing.in(Easing.cubic) });
        fade.value = withTiming(1, { duration: 420 }, (fin) => {
          if (fin) runOnJS(advance)(dir);
        });
      } else if (dir === 'right') {
        runOnJS(haptics.selection)();
        flip.value = withTiming(1, { duration: 460, easing: Easing.inOut(Easing.cubic) });
        tx.value = withTiming(screenW * 0.18, { duration: 460 });
        fade.value = withTiming(1, { duration: 460 }, (fin) => {
          if (fin) runOnJS(advance)(dir);
        });
      } else {
        runOnJS(onTearEffects)();
        tx.value = withTiming(-screenW * 1.3, { duration: 380, easing: Easing.in(Easing.quad) });
        ty.value = withTiming(60, { duration: 380 });
        fade.value = withTiming(1, { duration: 380 }, (fin) => {
          if (fin) runOnJS(advance)(dir);
        });
      }
    },
    [advance, onKeepEffects, onTearEffects, reduceMotion, screenH, screenW, fade, flip, lift, locked, tx, ty]
  );

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      if (locked.value) return;
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      'worklet';
      if (locked.value) return;
      const upIntent =
        e.translationY < -UP_THRESHOLD && Math.abs(e.translationY) > Math.abs(e.translationX);
      if (upIntent) {
        kickExit('up');
      } else if (e.translationX > X_THRESHOLD) {
        kickExit('right');
      } else if (e.translationX < -X_THRESHOLD) {
        kickExit('left');
      } else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    });

  const triggerButton = useCallback(
    (dir: Direction) => {
      runOnUI(kickExit)(dir);
    },
    [kickExit]
  );

  const topStyle = useAnimatedStyle(() => {
    const tilt = (tx.value / screenW) * 9;
    return {
      transform: [
        { perspective: 1200 },
        { translateX: tx.value },
        { translateY: ty.value },
        { rotateY: `${-flip.value * 165}deg` },
        { rotateZ: `${tilt}deg` },
        { scaleY: 1 - lift.value * 0.45 },
        { scaleX: 1 - lift.value * 0.12 },
      ],
      opacity: 1 - fade.value,
    };
  });

  const keepHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [-UP_THRESHOLD, -30], [1, 0], 'clamp'),
  }));
  const laterHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [40, X_THRESHOLD], [0, 1], 'clamp'),
  }));
  const tearHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-X_THRESHOLD, -40], [1, 0], 'clamp'),
  }));
  const ribbonStyle = useAnimatedStyle(() => ({ transform: [{ scale: ribbonScale.value }] }));

  const rebuildDeck = useCallback(() => {
    useMealDispositionStore.getState().resetRejected();
    const fresh = buildMealDeck(
      getMealCatalog(),
      useRecipeStore.getState().recipes,
      useMealDispositionStore.getState().dispositions,
      targetsRef.current
    );
    setDeck(fresh);
    deckRef.current = fresh;
    indexRef.current = 0;
    setIndex(0);
    toast.show({ message: 'Brought back passed meals', tone: 'neutral' });
  }, [toast]);

  const handleBuild = useCallback(async () => {
    if (chosen.length === 0) return;
    if (planEntries.length > 0) {
      const replace = await confirm({
        title: 'Replace current plan?',
        message: 'This clears your existing weekly plan and adds the meals you picked.',
        confirmLabel: 'Replace',
        destructive: true,
      });
      if (!replace) return;
      useMealScheduleStore.getState().clearSchedule();
      useMealPlanStore.getState().clearPlan();
    }
    const summary = arrangeAndCommitChosen({
      cards: chosen,
      catalog: getMealCatalog(),
      recipes: useRecipeStore.getState().recipes,
      days,
      slots,
      targets: targetsRef.current,
      cuisinePreferences: settings.cuisinePreferences,
      cookingFrequency: settings.cookingFrequency,
    });
    toast.show({
      message:
        summary.unfilledSlots > 0
          ? `Added ${summary.recipeCount} meals — ${summary.unfilledSlots} slots left open`
          : `Added ${summary.recipeCount} meals to your week`,
      tone: 'success',
    });
    // Straight to the Week grid: the deck just committed a week's meals, so the
    // calendar is what the user needs to see, not today's log.
    navigation.navigate('Tabs', { screen: 'Log', params: { view: 'week' } });
  }, [chosen, planEntries.length, days, slots, settings.cuisinePreferences, settings.cookingFrequency, toast, navigation]);

  const current = deck[index];
  const peeking = [deck[index + 2], deck[index + 1]].filter(Boolean) as DeckCard[];
  const exhausted = !current;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: t.palette.bg, paddingTop: insets.top }}>
        <AmbientBackground />
        <View style={{ paddingHorizontal: t.spacing.lg }}>
          <Header
            title="Cookbook"
            subtitle="Swipe up to keep · right for later · left to toss"
            rightIcon="close"
            onRightPress={() => navigation.goBack()}
          />
        </View>

        {/* Ribbon bookmark + this-week counter (swipe-up lands here). */}
        <View style={{ alignItems: 'center', marginTop: t.spacing.xs }}>
          <Animated.View
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.sm,
                paddingVertical: t.spacing.sm,
                paddingHorizontal: t.spacing.lg,
                borderRadius: t.radius.pill,
                backgroundColor: t.palette.primarySoft,
                borderWidth: 1,
                borderColor: t.palette.border,
              },
              ribbonStyle,
            ]}
          >
            <Text variant="title" weight="bold" tone="accent">
              🔖
            </Text>
            <CountUpText value={chosen.length} variant="title" weight="bold" tone="primary" />
            <Text variant="small" tone="secondary">
              this week
            </Text>
          </Animated.View>
          <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, top: 12 }}>
            <CompletionBurst trigger={sparkle} particles={14} size={7} />
          </View>
        </View>

        {/* Card deck */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: cardW, height: cardH }}>
            {exhausted ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md }}>
                <Text variant="headline" weight="bold" style={{ textAlign: 'center' }}>
                  That's the whole cookbook
                </Text>
                <Text variant="body" tone="secondary" style={{ textAlign: 'center' }}>
                  {chosen.length > 0
                    ? `You picked ${chosen.length} meal${chosen.length === 1 ? '' : 's'} for this week.`
                    : 'You didn’t keep any meals yet.'}
                </Text>
                <Button label="Bring back passed meals" icon="refresh" variant="secondary" onPress={rebuildDeck} />
              </View>
            ) : (
              <>
                {peeking.map((c, i) => {
                  // i=0 is the further card (index+2), i=1 is the next card.
                  const depth = peeking.length - i; // 2 then 1
                  return (
                    <View
                      key={c.id}
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: 0,
                        bottom: 0,
                        alignItems: 'center',
                        transform: [{ translateY: -depth * 12 }, { scale: 1 - depth * 0.04 }],
                        opacity: 1 - depth * 0.18,
                      }}
                    >
                      <CookbookCard card={c} width={cardW} height={cardH} />
                    </View>
                  );
                })}

                <GestureDetector gesture={pan}>
                  <Animated.View
                    style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center' }, topStyle]}
                  >
                    <View style={{ width: cardW, height: cardH }}>
                      <CookbookCard card={current} width={cardW} height={cardH} />

                      {/* Torn spine overlay while ripping left. */}
                      {tearing ? (
                        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0 }}>
                          <TornEdge height={cardH} color={t.palette.bgElevated} />
                        </View>
                      ) : null}

                      {/* Intent stamps. */}
                      <Animated.View style={[stampBase(t, 'top'), keepHintStyle]}>
                        <Text variant="title" weight="bold" style={{ color: t.palette.success }}>
                          THIS WEEK
                        </Text>
                      </Animated.View>
                      <Animated.View style={[stampBase(t, 'right'), laterHintStyle]}>
                        <Text variant="title" weight="bold" style={{ color: t.palette.warning }}>
                          LATER
                        </Text>
                      </Animated.View>
                      <Animated.View style={[stampBase(t, 'left'), tearHintStyle]}>
                        <Text variant="title" weight="bold" style={{ color: t.palette.danger }}>
                          NOPE
                        </Text>
                      </Animated.View>
                    </View>
                  </Animated.View>
                </GestureDetector>
              </>
            )}
          </View>
        </View>

        {/* Action row + build button */}
        <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: insets.bottom + t.spacing.md, gap: t.spacing.md }}>
          {!exhausted ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: t.spacing.xl }}>
              <IconButton
                icon="close"
                variant="danger"
                size={26}
                onPress={() => triggerButton('left')}
                accessibilityLabel="Toss this meal"
              />
              <IconButton
                icon="bookmark-outline"
                variant="outlined"
                size={26}
                onPress={() => triggerButton('right')}
                accessibilityLabel="Save for another week"
              />
              <IconButton
                icon="check"
                variant="soft"
                size={26}
                onPress={() => triggerButton('up')}
                accessibilityLabel="Add to this week"
              />
            </View>
          ) : null}
          <Button
            label={chosen.length > 0 ? `Build my week (${chosen.length})` : 'Build my week'}
            icon="calendar-check"
            onPress={handleBuild}
            disabled={chosen.length === 0}
            fullWidth
            size="lg"
            style={t.shadow.medium}
          />
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

// Centered intent stamp anchored toward the swipe direction.
function stampBase(t: ReturnType<typeof useAppTheme>, anchor: 'top' | 'left' | 'right') {
  const base = {
    position: 'absolute' as const,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.sm,
    borderWidth: 2,
    backgroundColor: 'rgba(255,253,247,0.82)',
  };
  if (anchor === 'top') {
    return { ...base, top: t.spacing.lg, alignSelf: 'center' as const, borderColor: t.palette.success };
  }
  if (anchor === 'right') {
    return { ...base, top: t.spacing.lg, right: t.spacing.lg, borderColor: t.palette.warning };
  }
  return { ...base, top: t.spacing.lg, left: t.spacing.lg + 12, borderColor: t.palette.danger };
}
