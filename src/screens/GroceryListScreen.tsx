import React, { useEffect, useMemo, useState } from 'react';
import { SectionList, Share, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';

const AnimatedSectionList = Animated.createAnimatedComponent(
  SectionList as new () => SectionList<GroceryItem, { title: string; data: GroceryItem[] }>
);
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePantryStore } from '../store/usePantryStore';
import { useManualItemStore } from '../store/useManualItemStore';
import { useDismissedItemStore } from '../store/useDismissedItemStore';
import { usePriceOverrideStore } from '../store/usePriceOverrideStore';
import { useMealScheduleStore } from '../store/useMealScheduleStore';
import { aggregate } from '../utils/ingredientAggregator';
import { applyPantry } from '../utils/pantryDeduction';
import { mergeManualItems } from '../utils/mergeManualItems';
import { roundToPurchasable } from '../utils/purchaseRounding';
import { estimatePrices } from '../utils/priceEstimator';
import { normalizeName } from '../utils/normalizeName';
import { weekLabel } from '../utils/planningWeek';
import { formatEntry } from '../utils/formatters';
import { confirm } from '../utils/confirm';
import { EmptyState } from '../components/EmptyState';
import { GroceryItemRow } from '../components/GroceryItemRow';
import { AddItemSheet } from '../components/AddItemSheet';
import { PriceOverrideSheet } from '../components/PriceOverrideSheet';
import { CompletionBurst } from '../components/animations/CompletionBurst';
import { useToast } from '../components/ui';
import { GroceryItem } from '../types';
import { useAppTheme } from '../theme/tokens';
import {
  Button,
  CollapsingHeader,
  CountUpText,
  GlassSurface,
  Header,
  IconButton,
  ProgressBar,
  Surface,
  SwipeRow,
  TAB_BAR_SPACE,
  Text,
} from '../components/ui';
import { useParallax } from '../components/ui/ParallaxContext';
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
  Checked: 'check-circle-outline',
};

