import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FoodSearchError, searchFoods } from '../lib/foodSearch';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useCustomFoodStore } from '../store/useCustomFoodStore';
import { recentFoods, recentToFoodItem, RecentFood } from '../utils/recentFoods';
import { debounce } from '../utils/debounce';
import { CustomFood, FoodItem } from '../types';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import { EmptyState } from '../components/EmptyState';
import {
  Button,
  Header,
  IconButton,
  Input,
  Screen,
  SectionHeader,
  SegmentedControl,
  Surface,
  Text,
} from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'recent' | 'search' | 'mine';

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Find something to log: recents, the online database, or your own foods.
 *
 * Opens on Recents rather than an empty search box — most logging is repetition,
 * and the fastest path to yesterday's breakfast should not involve typing.
 */
export function FoodSearchScreen() {
  const t = useAppTheme();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'FoodSearch'>>();
  const { slot, date, replacesCellId } = params;

  const entries = useFoodLogStore((s) => s.entries);
  const customFoods = useCustomFoodStore((s) => s.foods);

  const [tab, setTab] = useState<Tab>('recent');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recents = useMemo(() => recentFoods(entries, 40), [entries]);

  const openLog = useCallback(
    (item: FoodItem) => {
      navigation.navigate('LogFood', { item, slot, date, replacesCellId });
    },
    [navigation, slot, date, replacesCellId]
  );

  // Guards against an older, slower response overwriting a newer one — the
  // classic search race. Compared by identity, so it survives repeat queries.
  const latestQuery = useRef('');

  const runSearch = useMemo(
    () =>
      debounce((q: string) => {
        latestQuery.current = q;
        if (q.trim().length < 2) {
          setResults([]);
          setLoading(false);
          return;
        }
        setError(null);
        void searchFoods(q)
          .then((foods) => {
            if (latestQuery.current !== q) return;
            setResults(foods);
          })
          .catch((err: unknown) => {
            if (latestQuery.current !== q) return;
            setResults([]);
            setError(
              err instanceof FoodSearchError && err.kind === 'not-configured'
                ? 'Food search is not set up on this build. You can still add a food manually.'
                : "Couldn't reach the food database. Check your connection and try again."
            );
          })
          .finally(() => {
            if (latestQuery.current === q) setLoading(false);
          });
      }, SEARCH_DEBOUNCE_MS),
    []
  );

  useEffect(() => {
    if (tab !== 'search') return;
    if (query.trim().length >= 2) setLoading(true);
    runSearch(query);
  }, [query, tab, runSearch]);

  const myFoods = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? customFoods.filter((f) => f.name.toLowerCase().includes(q))
      : customFoods;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [customFoods, query]);

  return (
    <Screen scroll glass headerTitle="Add food">
      <Header
        eyebrow={slot}
        title="Add food"
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

      <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.md }}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder="Search foods or brands"
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              if (v.trim().length >= 2 && tab === 'recent') setTab('search');
            }}
            leftIcon="magnify"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search foods"
          />
        </View>
        {/* Scanning needs a camera, which the web build does not have. */}
        {Platform.OS !== 'web' ? (
          <IconButton
            icon="barcode-scan"
            onPress={() => navigation.navigate('BarcodeScan', { slot, date, replacesCellId })}
            variant="tonal"
            size={22}
            accessibilityLabel="Scan a barcode"
          />
        ) : null}
      </View>

      <SegmentedControl<Tab>
        items={[
          { value: 'recent', label: 'Recent' },
          { value: 'search', label: 'Database' },
          { value: 'mine', label: 'My foods' },
        ]}
        value={tab}
        onChange={setTab}
        style={{ marginBottom: t.spacing.md }}
      />

      {tab === 'recent' ? (
        recents.length === 0 ? (
          <EmptyState
            icon="history"
            title="Nothing logged yet"
            subtitle="Foods you log will show up here so you can add them again in one tap."
          >
            <Button label="Search the database" icon="magnify" onPress={() => setTab('search')} />
          </EmptyState>
        ) : (
          <View style={{ gap: t.spacing.xs }}>
            {recents.map((recent) => (
              <RecentRow key={recent.key} recent={recent} onPress={() => openLog(recentToFoodItem(recent))} />
            ))}
          </View>
        )
      ) : null}

      {tab === 'search' ? (
        <>
          {loading ? (
            <View style={{ paddingVertical: t.spacing.xl, alignItems: 'center', gap: t.spacing.sm }}>
              <ActivityIndicator color={t.palette.primary} />
              <Text variant="small" tone="tertiary">
                Searching…
              </Text>
            </View>
          ) : null}

          {!loading && error ? (
            <Surface variant="outlined" pad={t.spacing.lg} style={{ gap: t.spacing.sm }}>
              <Text variant="body" tone="secondary">
                {error}
              </Text>
              <Button
                label="Add it manually"
                icon="pencil-plus"
                variant="tonal"
                size="sm"
                onPress={() =>
                  navigation.navigate('CustomFood', {
                    slot,
                    date,
                    replacesCellId,
                    prefillName: query.trim(),
                  })
                }
              />
            </Surface>
          ) : null}

          {!loading && !error && query.trim().length < 2 ? (
            <EmptyState
              icon="magnify"
              title="Search for a food"
              subtitle="Type a product or a plain food — “Chobani”, “banana”, “chicken breast”."
            />
          ) : null}

          {!loading && !error && query.trim().length >= 2 && results.length === 0 ? (
            <EmptyState
              icon="food-off-outline"
              title="No matches"
              subtitle={`Nothing in the database matches “${query.trim()}”.`}
            >
              <Button
                label="Add it manually"
                icon="pencil-plus"
                onPress={() =>
                  navigation.navigate('CustomFood', {
                    slot,
                    date,
                    replacesCellId,
                    prefillName: query.trim(),
                  })
                }
              />
            </EmptyState>
          ) : null}

          {!loading && results.length > 0 ? (
            <View style={{ gap: t.spacing.xs }}>
              {results.map((item) => (
                <FoodRow
                  key={`${item.source}:${item.sourceId}`}
                  title={item.name}
                  detail={item.brand}
                  calories={item.per100g?.calories}
                  caloriesUnit="per 100 g"
                  onPress={() => openLog(item)}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {tab === 'mine' ? (
        myFoods.length === 0 ? (
          <EmptyState
            icon="notebook-plus-outline"
            title="No custom foods"
            subtitle="Save a homemade dish or anything the database is missing, then reuse it any time."
          >
            <Button
              label="Create a food"
              icon="plus"
              onPress={() => navigation.navigate('CustomFood', { slot, date, replacesCellId })}
            />
          </EmptyState>
        ) : (
          <>
            <SectionHeader
              title="Your foods"
              count={myFoods.length}
              trailing={
                <Button
                  label="New"
                  icon="plus"
                  variant="tonal"
                  size="sm"
                  onPress={() => navigation.navigate('CustomFood', { slot, date, replacesCellId })}
                />
              }
            />
            <View style={{ gap: t.spacing.xs }}>
              {myFoods.map((food) => (
                <FoodRow
                  key={food.id}
                  title={food.name}
                  detail={food.brand}
                  calories={food.nutritionPerServing.calories}
                  caloriesUnit={`per ${food.servingLabel}`}
                  onPress={() =>
                    openLog(customFoodToItem(food))
                  }
                />
              ))}
            </View>
          </>
        )
      ) : null}
    </Screen>
  );
}

/**
 * A saved custom food → a loggable FoodItem.
 *
 * Its macros describe one serving, so a per-100g basis exists only when the user
 * supplied a weight. Without one it becomes a `perServing` food: still fully
 * loggable, just not convertible to grams.
 */
function customFoodToItem(food: CustomFood): FoodItem {
  const grams = food.gramsPerServing;
  const weighed = grams && grams > 0 ? grams : 0;
  return {
    source: 'custom',
    sourceId: food.id,
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    per100g:
      weighed > 0
        ? {
            calories: (food.nutritionPerServing.calories / weighed) * 100,
            proteinG: (food.nutritionPerServing.proteinG / weighed) * 100,
            carbsG: (food.nutritionPerServing.carbsG / weighed) * 100,
            fatG: (food.nutritionPerServing.fatG / weighed) * 100,
          }
        : undefined,
    perServing: weighed > 0 ? undefined : food.nutritionPerServing,
    servings: [{ label: food.servingLabel, grams: weighed }],
  };
}

interface FoodRowProps {
  title: string;
  detail?: string;
  calories?: number;
  caloriesUnit: string;
  onPress: () => void;
}

function FoodRowBase({ title, detail, calories, caloriesUnit, onPress }: FoodRowProps) {
  const t = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}${detail ? `, ${detail}` : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.sm,
        minHeight: 56,
        paddingHorizontal: t.spacing.md,
        paddingVertical: t.spacing.sm,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: t.palette.border,
        backgroundColor: pressed ? t.palette.surfaceMuted : t.palette.surface,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="medium" numberOfLines={2}>
          {title}
        </Text>
        {detail ? (
          <Text variant="micro" tone="tertiary" numberOfLines={1} style={{ marginTop: 1 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {calories !== undefined ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="body" weight="semibold" tabularNums>
            {Math.round(calories)}
          </Text>
          <Text variant="micro" tone="tertiary">
            {caloriesUnit}
          </Text>
        </View>
      ) : null}
      <Icon name="chevron-right" size={18} color={t.palette.textTertiary} />
    </Pressable>
  );
}

const FoodRow = React.memo(FoodRowBase);

function RecentRow({ recent, onPress }: { recent: RecentFood; onPress: () => void }) {
  const detail = [recent.brand, `${recent.servingQty} ${recent.servingLabel}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <FoodRow
      title={recent.displayName}
      detail={detail}
      calories={recent.nutrition.calories}
      caloriesUnit="kcal"
      onPress={onPress}
    />
  );
}
