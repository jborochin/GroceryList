// Section order for the grocery list and the icon shown per category header.
// Shared between GroceryListScreen (section grouping) and EditItemSheet (the
// category picker) so the two never drift out of sync.
export const CATEGORY_ORDER = [
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

export const CATEGORY_ICON: Record<string, string> = {
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
