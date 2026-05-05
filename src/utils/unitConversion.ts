import { UnitFamily } from '../types';

interface UnitDef {
  family: UnitFamily;
  toBase: number;
}

const UNIT_TABLE: Record<string, UnitDef> = {
  tsp: { family: 'volume', toBase: 1 },
  tbsp: { family: 'volume', toBase: 3 },
  fl_oz: { family: 'volume', toBase: 6 },
  cup: { family: 'volume', toBase: 48 },
  pint: { family: 'volume', toBase: 96 },
  quart: { family: 'volume', toBase: 192 },
  gallon: { family: 'volume', toBase: 768 },
  ml: { family: 'volume', toBase: 0.202884 },
  l: { family: 'volume', toBase: 202.884 },

  g: { family: 'weight', toBase: 1 },
  kg: { family: 'weight', toBase: 1000 },
  oz: { family: 'weight', toBase: 28.3495 },
  lb: { family: 'weight', toBase: 453.592 },

  each: { family: 'count', toBase: 1 },
  slice: { family: 'count', toBase: 1 },
  clove: { family: 'count', toBase: 1 },
  piece: { family: 'count', toBase: 1 },
  can: { family: 'count', toBase: 1 },
  bottle: { family: 'count', toBase: 1 },
  jar: { family: 'count', toBase: 1 },
  package: { family: 'count', toBase: 1 },
  bunch: { family: 'count', toBase: 1 },
  head: { family: 'count', toBase: 1 },
  dash: { family: 'count', toBase: 1 },
  pinch: { family: 'count', toBase: 1 },
};

export function getFamily(unit: string): UnitFamily | null {
  const def = UNIT_TABLE[unit];
  return def ? def.family : null;
}

export function isKnownUnit(unit: string): boolean {
  return unit in UNIT_TABLE;
}

/**
 * Convert qty from `fromUnit` to `toUnit`. Returns null if units live in different families.
 * For count family, only same-label conversions are permitted (returns null for e.g. "each" → "slice").
 */
export function convert(qty: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return qty;
  const from = UNIT_TABLE[fromUnit];
  const to = UNIT_TABLE[toUnit];
  if (!from || !to) return null;
  if (from.family !== to.family) return null;
  if (from.family === 'count' && fromUnit !== toUnit) return null;
  return (qty * from.toBase) / to.toBase;
}

/**
 * Pick a human-friendly display for a (qty, unit). Promotes smaller units to bigger ones
 * when the value crosses a threshold. Leaves unknown units untouched.
 */
export function prettyUnit(qty: number, unit: string): { quantity: number; unit: string } {
  const def = UNIT_TABLE[unit];
  if (!def) return { quantity: qty, unit };

  if (def.family === 'volume') {
    const tsp = qty * def.toBase;
    if (tsp >= 768) return { quantity: round(tsp / 768), unit: 'gallon' };
    if (tsp >= 192) return { quantity: round(tsp / 192), unit: 'quart' };
    if (tsp >= 48) return { quantity: round(tsp / 48), unit: 'cup' };
    if (tsp >= 3) return { quantity: round(tsp / 3), unit: 'tbsp' };
    return { quantity: round(tsp), unit: 'tsp' };
  }

  if (def.family === 'weight') {
    const g = qty * def.toBase;
    if (g >= 1000) return { quantity: round(g / 1000), unit: 'kg' };
    if (g >= 453.592) return { quantity: round(g / 453.592), unit: 'lb' };
    if (g >= 28.3495) return { quantity: round(g / 28.3495), unit: 'oz' };
    return { quantity: round(g), unit: 'g' };
  }

  return { quantity: round(qty), unit };
}

function round(n: number): number {
  if (n >= 10) return Math.round(n * 10) / 10;
  if (n >= 1) return Math.round(n * 100) / 100;
  return Math.round(n * 1000) / 1000;
}
