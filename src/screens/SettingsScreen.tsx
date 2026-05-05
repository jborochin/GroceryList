import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSettingsStore } from '../store/useSettingsStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePantryStore } from '../store/usePantryStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import {
  Header,
  Surface,
  Text,
  Input,
  SectionHeader,
  TAB_BAR_SPACE,
} from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const settings = useSettingsStore((s) => s.settings);
  const setCalorieTarget = useSettingsStore((s) => s.setCalorieTarget);
  const setMacroSplit = useSettingsStore((s) => s.setMacroSplit);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const resetRecipes = useRecipeStore((s) => s.replaceAll);
  const clearPlan = useMealPlanStore((s) => s.clearPlan);
  const resetPantry = usePantryStore((s) => s.replaceAll);
  const clearOverrides = usePriceOverrideStore((s) => s.clear);

  const [calories, setCalories] = useState(String(settings.dailyCalorieTarget));
  const [protein, setProtein] = useState(String(settings.macroSplit.proteinPct));
  const [carbs, setCarbs] = useState(String(settings.macroSplit.carbsPct));
  const [fat, setFat] = useState(String(settings.macroSplit.fatPct));

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

  const macroTotal =
    (parseInt(protein, 10) || 0) + (parseInt(carbs, 10) || 0) + (parseInt(fat, 10) || 0);

  const handleReset = () => {
    Alert.alert(
      'Reset all data?',
      'This clears all recipes, meal plan, pantry, and price overrides. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            resetRecipes([]);
            clearPlan();
            resetPantry([]);
            clearOverrides();
            resetSettings();
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.palette.bg }}
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingHorizontal: t.spacing.lg,
        paddingBottom: TAB_BAR_SPACE,
      }}
      showsVerticalScrollIndicator={false}
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
        MealPrep · Offline-first · All data lives on your device.
      </Text>
    </ScrollView>
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
