import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCustomFoodStore } from '../store/useCustomFoodStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import { SLOT_LABEL } from '../components/log/weekDays';
import {
  Button,
  Header,
  IconButton,
  Input,
  Screen,
  SectionHeader,
  Text,
  useToast,
} from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Parses a number field, treating blank as 0 and junk as invalid. Macros are
// optional (people often know only the calories) but must be numbers if given.
function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Define a food by hand.
 *
 * Two ways in: "My foods → New" for a homemade dish, and the fallback when a
 * scanned barcode misses both databases — in which case the barcode rides along
 * so the same product resolves locally next time.
 */
export function CustomFoodScreen() {
  const t = useAppTheme();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const { params } = useRoute<RouteProp<RootStackParamList, 'CustomFood'>>();
  const { slot, date, replacesCellId, barcode, prefillName } = params ?? {};

  const addFood = useCustomFoodStore((s) => s.addFood);
  const addEntry = useFoodLogStore((s) => s.addEntry);

  const [name, setName] = useState(prefillName ?? '');
  const [brand, setBrand] = useState('');
  const [servingLabel, setServingLabel] = useState('serving');
  const [gramsPerServing, setGrams] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  // Validation runs on submit, not per keystroke — flagging "calories required"
  // while someone is still typing the name is noise, not help.
  const [submitted, setSubmitted] = useState(false);

  const parsedCalories = parseNumber(calories);
  const parsedProtein = parseNumber(protein);
  const parsedCarbs = parseNumber(carbs);
  const parsedFat = parseNumber(fat);
  const parsedGrams = parseNumber(gramsPerServing);

  const nameError = !name.trim() ? 'Give this food a name.' : undefined;
  const caloriesError =
    parsedCalories === null
      ? 'Calories must be a number.'
      : !calories.trim()
      ? 'Enter the calories for one serving.'
      : undefined;
  const macroError =
    parsedProtein === null || parsedCarbs === null || parsedFat === null
      ? 'Macros must be numbers.'
      : undefined;
  const gramsError = parsedGrams === null ? 'Weight must be a number.' : undefined;

  const canSave = !nameError && !caloriesError && !macroError && !gramsError;
  // A food logged straight from here needs a slot and date to land in.
  const willLog = Boolean(slot && date);

  const handleSave = () => {
    setSubmitted(true);
    if (!canSave) return;

    const nutritionPerServing = {
      calories: parsedCalories ?? 0,
      proteinG: parsedProtein ?? 0,
      carbsG: parsedCarbs ?? 0,
      fatG: parsedFat ?? 0,
    };
    const grams = parsedGrams && parsedGrams > 0 ? parsedGrams : undefined;

    const id = addFood({
      name: name.trim(),
      brand: brand.trim() || undefined,
      servingLabel: servingLabel.trim() || 'serving',
      gramsPerServing: grams,
      nutritionPerServing,
      barcode,
    });

    if (slot && date) {
      addEntry({
        date,
        slot,
        displayName: name.trim(),
        brand: brand.trim() || undefined,
        source: 'custom',
        sourceId: id,
        barcode,
        servingQty: 1,
        servingLabel: servingLabel.trim() || 'serving',
        gramsPerServing: grams,
        nutrition: nutritionPerServing,
        replacesCellId,
      });
      toast.show({ message: `Logged ${name.trim()}`, tone: 'success' });
      navigation.navigate('Tabs', { screen: 'Log' });
      return;
    }

    toast.show({ message: `Saved ${name.trim()}`, tone: 'success' });
    navigation.goBack();
  };

  return (
    <Screen scroll glass headerTitle="New food">
      <Header
        eyebrow={slot ? SLOT_LABEL[slot] : 'My foods'}
        title="New food"
        subtitle={
          barcode
            ? `Barcode ${barcode} isn't in the database — add it once and it's yours.`
            : 'Enter the nutrition from the label or recipe, for one serving.'
        }
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

      <Input
        label="Name"
        placeholder="e.g. Mum's lasagne"
        value={name}
        onChangeText={setName}
        error={submitted ? nameError : undefined}
        autoCapitalize="sentences"
      />
      <Input label="Brand (optional)" placeholder="e.g. Chobani" value={brand} onChangeText={setBrand} />

      <SectionHeader title="One serving" />
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            label="Called"
            placeholder="serving"
            value={servingLabel}
            onChangeText={setServingLabel}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Weight (g)"
            placeholder="optional"
            value={gramsPerServing}
            onChangeText={setGrams}
            keyboardType="numeric"
            error={submitted ? gramsError : undefined}
            helper="Lets you log part servings"
          />
        </View>
      </View>

      <SectionHeader title="Nutrition per serving" />
      <Input
        label="Calories"
        placeholder="0"
        value={calories}
        onChangeText={setCalories}
        keyboardType="numeric"
        error={submitted ? caloriesError : undefined}
      />
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input
            label="Protein (g)"
            placeholder="0"
            value={protein}
            onChangeText={setProtein}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Carbs (g)"
            placeholder="0"
            value={carbs}
            onChangeText={setCarbs}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Fat (g)"
            placeholder="0"
            value={fat}
            onChangeText={setFat}
            keyboardType="numeric"
          />
        </View>
      </View>
      {submitted && macroError ? (
        <Text variant="caption" tone="danger" style={{ marginTop: t.spacing.xs }}>
          {macroError}
        </Text>
      ) : null}

      <Button
        label={willLog ? 'Save and log it' : 'Save food'}
        icon="check"
        onPress={handleSave}
        size="lg"
        fullWidth
        style={{ marginTop: t.spacing.xl }}
      />
    </Screen>
  );
}
