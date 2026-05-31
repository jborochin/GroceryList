import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../theme/tokens';
import {
  AmbientBackground,
  Button,
  GlassSurface,
  Input,
  SectionHeader,
  SegmentedControl,
  Surface,
  Text,
  useToast,
} from '../components/ui';
import { haptics } from '../utils/haptics';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../navigation/types';
import {
  ActivityLevel,
  Goal,
  Sex,
  TdeeInputs,
  UnitSystem,
} from '../types';
import {
  computeTargetCalories,
  ftInToCm,
  inToCm,
  lbToKg,
  macroGramsFromSplit,
} from '../utils/tdeeCalculator';
import foodPreferences from '../data/foodPreferences.json';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Step = 'tdee' | 'preferences';

const DEFAULT_SPLIT = { proteinPct: 30, carbsPct: 40, fatPct: 30 } as const;

const ACTIVITY_OPTIONS: Array<{ value: ActivityLevel; label: string; helper: string }> = [
  { value: 'sedentary', label: 'Sedentary', helper: 'Mostly desk, little exercise' },
  { value: 'light', label: 'Light', helper: '1–3 light sessions / week' },
  { value: 'moderate', label: 'Moderate', helper: '3–5 sessions / week' },
  { value: 'active', label: 'Active', helper: '6–7 sessions / week' },
  { value: 'very_active', label: 'Very active', helper: 'Hard training or physical job' },
];

const GOAL_OPTIONS: Array<{ value: Goal; label: string; helper: string }> = [
  { value: 'lose', label: 'Lose', helper: '~1 lb / week' },
  { value: 'maintain', label: 'Maintain', helper: 'Stay where I am' },
  { value: 'gain', label: 'Gain', helper: '~1 lb / week' },
];