function buildCategorySections(items: GroceryItem[]) {
  const byCat = new Map<string, GroceryItem[]>();
  for (const item of items) {
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
}

export function GroceryListScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const parallax = useParallax();
  const toast = useToast();
  const recipes = useRecipeStore((s) => s.recipes);
  const plan = useMealPlanStore((s) => s.entries);
  const pantry = usePantryStore((s) => s.items);
  const manualItems = useManualItemStore((s) => s.items);
  const addManualItem = useManualItemStore((s) => s.addItem);
  const removeManualItem = useManualItemStore((s) => s.removeItem);
  const clearManualItems = useManualItemStore((s) => s.clearAll);
  const dismissedNames = useDismissedItemStore((s) => s.names);
  const dismiss = useDismissedItemStore((s) => s.dismiss);
  const dismissMany = useDismissedItemStore((s) => s.dismissMany);
  const prune = useDismissedItemStore((s) => s.prune);
  const overrides = usePriceOverrideStore((s) => s.overrides);
  const setOverride = usePriceOverrideStore((s) => s.setOverride);
  const removeOverride = usePriceOverrideStore((s) => s.removeOverride);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [priceTarget, setPriceTarget] = useState<GroceryItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [burstAt, setBurstAt] = useState(0);
  const completedRef = React.useRef(false);

  const priced = useMemo(() => {
    const agg = aggregate(plan, recipes);
    const withPantry = applyPantry(agg, pantry);
    const withManual = mergeManualItems(withPantry, manualItems);
    // Round each item to what the store actually sells (whole avocados, a head of broccoli)
    // before pricing, so the total reflects the real purchase.
    const purchasable = roundToPurchasable(withManual);
    return estimatePrices(purchasable, overrides);
  }, [plan, recipes, pantry, manualItems, overrides]);

  // Items the user has swiped away are filtered out of the computed list, and the
  // displayed totals are re-derived from what remains.
  const dismissed = useMemo(() => new Set(dismissedNames), [dismissedNames]);
  const visible = useMemo(() => {
    const items = priced.items.filter((i) => !dismissed.has(i.name));
    const total = items.reduce((s, i) => s + (i.estimatedPrice ?? 0), 0);
    const unestimated = items.filter((i) => i.hasPriceGap && i.estimatedPrice === undefined).length;
    return { items, total, unestimated };
  }, [priced.items, dismissed]);

  // Self-clean: drop dismissals whose item is no longer in the computed list (e.g. its
  // recipe was removed), so the same item reappears if it comes back later.
  useEffect(() => {
    prune(priced.items.map((i) => i.name));
  }, [priced.items, prune]);

  const handleDelete = (item: GroceryItem) => {
    // Remove any manual contribution outright; hide any recipe-derived remainder.
    for (const m of manualItems) {
      if (normalizeName(m.name) === item.name) removeManualItem(m.id);
    }
    dismiss(item.name);
    toast.show({ message: `Removed ${item.displayName}`, tone: 'neutral' });
  };

  // Same semantics as swiping every row away: manual items are deleted outright,
  // recipe-derived items are dismissed (and self-heal when the plan changes).
  const handleClearList = async () => {
    haptics.tap();
    const ok = await confirm({
      title: 'Clear grocery list?',
      message: 'All items will be removed until your plan or recipes change.',
      confirmLabel: 'Clear',
      destructive: true,
    });
    if (!ok) return;
    dismissMany(visible.items.map((i) => i.name));
    clearManualItems();
    setChecked({});
    toast.show({ message: 'List cleared', tone: 'neutral' });
  };

  // Checked-off items sink out of their category into a single section at the
  // bottom of the list, so what's left to grab stays at the top.
  const sections = useMemo(() => {
    const remaining = visible.items.filter((i) => !checked[i.name]);
    const done = visible.items.filter((i) => checked[i.name]);
    const secs = buildCategorySections(remaining);
    if (done.length > 0) secs.push({ title: 'Checked', data: done });
    return secs;
  }, [visible.items, checked]);

  const checkedCount = useMemo(
    () => visible.items.reduce((acc, item) => acc + (checked[item.name] ? 1 : 0), 0),
    [visible.items, checked]
  );

  const remainingTotal = useMemo(() => {
    let sum = 0;
    for (const item of visible.items) {
      if (!checked[item.name] && item.estimatedPrice !== undefined) {
        sum += item.estimatedPrice;
      }
    }
    return sum;
  }, [visible.items, checked]);

  const toggle = (name: string) => {
    haptics.selection();
    setChecked((c) => ({ ...c, [name]: !c[name] }));
  };

  // Fire completion burst the moment all items become checked.
  useEffect(() => {
    if (visible.items.length === 0) {
      completedRef.current = false;
      return;
    }
    const allChecked = visible.items.every((item) => checked[item.name]);
    if (allChecked && !completedRef.current) {
      completedRef.current = true;
      setBurstAt(Date.now());
      haptics.success();
      toast.show({ message: 'Trip complete — nice work.', tone: 'success' });
    } else if (!allChecked && completedRef.current) {
      completedRef.current = false;
    }
  }, [visible.items, checked, toast]);

  const handleShare = async () => {
    haptics.tap();
    const lines: string[] = [`Grocery list — est. $${visible.total.toFixed(2)}`, ''];
    // Share by category regardless of check state, so the exported list is stable.
    for (const section of buildCategorySections(visible.items)) {
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

  const empty = visible.items.length === 0;
  const itemCount = visible.items.length;
  const progress = itemCount === 0 ? 0 : checkedCount / itemCount;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
      if (parallax) parallax.value = e.contentOffset.y;
    },
  });

  return (
    <View style={{ flex: 1 }}>
      {empty ? (
        <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: TAB_BAR_SPACE }}>
          <EmptyState
            icon={plan.length === 0 ? 'cart-outline' : 'cart-check'}
            title={plan.length === 0 ? 'Nothing to buy yet' : "You're all set"}
            subtitle={
              plan.length === 0
                ? 'Add recipes to this week in the Week tab, or add a grocery item manually.'
                : "Your pantry already covers everything in this week's plan. Need something else? Add it manually."
            }
          >
            <Button
              label="Add item"
              icon="plus"
              variant="primary"
              onPress={() => {
                haptics.tap();
                setAddOpen(true);
              }}
            />
          </EmptyState>
        </View>
      ) : (
        <AnimatedSectionList
          sections={sections}
          keyExtractor={(item) => (item as GroceryItem).name}
          contentContainerStyle={{
            paddingTop: insets.top,
            paddingHorizontal: 16,
            paddingBottom: TAB_BAR_SPACE,
          }}
          stickySectionHeadersEnabled={true}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={
            <Hero
              total={visible.total}
              remaining={remainingTotal}
              itemCount={itemCount}
              checkedCount={checkedCount}
              unestimated={visible.unestimated}
              progress={progress}
              onShare={handleShare}
              onAdd={() => {
                haptics.tap();
                setAddOpen(true);
              }}
              onClear={handleClearList}
            />
          }
          renderSectionHeader={({ section }: { section: { title: string; data: GroceryItem[] } }) => (
            <SectionHeader title={section.title} count={section.data.length} />
          )}
          renderItem={({ item, index }: { item: GroceryItem; index: number }) => (
            <SwipeRow icon="close" onDelete={() => handleDelete(item)}>
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
            </SwipeRow>
          )}
          renderSectionFooter={() => <View style={{ height: 14 }} />}
        />
      )}

      {burstAt > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: insets.top + 80,
            height: 200,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CompletionBurst trigger={burstAt} />
        </View>
      ) : null}

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

      <AddItemSheet
        visible={addOpen}
        onAdd={(name, quantity, unit) => {
          addManualItem({ name, quantity, unit });
          setAddOpen(false);
        }}
        onClose={() => setAddOpen(false)}
      />
      {!empty ? <CollapsingHeader title="Grocery" scrollY={scrollY} /> : null}
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
  onAdd: () => void;
  onClear: () => void;
}

