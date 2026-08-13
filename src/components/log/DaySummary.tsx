import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DaySummary as DaySummaryData } from '../../utils/foodLogDay';
import { UserSettings } from '../../types';
import { useAppTheme } from '../../theme/tokens';
import { GlassSurface, ProgressBar, Text } from '../ui';

interface Props {
  summary: DaySummaryData;
  settings: UserSettings;
}

// The day's headline: calories against target, then the three macros.
//
// Deliberately a bar and not a ring. A ring reads as "progress toward a goal you
// want to max out", which is wrong for calories — the goal is to land near the
// target, not to fill it. A bar with the target marked shows over and under
// symmetrically, and it reuses the same NutritionBar language the rest of the
// app already speaks.
export function DaySummary({ summary, settings }: Props) {
  const t = useAppTheme();
  const { totals, projected } = summary;
  const target = settings.dailyCalorieTarget;
  const remaining = Math.round(target - totals.calories);
  const over = remaining < 0;

  const macros = [
    { label: 'Protein', value: totals.proteinG, target: settings.macroGrams.proteinG },
    { label: 'Carbs', value: totals.carbsG, target: settings.macroGrams.carbsG },
    { label: 'Fat', value: totals.fatG, target: settings.macroGrams.fatG },
  ];

  return (
    <GlassSurface variant="hero" pad={t.spacing.lg}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.spacing.sm }}>
        <Text variant="display" tabularNums>
          {Math.round(totals.calories)}
        </Text>
        <Text variant="body" tone="secondary" tabularNums style={{ paddingBottom: 6 }}>
          / {target} kcal
        </Text>
      </View>

      {/* accentSoftText, not accent: orange text roles need the darker token to
          clear contrast on the near-white backdrop (see CLAUDE.md, Theming). */}
      <Text
        variant="caption"
        tone="tertiary"
        style={[
          { marginTop: 2 },
          over ? { color: t.palette.accentSoftText } : null,
        ]}
      >
        {over ? `${Math.abs(remaining)} over target` : `${remaining} left today`}
        {/* Naming the projected share is what makes the number trustworthy —
            otherwise a planned-but-not-eaten dinner looks like a logged one. */}
        {projected.calories > 0 ? ` · ${Math.round(projected.calories)} from your plan` : ''}
      </Text>

      <View style={{ marginTop: t.spacing.sm }}>
        <ProgressBar
          progress={target > 0 ? totals.calories / target : 0}
          color={over ? t.palette.accent : t.palette.primary}
        />
      </View>

      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: t.palette.rimLight,
          marginVertical: t.spacing.md,
        }}
      />

      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        {macros.map((m) => (
          <View key={m.label} style={{ flex: 1 }}>
            <Text variant="micro" tone="tertiary">
              {m.label}
            </Text>
            <Text variant="body" weight="semibold" tabularNums style={{ marginTop: 1 }}>
              {Math.round(m.value)}
              <Text variant="micro" tone="tertiary" tabularNums>
                {' '}
                / {m.target}g
              </Text>
            </Text>
            <View style={{ marginTop: 4 }}>
              <ProgressBar
                progress={m.target > 0 ? m.value / m.target : 0}
                color={t.palette.textSecondary}
                height={4}
              />
            </View>
          </View>
        ))}
      </View>

      {summary.hasMissingRecipe ? (
        <Text variant="micro" tone="tertiary" style={{ marginTop: t.spacing.sm }}>
          A planned meal is missing nutrition data — this total may be understated.
        </Text>
      ) : null}
    </GlassSurface>
  );
}
