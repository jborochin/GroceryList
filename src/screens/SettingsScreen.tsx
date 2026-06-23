import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Slider from '@react-native-community/slider';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePantryStore } from '../store/usePantryStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';
import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../navigation/types';
import { supabaseConfigured } from '../lib/supabase';
import { useAppTheme } from '../theme/tokens';
import {
  AmbientBackground,
  Button,
  CollapsingHeader,
  GlassSurface,
  Header,
  Surface,
  Text,
  Input,
  SectionHeader,
  SegmentedControl,
  TAB_BAR_SPACE,
  useToast,
} from '../components/ui';
import { haptics } from '../utils/haptics';
import { CookingFrequency } from '../types';

const COOKING_FREQUENCY_ITEMS: Array<{ value: CookingFrequency; label: string }> = [
  { value: 'batch', label: 'Batch' },
  { value: 'few_days', label: 'Few days' },
  { value: 'daily', label: 'Daily' },
];

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const settings = useSettingsStore((s) => s.settings);
  const setCalorieTarget = useSettingsStore((s) => s.setCalorieTarget);
  const setMacroSplit = useSettingsStore((s) => s.setMacroSplit);
  const setMacroGrams = useSettingsStore((s) => s.setMacroGrams);
  const setReduceVisualEffects = useSettingsStore((s) => s.setReduceVisualEffects);
  const setCookingFrequency = useSettingsStore((s) => s.setCookingFrequency);
  const setCookingEasePreference = useSettingsStore((s) => s.setCookingEasePreference);
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);
  const resetSettings = useSettingsStore((s) => s.resetSettings);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const resetRecipes = useRecipeStore((s) => s.replaceAll);
  const clearPlan = useMealPlanStore((s) => s.clearPlan);
  const resetPantry = usePantryStore((s) => s.replaceAll);
  const clearOverrides = usePriceOverrideStore((s) => s.clear);

  const authUser = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const signOut = useAuthStore((s) => s.signOut);

  const [calories, setCalories] = useState(String(settings.dailyCalorieTarget));
  const [protein, setProtein] = useState(String(settings.macroSplit.proteinPct));
  const [carbs, setCarbs] = useState(String(settings.macroSplit.carbsPct));
  const [fat, setFat] = useState(String(settings.macroSplit.fatPct));
  const [proteinG, setProteinG] = useState(String(settings.macroGrams.proteinG));
  const [carbsG, setCarbsG] = useState(String(settings.macroGrams.carbsG));
  const [fatG, setFatG] = useState(String(settings.macroGrams.fatG));

  const commitCalories = () => {
    const n = parseInt(calories, 10);
    if (!isNaN(n)) setCalorieTarget(n);
  };

  const commitMacros = () => {
    const p = parseInt(protein, 10) || 0;
    const c = parseInt(carbs, 10) || 0;
    const f = parseInt(fat, 10) || 0;
    if (p + c + f <= 0) return;
    setMacroSplit(p, c, f);
  };

  const commitMacroGrams = () => {
    const p = parseInt(proteinG, 10) || 0;
    const c = parseInt(carbsG, 10) || 0;
    const f = parseInt(fatG, 10) || 0;
    setMacroGrams(p, c, f);
  };

  const macroTotal =
    (parseInt(protein, 10) || 0) + (parseInt(carbs, 10) || 0) + (parseInt(fat, 10) || 0);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const handleReset = () => {
    haptics.warn();
    setResetConfirmOpen(true);
  };

  const performReset = () => {
    resetRecipes([]);
    clearPlan();
    resetPantry([]);
    clearOverrides();
    resetSettings();
    setResetConfirmOpen(false);
    toast.show({ message: 'All data reset.', tone: 'warning' });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: TAB_BAR_SPACE,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Header title="You" subtitle="Tune your goals and your data." />

      <SectionHeader title="Daily target" marginTop={0} />
      <Surface variant="outlined" pad={t.spacing.lg}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <Input
            keyboardType="numeric"
            value={calories}
            onChangeText={setCalories}
            onBlur={commitCalories}
            containerStyle={{ flex: 1 }}
          />
          <Text variant="body" tone="secondary">
            kcal / day
          </Text>
        </View>
      </Surface>

      <SectionHeader title="Macro split" />
      <Surface variant="outlined" pad={t.spacing.lg}>
        <Text variant="caption" tone="secondary" style={{ marginBottom: t.spacing.md }}>
          % of daily calories from each macro
        </Text>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Input
            label="Protein"
            keyboardType="numeric"
            value={protein}
            onChangeText={setProtein}
            onBlur={commitMacros}
            containerStyle={{ flex: 1 }}
          />
          <Input
            label="Carbs"
            keyboardType="numeric"
            value={carbs}
            onChangeText={setCarbs}
            onBlur={commitMacros}
            containerStyle={{ flex: 1 }}
          />
          <Input
            label="Fat"
            keyboardType="numeric"
            value={fat}
            onChangeText={setFat}
            onBlur={commitMacros}
            containerStyle={{ flex: 1 }}
          />
        </View>
        <Text
          variant="caption"
          style={{
            marginTop: t.spacing.sm,
            color: macroTotal === 100 ? t.palette.textTertiary : t.palette.danger,
          }}
        >
          Total: {macroTotal}%
          {macroTotal === 100 ? '' : ' (we normalize on save)'}
        </Text>
      </Surface>

      <SectionHeader title="Macro grams" />
      <Surface variant="outlined" pad={t.spacing.lg}>
        <Text variant="caption" tone="secondary" style={{ marginBottom: t.spacing.md }}>
          Daily gram targets (used for absolute macro tracking)
        </Text>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Input
            label="Protein g"
            keyboardType="numeric"
            value={proteinG}
            onChangeText={setProteinG}
            onBlur={commitMacroGrams}
            containerStyle={{ flex: 1 }}
          />
          <Input
            label="Carbs g"
            keyboardType="numeric"
            value={carbsG}
            onChangeText={setCarbsG}
            onBlur={commitMacroGrams}
            containerStyle={{ flex: 1 }}
          />
          <Input
            label="Fat g"
            keyboardType="numeric"
            value={fatG}
            onChangeText={setFatG}
            onBlur={commitMacroGrams}
            containerStyle={{ flex: 1 }}
          />
        </View>
      </Surface>

      <SectionHeader title="Cooking frequency" />
      <Surface variant="outlined" pad={t.spacing.lg}>
        <Text variant="caption" tone="secondary" style={{ marginBottom: t.spacing.md }}>
          How often you want to cook. Batch reuses a few dishes all week; daily varies meals each
          day.
        </Text>
        <SegmentedControl
          items={COOKING_FREQUENCY_ITEMS}
          value={settings.cookingFrequency}
          onChange={setCookingFrequency}
        />
      </Surface>

      <SectionHeader title="Cooking style" />
      <Surface variant="outlined" pad={t.spacing.lg}>
        <Text variant="caption" tone="secondary" style={{ marginBottom: t.spacing.md }}>
          Bias auto-generated meal plans toward quick, simple recipes or more elaborate ones.
        </Text>
        <Slider
          minimumValue={0}
          maximumValue={1}
          step={0.05}
          value={settings.cookingEasePreference}
          onSlidingComplete={setCookingEasePreference}
          minimumTrackTintColor={t.palette.primary}
          maximumTrackTintColor={t.palette.border}
          thumbTintColor={t.palette.primary}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: t.spacing.xs }}>
          <Text variant="caption" tone="tertiary">
            Prefer taste
          </Text>
          <Text variant="caption" tone="tertiary">
            Easy to cook
          </Text>
        </View>
      </Surface>

      <SectionHeader title="Account" />
      <Surface variant="outlined" pad={t.spacing.lg}>
        {authUser ? (
          <View style={{ gap: t.spacing.md }}>
            <View>
              <Text variant="caption" tone="secondary">
                Signed in as
              </Text>
              <Text variant="bodyLg" weight="semibold" style={{ marginTop: 2 }}>
                {authUser.email ?? authUser.id}
              </Text>
            </View>
            <Button
              label="Sign out"
              variant="secondary"
              onPress={() => void signOut()}
              loading={authLoading}
              fullWidth
            />
          </View>
        ) : (
          <View style={{ gap: t.spacing.md }}>
            <Text variant="body" tone="secondary">
              Sign in to back up your recipes, plan, and pantry and sync them across devices.
            </Text>
            <Button
              label="Sign in or create account"
              onPress={() => navigation.navigate('Auth')}
              fullWidth
              disabled={!supabaseConfigured}
            />
            {!supabaseConfigured ? (
              <Text variant="caption" tone="tertiary">
                Supabase is not configured. See supabase/README.md.
              </Text>
            ) : null}
          </View>
        )}
      </Surface>

      <SectionHeader title="Personalize" />
      <Surface variant="outlined" pad={t.spacing.lg}>
        <Text variant="body" tone="secondary" style={{ marginBottom: t.spacing.md }}>
          Redo the macro and food-preferences survey. Your existing targets stay until you finish.
        </Text>
        <Button
          label="Redo onboarding"
          variant="secondary"
          onPress={() => setOnboardingCompleted(false)}
          fullWidth
        />
      </Surface>

      <SectionHeader title="Appearance" />
      <Surface variant="outlined" pad={0}>
        <SettingsToggleRow
          icon="motion-outline"
          title="Reduce visual effects"
          subtitle="Disables blur, ambient backgrounds, and decorative motion"
          value={settings.reduceVisualEffects}
          onValueChange={(v) => {
            haptics.selection();
            setReduceVisualEffects(v);
          }}
        />
      </Surface>

      <SectionHeader title="Data" />
      <Surface variant="outlined" pad={0}>
        <SettingsRow
          icon="fridge-outline"
          title="Pantry"
          subtitle="Items you already have at home"
          onPress={() => navigation.navigate('Pantry')}
          showDivider
        />
        <SettingsRow
          icon="trash-can-outline"
          title="Reset all data"
          subtitle="Recipes, plan, pantry, overrides, and settings"
          onPress={handleReset}
          danger
        />
      </Surface>

        <Text
          variant="caption"
          tone="tertiary"
          style={{ textAlign: 'center', marginTop: t.spacing.xxl }}
        >
          {authUser
            ? 'MealPrep · Synced to your account · Edits work offline.'
            : 'MealPrep · Offline-first · Sign in to sync across devices.'}
        </Text>
      </Animated.ScrollView>
      <CollapsingHeader title="You" scrollY={scrollY} />
      <ResetConfirm
        visible={resetConfirmOpen}
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={performReset}
      />
    </View>
  );
}

