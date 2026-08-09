const UNIT_LABELS: Record<string, { singular: string; plural?: string }> = {
  tsp: { singular: 'tsp' },
  tbsp: { singular: 'tbsp' },
  fl_oz: { singular: 'fl oz' },
  cup: { singular: 'cup', plural: 'cups' },
  pint: { singular: 'pint', plural: 'pints' },
  quart: { singular: 'quart', plural: 'quarts' },
  gallon: { singular: 'gallon', plural: 'gallons' },
  ml: { singular: 'ml' },
  l: { singular: 'L' },
  g: { singular: 'g' },
  kg: { singular: 'kg' },
  oz: { singular: 'oz' },
  lb: { singular: 'lb' },
  each: { singular: '' },
  slice: { singular: 'slice', plural: 'slices' },
  clove: { singular: 'clove', plural: 'cloves' },
  piece: { singular: 'piece', plural: 'pieces' },
  can: { singular: 'can', plural: 'cans' },
  bottle: { singular: 'bottle', plural: 'bottles' },
  jar: { singular: 'jar', plural: 'jars' },
  package: { singular: 'pkg' },
  bunch: { singular: 'bunch', plural: 'bunches' },
  head: { singular: 'head', plural: 'heads' },
  dash: { singular: 'dash', plural: 'dashes' },
  pinch: { singular: 'pinch', plural: 'pinches' },
  scoop: { singular: 'scoop', plural: 'scoops' },
  block: { singular: 'block', plural: 'blocks' },
  bag: { singular: 'bag', plural: 'bags' },
  box: { singular: 'box', plural: 'boxes' },
  loaf: { singular: 'loaf', plural: 'loaves' },
  stick: { singular: 'stick', plural: 'sticks' },
};

export function formatQuantity(qty: number): string {
  if (qty === 0) return '0';
  if (qty < 0.1) return qty.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (qty < 1) {
    // Try common fractions
    const frac = toFractionString(qty);
    if (frac) return frac;
    return qty.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (qty < 10) {
    const whole = Math.floor(qty);
    const rem = qty - whole;
    if (rem === 0) return String(whole);
    const frac = toFractionString(rem);
    if (frac) return `${whole} ${frac}`;
    return qty.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  return qty.toFixed(1).replace(/\.0$/, '');
}

function toFractionString(n: number): string | null {
  const candidates: Array<[number, string]> = [
    [0.125, '1/8'],
    [0.25, '1/4'],
    [1 / 3, '1/3'],
    [0.375, '3/8'],
    [0.5, '1/2'],
    [0.625, '5/8'],
    [2 / 3, '2/3'],
    [0.75, '3/4'],
    [0.875, '7/8'],
  ];
  for (const [value, label] of candidates) {
    if (Math.abs(n - value) < 0.03) return label;
  }
  return null;
}

export function formatUnit(qty: number, unit: string): string {
  const label = UNIT_LABELS[unit];
  if (!label) return unit;
  if (label.plural && qty !== 1) return label.plural;
  return label.singular;
}

export function formatEntry(qty: number, unit: string): string {
  const q = formatQuantity(qty);
  const u = formatUnit(qty, unit);
  return u ? `${q} ${u}` : q;
}

export function formatPrice(p: number | undefined): string {
  if (p === undefined) return '—';
  return `$${p.toFixed(2)}`;
}
