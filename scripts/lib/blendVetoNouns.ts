/**
 * Single-ingredient nouns used to recognize multi-ingredient product bags.
 *
 * `scoreMatch` vetoes a candidate when a single-word search term's SKU description
 * names three or more OTHER entries from this list — the signature of a mixed bag
 * rather than the whole ingredient we asked for. See MIN_COOCCURRING_INGREDIENTS_TO_VETO
 * in krogerMatch.ts for why the threshold is 3 and not 2.
 *
 * WHY THIS IS A FROZEN LIST AND NOT DERIVED FROM priceDatabase.json:
 *
 * It used to be `Object.keys(priceDatabase).filter(k => !k.includes(' '))`. That made
 * every catalog addition a silent change to the matcher — each new single-word key
 * raised the odds of the veto firing, so the live-regression cases in
 * krogerMatch.test.ts (all tuned against a 172-key catalog) would quietly drift as the
 * catalog grew toward its intended size. Matching behavior should change when someone
 * decides to change it, not as a side effect of pricing a new ingredient.
 *
 * Freezing it also removes krogerMatch.ts's only JSON import, which is what lets the
 * matcher run unmodified inside a Deno edge function.
 *
 * This is a verbatim snapshot of the previously derived set. Adding a noun here makes
 * the veto MORE aggressive; removing one makes it less. Either way, re-run
 * `npx jest scripts/__tests__/krogerMatch.test.ts` — those cases are the record of
 * which live mismatches this veto exists to stop.
 */
export const BLEND_VETO_NOUNS: ReadonlySet<string> = new Set([
  'almond', 'apple', 'apricot', 'asparagus', 'avocado', 'bacon', 'bagel', 'banana',
  'basil', 'blueberry', 'bread', 'broccoli', 'butter', 'buttermilk', 'cabbage',
  'carrot', 'cashew', 'cauliflower', 'celery', 'chickpea', 'cilantro', 'cinnamon',
  'cod', 'corn', 'cornstarch', 'couscous', 'cucumber', 'cumin', 'edamame', 'egg',
  'eggplant', 'falafel', 'fennel', 'feta', 'fettuccine', 'flour', 'garlic', 'ginger',
  'granola', 'grape', 'ham', 'honey', 'hummus', 'jalapeno', 'kale', 'ketchup', 'lamb',
  'lemon', 'lentil', 'lettuce', 'lime', 'mayonnaise', 'milk', 'mozzarella', 'mushroom',
  'mustard', 'oat', 'olive', 'onion', 'orange', 'oregano', 'paneer', 'paprika',
  'parmesan', 'parsley', 'pasta', 'pecan', 'pineapple', 'pita', 'potato', 'pumpkin',
  'quinoa', 'raisin', 'rice', 'ricotta', 'romaine', 'salmon', 'salsa', 'salt',
  'sausage', 'shrimp', 'spaghetti', 'spinach', 'sriracha', 'strawberry', 'sugar',
  'tahini', 'tilapia', 'tofu', 'tomato', 'tortilla', 'tuna', 'turmeric', 'vinegar',
  'walnut', 'yogurt', 'zucchini',
]);