function ResetConfirm({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useAppTheme();
  return (
    <Modal
      visible={visible}
      transparent
      onRequestClose={onCancel}
      animationType="fade"
      statusBarTranslucent
    >
      <Pressable
        onPress={onCancel}
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: t.palette.scrim, justifyContent: 'center', padding: t.spacing.lg },
        ]}
      >
        <Pressable onPress={() => {}}>
          <GlassSurface variant="chrome" radius={t.radius.xl} pad={t.spacing.xl} shadow="strong">
            <Text variant="eyebrow" tone="danger" style={{ marginBottom: 6 }}>
              Destructive
            </Text>
            <Text variant="display" style={{ marginBottom: t.spacing.sm }}>
              Reset all data?
            </Text>
            <Text variant="body" tone="secondary" style={{ marginBottom: t.spacing.xl }}>
              This clears all recipes, meal plan, pantry, and price overrides. This cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={onCancel}
                style={{ flex: 1 }}
                fullWidth
              />
              <Button
                label="Reset"
                variant="danger"
                onPress={onConfirm}
                style={{ flex: 1 }}
                fullWidth
              />
            </View>
          </GlassSurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface RowProps {
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  showDivider?: boolean;
  danger?: boolean;
}

interface ToggleRowProps {
  icon: string;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

function SettingsToggleRow({ icon, title, subtitle, value, onValueChange }: ToggleRowProps) {
  const t = useAppTheme();
  return (
    <View
      style={{
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: t.palette.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={t.palette.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyLg" weight="semibold">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: t.palette.surfaceSunken, true: t.palette.primarySoft }}
        thumbColor={value ? t.palette.primary : t.palette.surface}
      />
    </View>
  );
}

function SettingsRow({ icon, title, subtitle, onPress, showDivider, danger }: RowProps) {
  const t = useAppTheme();
  return (
    <View>
      <Surface
        variant="flat"
        radius={0}
        pad={t.spacing.lg}
        onPress={onPress}
        style={{ backgroundColor: 'transparent' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: danger ? t.palette.dangerSoft : t.palette.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon
              name={icon}
              size={18}
              color={danger ? t.palette.dangerSoftText : t.palette.textSecondary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              variant="bodyLg"
              weight="semibold"
              style={{ color: danger ? t.palette.danger : t.palette.textPrimary }}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-right" size={20} color={t.palette.textTertiary} />
        </View>
      </Surface>
      {showDivider ? (
        <View
          style={{
            height: 1,
            backgroundColor: t.palette.border,
            marginLeft: t.spacing.lg + 38 + t.spacing.md,
          }}
        />
      ) : null}
    </View>
  );
}
