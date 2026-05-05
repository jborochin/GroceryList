import React, { useMemo, useState } from 'react';
import { SectionList, Share, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePantryStore } from '../store/usePantryStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';
import { aggregate } from '../utils/ingredientAggregator';
import { applyPantry } from '../utils/pantryDeduction';
import { estimatePrices } from '../utils/priceEstimator';
import { formatEntry } from '../utils/formatters';
import { EmptyState } from '../components/EmptyState';
import { GroceryItemRow } from '../components/GroceryItemRow';
import { PriceOverrideSheet } from '../components/PriceOverrideSheet';
import { GroceryItem } from '../types';
import { useAppTheme } from '../theme/tokens';
import {
  Button,
  Header,
  IconButton,
  ProgressBar,
  Surface,
  TAB_BAR_SPACE,
  Text,
} from '../components/ui';
import { haptics } from '../utils/haptics';

const CATEGORY_ORDER = [
  'Produce',
  'Protein',
  'Dairy',
  'Bakery',
  'Frozen',
  'Pantry',
  'Condiments/Oils',
  'Spices',
  'Beverages',
  'Other',
];

const CATEGORY_ICON: Record<string, string> = {
  Produce: 'leaf',
  Protein: 'food-steak',
  Dairy: 'cheese',
  Bakery: 'bread-slice',
  Frozen: 'snowflake',
  Pantry: 'silo',
  'Condiments/Oils': 'bottle-tonic',
  Spices: 'shaker-outline',
  Beverages: 'cup',
  Other: 'dots-horizontal',
};

export function GroceryListScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const recipes = useRecipeStore((s) => s.recipes);
  const plan = useMealPlanStore((s) => s.entries);
  const pantry = usePantryStore((s) => s.items);
  const overrides = usePriceOverrideStore((s) => s.overrides);
  const setOverride = usePriceOverrideStore((s) => s.setOverride);
  const removeOverride = usePriceOverrideStore((s) => s.removeOverride);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [priceTarget, setPriceTarget] = useState<GroceryItem | null>(null);

  const priced = useMemo(() => {
    const agg = aggregate(plan, recipes);
    const withPantry = applyPantry(agg, pantry);
    return estimatePrices(withPantry, overrides);
  }, [plan, recipes, pantry, overrides]);

  const sections = useMemo(() => {
    const byCat = new Map<string, GroceryItem[]>();
    for (const item of priced.items) {
      const arr = byCat.get(item.category) ?? [];
      arr.push(item);
      byCat.set(item.category, arr);
    }
    return [...byCat.entries()]
      .sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a[0]);
        const bi = CATEGORY_ORDER.indexOf(b[0]);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
      .map(([title, data]) => ({ title, data }));
  }, [priced.items]);

  const checkedCount = useMemo(
    () => priced.items.reduce((acc, item) => acc + (checked[item.name] ? 1 : 0), 0),
    [priced.items, checked]
  );

  const remainingTotal = useMemo(() => {
    let sum = 0;
    for (const item of priced.items) {
      if (!checked[item.name] && item.estimatedPrice !== undefined) {
        sum += item.estimatedPrice;
      }
    }
    return sum;
  }, [priced.items, checked]);

  const toggle = (name: string) => {
    haptics.selection();
    setChecked((c) => ({ ...c, [name]: !c[name] }));
  };

  const handleShare = async () => {
    haptics.tap();
    const lines: string[] = [`Grocery list — est. $${priced.total.toFixed(2)}`, ''];
    for (const section of sections) {
      lines.push(section.title.toUpperCase());
      for (const item of section.data) {
        const qty = item.entries.map((e) => formatEntry(e.quantity, e.unit)).join(' + ');
        const price = item.estimatedPrice !== undefined ? ` ($${item.estimatedPrice.toFixed(2)})` : '';
        lines.push(`- ${item.displayName}: ${qty}${price}`);
      }
      lines.push('');
    }
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // user cancelled
    }
  };

  const overrideForTarget = priceTarget ? overrides[priceTarget.name] : undefined;
  const initialPrice = overrideForTarget ? String(overrideForTarget.pricePerUnit) : '';
  const initialUnit = overrideForTarget
    ? overrideForTarget.unit
    : priceTarget?.entries[0]?.unit ?? 'each';

  const empty = plan.length === 0 || priced.items.length === 0;
  const itemCount = priced.items.length;
  const progress = itemCount === 0 ? 0 : checkedCount / itemCount;

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      {empty ? (
        <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: TAB_BAR_SPACE }}>
          {plan.length === 0 ? (
            <EmptyState
              icon="cart-outline"
              title="Nothing to buy yet"
              subtitle="Add recipes to this week in the Week tab to generate a grocery list."
            />
          ) : (
            <EmptyState
              icon="cart-check"
              title="You're all set"
              subtitle="Your pantry already covers everything in this week's plan."
            />
          )}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.name}
          contentContainerStyle={{
            paddingTop: insets.top,
            paddingHorizontal: 16,
            paddingBottom: TAB_BAR_SPACE,
          }}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Hero
              total={priced.total}
              remaining={remainingTotal}
              itemCount={itemCount}
              checkedCount={checkedCount}
              unestimated={priced.unestimatedCount}
              progress={progress}
              onShare={handleShare}
            />
          }
          renderSectionHeader={({ section }) => (
            <SectionHeader title={section.title} count={section.data.length} />
          )}
          renderItem={({ item, index }) => (
            <GroceryItemRow
              item={item}
              index={index}
              checked={!!checked[item.name]}
              onToggle={() => toggle(item.name)}
              onEditPrice={() => {
                haptics.tap();
                setPriceTarget(item);
              }}
            />
          )}
          renderSectionFooter={() => <View style={{ height: 14 }} />}
        />
      )}

      <PriceOverrideSheet
        item={priceTarget}
        initialPrice={initialPrice}
        initialUnit={initialUnit}
        onSave={(price, unit) => {
          if (!priceTarget) return;
          setOverride(priceTarget.name, price, unit);
          setPriceTarget(null);
        }}
        onClear={() => {
          if (!priceTarget) return;
          removeOverride(priceTarget.name);
          setPriceTarget(null);
        }}
        onClose={() => setPriceTarget(null)}
      />
    </View>
  );
}