export function OnboardingScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const applyOnboarding = useSettingsStore((s) => s.applyOnboarding);
  const user = useAuthStore((s) => s.user);

  const [step, setStep] = useState<Step>('tdee');

  // TDEE inputs (kept as strings while typing; parsed on demand).
  const [sex, setSex] = useState<Sex>('male');
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [age, setAge] = useState('');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [heightCmStr, setHeightCmStr] = useState('');
  const [weightStr, setWeightStr] = useState('');
  const [activity, setActivity] = useState<ActivityLevel>('moderate');
  const [goal, setGoal] = useState<Goal>('maintain');

  // Step 2 inputs.
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [dietary, setDietary] = useState<string[]>([]);

  const parsed = useMemo<TdeeInputs | null>(() => {
    const ageN = parseInt(age, 10);
    if (!Number.isFinite(ageN)) return null;

    let heightCm: number;
    if (unitSystem === 'metric') {
      const cm = parseFloat(heightCmStr);
      if (!Number.isFinite(cm)) return null;
      heightCm = cm;
    } else {
      const ft = parseInt(heightFt, 10);
      const inches = heightIn === '' ? 0 : parseInt(heightIn, 10);
      if (!Number.isFinite(ft) || !Number.isFinite(inches)) return null;
      heightCm = ftInToCm(ft, inches);
    }

    const w = parseFloat(weightStr);
    if (!Number.isFinite(w)) return null;
    const weightKg = unitSystem === 'metric' ? w : lbToKg(w);

    return {
      v: 1,
      sex,
      age: ageN,
      heightCm,
      weightKg,
      activity,
      goal,
      unitSystem,
    };
  }, [sex, unitSystem, age, heightFt, heightIn, heightCmStr, weightStr, activity, goal]);

  const targetCalories = useMemo(
    () => (parsed ? computeTargetCalories(parsed) : null),
    [parsed]
  );

  const previewGrams = useMemo(
    () => (targetCalories ? macroGramsFromSplit(targetCalories, DEFAULT_SPLIT) : null),
    [targetCalories]
  );

  const canSubmitTdee = parsed !== null && targetCalories !== null;

  const submitTdee = () => {
    if (!canSubmitTdee || !parsed || targetCalories == null) return;
    haptics.tap();
    setStep('preferences');
  };

  const skipTdee = () => {
    haptics.selection();
    setStep('preferences');
  };

  const submitPreferences = () => {
    haptics.tap();
    finish({ includeTdee: true, includePrefs: true });
  };

  const skipPreferences = () => {
    haptics.selection();
    finish({ includeTdee: true, includePrefs: false });
  };

  const finish = (opts: { includeTdee: boolean; includePrefs: boolean }) => {
    // One atomic store mutation → one sync push. See applyOnboarding comment.
    if (opts.includeTdee && parsed && targetCalories != null) {
      applyOnboarding({
        onboardingCompleted: true,
        tdeeInputs: parsed,
        dailyCalorieTarget: targetCalories,
        macroSplit: DEFAULT_SPLIT,
        macroGrams: macroGramsFromSplit(targetCalories, DEFAULT_SPLIT),
        cuisinePreferences: opts.includePrefs ? cuisines : [],
        dietaryRestrictions: opts.includePrefs ? dietary : [],
      });
    } else {
      applyOnboarding({
        onboardingCompleted: true,
        cuisinePreferences: opts.includePrefs ? cuisines : [],
        dietaryRestrictions: opts.includePrefs ? dietary : [],
      });
    }
    toast.show({ message: 'Welcome — your plan is set up.', tone: 'success' });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + t.spacing.md,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: insets.bottom + t.spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TopBar
          step={step}
          onBack={step === 'preferences' ? () => setStep('tdee') : undefined}
          onSignIn={!user ? () => navigation.navigate('Auth') : undefined}
        />

        {step === 'tdee' ? (
          <TdeeStep
            sex={sex}
            setSex={setSex}
            unitSystem={unitSystem}
            setUnitSystem={setUnitSystem}
            age={age}
            setAge={setAge}
            heightFt={heightFt}
            setHeightFt={setHeightFt}
            heightIn={heightIn}
            setHeightIn={setHeightIn}
            heightCmStr={heightCmStr}
            setHeightCmStr={setHeightCmStr}
            weightStr={weightStr}
            setWeightStr={setWeightStr}
            activity={activity}
            setActivity={setActivity}
            goal={goal}
            setGoal={setGoal}
            targetCalories={targetCalories}
            previewGrams={previewGrams}
            canSubmit={canSubmitTdee}
            onSubmit={submitTdee}
            onSkip={skipTdee}
          />
        ) : (
          <PreferencesStep
            cuisines={cuisines}
            setCuisines={setCuisines}
            dietary={dietary}
            setDietary={setDietary}
            onSubmit={submitPreferences}
            onSkip={skipPreferences}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ---------- Top bar ----------

function TopBar({
  step,
  onBack,
  onSignIn,
}: {
  step: Step;
  onBack?: () => void;
  onSignIn?: () => void;
}) {
  const t = useAppTheme();
  return (
    <View style={{ marginBottom: t.spacing.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 32,
        }}
      >
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back to previous step"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Icon name="chevron-left" size={22} color={t.palette.textPrimary} />
            <Text variant="body" weight="medium">
              Back
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        {onSignIn ? (
          <Pressable onPress={onSignIn} hitSlop={12} accessibilityRole="button">
            <Text variant="small" weight="semibold" tone="secondary">
              Already have an account? Sign in
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ marginTop: t.spacing.lg, flexDirection: 'row', gap: 6 }}>
        <StepDot active />
        <StepDot active={step === 'preferences'} />
      </View>
      <Text variant="eyebrow" tone="tertiary" style={{ marginTop: t.spacing.lg }}>
        Step {step === 'tdee' ? '1' : '2'} of 2
      </Text>
      <Text variant="display" style={{ marginTop: 4 }}>
        {step === 'tdee' ? "Let's tune your daily target" : 'What do you like to eat?'}
      </Text>
      <Text variant="body" tone="secondary" style={{ marginTop: 6 }}>
        {step === 'tdee'
          ? 'A few numbers and we can set your calories and macros for the week.'
          : 'Pick anything that sounds good. We use this to suggest recipes you actually want to cook.'}
      </Text>
    </View>
  );
}

function StepDot({ active }: { active: boolean }) {
  const t = useAppTheme();
  return (
    <View
      style={{
        height: 4,
        flex: 1,
        borderRadius: 999,
        backgroundColor: active ? t.palette.primary : t.palette.surfaceSunken,
      }}
    />
  );
}

// ---------- Step 1: TDEE ----------

interface TdeeStepProps {
  sex: Sex;
  setSex: (s: Sex) => void;
  unitSystem: UnitSystem;
  setUnitSystem: (u: UnitSystem) => void;
  age: string;
  setAge: (s: string) => void;
  heightFt: string;
  setHeightFt: (s: string) => void;
  heightIn: string;
  setHeightIn: (s: string) => void;
  heightCmStr: string;
  setHeightCmStr: (s: string) => void;
  weightStr: string;
  setWeightStr: (s: string) => void;
  activity: ActivityLevel;
  setActivity: (a: ActivityLevel) => void;
  goal: Goal;
  setGoal: (g: Goal) => void;
  targetCalories: number | null;
  previewGrams: { proteinG: number; carbsG: number; fatG: number } | null;
  canSubmit: boolean;
  onSubmit: () => void;
  onSkip: () => void;
}

function TdeeStep(p: TdeeStepProps) {
  const t = useAppTheme();
  return (
    <View>
      <SectionHeader title="About you" marginTop={0} />
      <Surface variant="outlined" pad={t.spacing.lg}>
        <Text variant="caption" weight="medium" tone="secondary" style={{ marginBottom: 6 }}>
          Sex (for BMR formula)
        </Text>
        <SegmentedControl
          items={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
          value={p.sex}
          onChange={p.setSex}
        />
        <Text
          variant="caption"
          weight="medium"
          tone="secondary"
          style={{ marginTop: t.spacing.lg, marginBottom: 6 }}
        >
          Units
        </Text>
        <SegmentedControl
          items={[
            { value: 'imperial', label: 'Imperial' },
            { value: 'metric', label: 'Metric' },
          ]}
          value={p.unitSystem}
          onChange={p.setUnitSystem}
        />
      </Surface>

      <SectionHeader title="Body" />
      <Surface variant="outlined" pad={t.spacing.lg}>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Input
            label="Age"
            keyboardType="number-pad"
            value={p.age}
            onChangeText={p.setAge}
            placeholder="30"
            containerStyle={{ flex: 1 }}
          />
          {p.unitSystem === 'imperial' ? (
            <>
              <Input
                label="Height (ft)"
                keyboardType="number-pad"
                value={p.heightFt}
                onChangeText={p.setHeightFt}
                placeholder="5"
                containerStyle={{ flex: 1 }}
              />
              <Input
                label="Height (in)"
                keyboardType="number-pad"
                value={p.heightIn}
                onChangeText={p.setHeightIn}
                placeholder="10"
                containerStyle={{ flex: 1 }}
              />
            </>
          ) : (
            <Input
              label="Height (cm)"
              keyboardType="number-pad"
              value={p.heightCmStr}
              onChangeText={p.setHeightCmStr}
              placeholder="178"
              containerStyle={{ flex: 2 }}
            />
          )}
        </View>
        <View style={{ marginTop: t.spacing.md }}>
          <Input
            label={`Weight (${p.unitSystem === 'imperial' ? 'lb' : 'kg'})`}
            keyboardType="decimal-pad"
            value={p.weightStr}
            onChangeText={p.setWeightStr}
            placeholder={p.unitSystem === 'imperial' ? '170' : '77'}
          />
        </View>
      </Surface>

      <SectionHeader title="Activity" />
      <Surface variant="outlined" pad={t.spacing.sm}>
        {ACTIVITY_OPTIONS.map((opt, idx) => (
          <ChoiceRow
            key={opt.value}
            label={opt.label}
            helper={opt.helper}
            selected={p.activity === opt.value}
            onPress={() => p.setActivity(opt.value)}
            showDivider={idx < ACTIVITY_OPTIONS.length - 1}
          />
        ))}
      </Surface>

      <SectionHeader title="Goal" />
      <Surface variant="outlined" pad={t.spacing.sm}>
        {GOAL_OPTIONS.map((opt, idx) => (
          <ChoiceRow
            key={opt.value}
            label={opt.label}
            helper={opt.helper}
            selected={p.goal === opt.value}
            onPress={() => p.setGoal(opt.value)}
            showDivider={idx < GOAL_OPTIONS.length - 1}
          />
        ))}
      </Surface>

      <SectionHeader title="Your daily target" />
      <GlassSurface variant="hero" radius={t.radius.lg} pad={t.spacing.lg} shadow="soft">
        {p.targetCalories && p.previewGrams ? (
          <View>
            <Text variant="eyebrow" tone="tertiary">
              Suggested
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <Text variant="display" weight="semibold">
                {p.targetCalories}
              </Text>
              <Text variant="body" tone="secondary">
                kcal / day
              </Text>
            </View>
            <View
              style={{
                marginTop: t.spacing.md,
                flexDirection: 'row',
                gap: t.spacing.md,
              }}
            >
              <MacroPill label="Protein" grams={p.previewGrams.proteinG} />
              <MacroPill label="Carbs" grams={p.previewGrams.carbsG} />
              <MacroPill label="Fat" grams={p.previewGrams.fatG} />
            </View>
            <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.md }}>
              Default 30 / 40 / 30 split. You can tune this in Settings later.
            </Text>
          </View>
        ) : (
          <Text variant="body" tone="secondary">
            Fill in the fields above to see your target.
          </Text>
        )}
      </GlassSurface>

      <View style={{ marginTop: t.spacing.xl, gap: t.spacing.md }}>
        <Button
          label="Continue"
          onPress={p.onSubmit}
          disabled={!p.canSubmit}
          fullWidth
          size="lg"
          trailingIcon="arrow-right"
        />
        <Pressable onPress={p.onSkip} hitSlop={12} style={{ alignSelf: 'center' }}>
          <Text variant="small" weight="semibold" tone="secondary">
            Skip for now
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ChoiceRow({
  label,
  helper,
  selected,
  onPress,
  showDivider,
}: {
  label: string;
  helper?: string;
  selected: boolean;
  onPress: () => void;
  showDivider: boolean;
}) {
  const t = useAppTheme();
  return (
    <View>
      <Pressable
        onPress={() => {
          haptics.selection();
          onPress();
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.md,
          paddingHorizontal: t.spacing.md,
          paddingVertical: t.spacing.md,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: selected ? t.palette.primary : t.palette.borderStrong,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? (
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: t.palette.primary,
              }}
            />
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyLg" weight="semibold">
            {label}
          </Text>
          {helper ? (
            <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
              {helper}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {showDivider ? (
        <View
          style={{
            height: 1,
            backgroundColor: t.palette.border,
            marginLeft: t.spacing.md + 22 + t.spacing.md,
          }}
        />
      ) : null}
    </View>
  );
}

function MacroPill({ label, grams }: { label: string; grams: number }) {
  const t = useAppTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="tertiary">
        {label}
      </Text>
      <Text variant="title" weight="semibold" style={{ marginTop: 2 }}>
        {grams}
        <Text variant="caption" tone="tertiary">
          {' '}
          g
        </Text>
      </Text>
    </View>
  );
}

// ---------- Step 2: Preferences ----------

interface PreferencesStepProps {
  cuisines: string[];
  setCuisines: (xs: string[]) => void;
  dietary: string[];
  setDietary: (xs: string[]) => void;
  onSubmit: () => void;
  onSkip: () => void;
}

function PreferencesStep(p: PreferencesStepProps) {
  const t = useAppTheme();

  const toggle = (xs: string[], key: string): string[] =>
    xs.includes(key) ? xs.filter((k) => k !== key) : [...xs, key];

  return (
    <View>
      <SectionHeader title="Cuisines you enjoy" marginTop={0} />
      <Surface variant="outlined" pad={t.spacing.md}>
        <ChipWrap
          items={foodPreferences.cuisines}
          selected={p.cuisines}
          onToggle={(key) => p.setCuisines(toggle(p.cuisines, key))}
        />
      </Surface>

      <SectionHeader title="Dietary needs" />
      <Surface variant="outlined" pad={t.spacing.md}>
        <ChipWrap
          items={foodPreferences.dietary}
          selected={p.dietary}
          onToggle={(key) => p.setDietary(toggle(p.dietary, key))}
        />
      </Surface>

      <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.md }}>
        Tap to add or remove. Pick as many or as few as you like.
      </Text>

      <View style={{ marginTop: t.spacing.xl, gap: t.spacing.md }}>
        <Button
          label="Finish setup"
          onPress={p.onSubmit}
          fullWidth
          size="lg"
          trailingIcon="check"
        />
        <Pressable onPress={p.onSkip} hitSlop={12} style={{ alignSelf: 'center' }}>
          <Text variant="small" weight="semibold" tone="secondary">
            Skip for now
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ChipWrap({
  items,
  selected,
  onToggle,
}: {
  items: Array<{ key: string; label: string }>;
  selected: string[];
  onToggle: (key: string) => void;
}) {
  const t = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
      {items.map((item) => {
        const isSelected = selected.includes(item.key);
        return (
          <Pressable
            key={item.key}
            onPress={() => {
              haptics.selection();
              onToggle(item.key);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: t.radius.pill,
              borderWidth: 1,
              borderColor: isSelected ? t.palette.primary : t.palette.border,
              backgroundColor: isSelected ? t.palette.primary : 'transparent',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              variant="small"
              weight="semibold"
              style={{
                color: isSelected ? t.palette.primaryContrast : t.palette.textPrimary,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