function Hero({
  total,
  remaining,
  itemCount,
  checkedCount,
  unestimated,
  progress,
  onShare,
  onAdd,
  onClear,
}: HeroProps) {
  const t = useAppTheme();
  const showRemaining = checkedCount > 0 && remaining !== total;
  // The list is computed from the plan entries, which are projected from the
  // week selected in the Week tab — reflect that week here.
  const selectedWeekStart = useMealScheduleStore((s) => s.selectedWeekStart);
  const label = weekLabel(selectedWeekStart);
  // "This week's list" / "Next week's list", but a dated label stands alone.
  const eyebrow = label.startsWith('Week of') ? label : `${label}'s list`;

  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ marginBottom: 8 }}>
      <Header
        eyebrow={eyebrow}
        title="Grocery"
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <IconButton icon="plus" onPress={onAdd} variant="tonal" accessibilityLabel="Add item" />
            <IconButton icon="export-variant" onPress={onShare} variant="tonal" />
            <IconButton
              icon="delete-sweep-outline"
              onPress={onClear}
              variant="tonal"
              accessibilityLabel="Clear list"
            />
          </View>
        }
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
            <CountUpText
              value={total}
              prefix="$"
              decimals={2}
              variant="hero"
              style={{ color: t.palette.primaryContrast }}
            />
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
        <GlassSurface variant="content" pad={12} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="information-outline" size={16} color={t.palette.warning} />
            <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
              {unestimated} {unestimated === 1 ? 'item is' : 'items are'} unpriced — tap a price chip to set one.
            </Text>
          </View>
        </GlassSurface>
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
        marginTop: 14,
        marginBottom: 8,
      }}
    >
      <GlassSurface variant="hero" radius={t.radius.md} pad={t.spacing.sm}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
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
        </View>
      </GlassSurface>
    </Animated.View>
  );
}