interface HeroProps {
  total: number;
  remaining: number;
  itemCount: number;
  checkedCount: number;
  unestimated: number;
  progress: number;
  onShare: () => void;
}

function Hero({
  total,
  remaining,
  itemCount,
  checkedCount,
  unestimated,
  progress,
  onShare,
}: HeroProps) {
  const t = useAppTheme();
  const showRemaining = checkedCount > 0 && remaining !== total;

  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ marginBottom: 8 }}>
      <Header
        eyebrow="This week's list"
        title="Grocery"
        trailing={<IconButton icon="export-variant" onPress={onShare} variant="tonal" />}
      />

      <Surface
        variant="flat"
        pad={20}
        style={{ backgroundColor: t.palette.primary, marginBottom: 12 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text
              variant="eyebrow"
              style={{ color: t.palette.primaryContrast, opacity: 0.7, marginBottom: 6 }}
            >
              Estimated total
            </Text>
            <Text
              variant="hero"
              tabularNums
              style={{ color: t.palette.primaryContrast }}
            >
              ${total.toFixed(2)}
            </Text>
            {showRemaining ? (
              <Animated.View entering={FadeInDown.duration(220)}>
                <Text
                  variant="caption"
                  tabularNums
                  style={{ color: t.palette.primaryContrast, opacity: 0.7, marginTop: 2 }}
                >
                  ${remaining.toFixed(2)} remaining
                </Text>
              </Animated.View>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text
              variant="caption"
              tabularNums
              style={{ color: t.palette.primaryContrast, opacity: 0.85 }}
            >
              {checkedCount} / {itemCount}
            </Text>
            <Text
              variant="caption"
              style={{ color: t.palette.primaryContrast, opacity: 0.6 }}
            >
              checked off
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 16 }}>
          <ProgressBar
            progress={progress}
            color={t.palette.primaryContrast}
            trackColor="rgba(255,255,255,0.18)"
            height={6}
          />
        </View>
      </Surface>

      {unestimated > 0 ? (
        <Surface variant="outlined" pad={12} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="information-outline" size={16} color={t.palette.warning} />
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              {unestimated} {unestimated === 1 ? 'item is' : 'items are'} unpriced — tap a price chip to set one.
            </Text>
          </View>
        </Surface>
      ) : null}
    </Animated.View>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  const t = useAppTheme();
  const iconName = CATEGORY_ICON[title] ?? 'tag-outline';
  return (
    <Animated.View
      entering={FadeInDown.duration(280).springify().damping(20)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 14,
        marginBottom: 8,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: t.palette.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={iconName} size={14} color={t.palette.primarySoftText} />
      </View>
      <Text variant="title">{title}</Text>
      <Text variant="caption" tone="tertiary" tabularNums>
        {count}
      </Text>
    </Animated.View>
  );
}
