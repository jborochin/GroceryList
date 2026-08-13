import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { loadFoodPortions } from '../lib/foodSearch';
import { useFoodLogStore } from '../store/useFoodLogStore';
import {
  nutritionForServing,
  roundNutrition,
  servingOptions,
  totalGrams,
} from '../utils/servingMath';
import { FoodItem, FoodServing } from '../types';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import { SLOT_LABEL } from '../components/log/weekDays';
import {
  Button,
  GlassSurface,
  Header,
  IconButton,
  Screen,
  SectionHeader,
  Stepper,
  Text,
} from '../components/ui';
import { useToast } from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Choose how much of a food you ate, then log it.
 *
 * The macros shown here are the macros stored — this screen is where a live
 * database row becomes a fixed diary entry.
 */
export function LogFoodScreen() {
  const t = useAppTheme();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const { params } = useRoute<RouteProp<RootStackParamList, 'LogFood'>>();
  const { slot, date, replacesCellId } = params;

  const [item, setItem] = useState<FoodItem>(params.item);
  const addEntry = useFoodLogStore((s) => s.addEntry);

  // Whole foods carry no portions in search results — only the detail endpoint
  // has them. Fetch on open so the picker can offer "1 medium" instead of just
  // grams. Non-throwing: a failure leaves the grams-only picker, which still works.
  useEffect(() => {
    let active = true;
    void loadFoodPortions(params.item).then((withPortions) => {
      if (active) setItem(withPortions);
    });
    return () => {
      active = false;
    };
  }, [params.item]);

  const options = useMemo(() => servingOptions(item), [item]);
  const [servingIndex, setServingIndex] = useState(0);
  const [qty, setQty] = useState(1);

  // A late-arriving portion list reorders the options, so re-anchor on the first
  // (most representative) one rather than leaving a stale index selected.
  useEffect(() => {
    setServingIndex(0);
  }, [options]);

  const serving: FoodServing = options[servingIndex] ?? options[0];
  // Grams are counted in tens: nobody logs a yogurt 1 gram at a time.
  const step = serving.label === 'g' ? 10 : 1;
  const nutrition = roundNutrition(nutritionForServing(item, serving, qty));
  const grams = totalGrams(serving, qty);

  const handleLog = () => {
    addEntry({
      date,
      slot,
      displayName: item.name,
      brand: item.brand,
      source: item.source,
      sourceId: item.sourceId,
      barcode: item.barcode,
      servingQty: qty,
      servingLabel: serving.label,
      // 0 means "unweighable" — store it as absent so recentToFoodItem takes
      // the perServing branch when this entry is re-logged later.
      gramsPerServing: serving.grams > 0 ? serving.grams : undefined,
      nutrition,
      replacesCellId,
    });
    toast.show({ message: `Logged ${item.name}`, tone: 'success' });
    // Back past the search screen to the day — logging is done, and leaving the
    // search results on the stack would strand the user mid-flow.
    navigation.navigate('Tabs', { screen: 'Log' });
  };

  return (
    <Screen scroll glass headerTitle="Log food">
      <Header
        eyebrow={`${SLOT_LABEL[slot]} · ${date}`}
        title={item.name}
        subtitle={item.brand}
        trailing={
          <IconButton
            icon="close"
            onPress={() => navigation.goBack()}
            variant="tonal"
            size={20}
            accessibilityLabel="Close"
          />
        }
      />

      <GlassSurface variant="hero" pad={t.spacing.lg}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.spacing.sm }}>
          <Text variant="display" tabularNums>
            {nutrition.calories}
          </Text>
          <Text variant="body" tone="secondary" style={{ paddingBottom: 6 }}>
            kcal
          </Text>
          {grams > 0 ? (
            <Text variant="caption" tone="tertiary" tabularNums style={{ marginLeft: 'auto', paddingBottom: 8 }}>
              {Math.round(grams)} g
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: t.spacing.md, marginTop: t.spacing.md }}>
          {[
            { label: 'Protein', value: nutrition.proteinG },
            { label: 'Carbs', value: nutrition.carbsG },
            { label: 'Fat', value: nutrition.fatG },
          ].map((m) => (
            <View key={m.label} style={{ flex: 1 }}>
              <Text variant="micro" tone="tertiary">
                {m.label}
              </Text>
              <Text variant="bodyLg" weight="semibold" tabularNums>
                {m.value}g
              </Text>
            </View>
          ))}
        </View>
      </GlassSurface>

      <SectionHeader title="Serving" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
        {options.map((option, index) => {
          const selected = index === servingIndex;
          return (
            <Pressable
              key={`${option.label}:${option.grams}`}
              onPress={() => {
                setServingIndex(index);
                setQty(option.label === 'g' ? 100 : 1);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option.label}, ${option.grams} grams each`}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: t.spacing.md,
                borderRadius: t.radius.md,
                borderWidth: 1,
                borderColor: selected ? t.palette.primary : t.palette.border,
                backgroundColor: selected
                  ? t.palette.primary
                  : pressed
                  ? t.palette.surfaceMuted
                  : 'transparent',
              })}
            >
              <Text
                variant="small"
                weight="medium"
                style={{ color: selected ? t.palette.primaryContrast : t.palette.textPrimary }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionHeader title="How many" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <Stepper
          value={qty}
          onChange={setQty}
          min={step}
          max={2000}
          step={step}
          unit={serving.label}
        />
      </View>

      {!item.per100g && !item.perServing ? (
        <Text variant="caption" tone="tertiary" style={{ marginTop: t.spacing.md }}>
          This food has no nutrition data, so it will log as 0 calories.
        </Text>
      ) : null}

      <Button
        label={`Add to ${SLOT_LABEL[slot].toLowerCase()}`}
        icon="check"
        onPress={handleLog}
        size="lg"
        fullWidth
        style={{ marginTop: t.spacing.xl }}
      />
    </Screen>
  );
}
