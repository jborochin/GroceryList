// Generates the MealFlow brand assets (app icon, Android adaptive icon, splash
// icon, favicon) from a vector recreation of the brand mark: an emerald rounded
// square containing a white calendar with an orange header + binder rings and a
// crossed fork & spoon. Re-run with `npm run brand:assets` after editing.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets');

const GREEN_TOP = '#2ECC71';
const GREEN_BOTTOM = '#24B266';
const ORANGE = '#E67E22';
const SLATE = '#34495E';
const WHITE = '#FFFFFF';

// The mark itself (calendar + rings + cutlery), drawn on a 1024×1024 canvas.
// Kept separate from the background square so the Android adaptive icon can
// render it alone on transparency.
function markGroup() {
  const fork = `
    <g transform="translate(512,625) scale(0.85) rotate(-28)">
      <rect x="-64" y="-240" width="20" height="130" rx="10" fill="${ORANGE}" />
      <rect x="-28" y="-240" width="20" height="130" rx="10" fill="${ORANGE}" />
      <rect x="8"   y="-240" width="20" height="130" rx="10" fill="${ORANGE}" />
      <rect x="44"  y="-240" width="20" height="130" rx="10" fill="${ORANGE}" />
      <rect x="-64" y="-150" width="128" height="66" rx="22" fill="${ORANGE}" />
      <rect x="-17" y="-140" width="34" height="370" rx="17" fill="${ORANGE}" />
    </g>`;
  const spoon = `
    <g transform="translate(512,625) scale(0.85) rotate(28)">
      <ellipse cx="0" cy="-165" rx="72" ry="96" fill="${ORANGE}" />
      <rect x="-17" y="-110" width="34" height="340" rx="17" fill="${ORANGE}" />
    </g>`;
  return `
  <g id="mark">
    <!-- calendar body -->
    <rect x="212" y="280" width="600" height="530" rx="48" fill="${WHITE}" />
    <!-- orange header band (top corners rounded to match the body) -->
    <path d="M212,392 L212,328 Q212,280 260,280 L764,280 Q812,280 812,328 L812,392 Z" fill="${ORANGE}" />
    <!-- binder rings punching above the header -->
    <rect x="392" y="190" width="40" height="150" rx="20" fill="${WHITE}" />
    <rect x="592" y="190" width="40" height="150" rx="20" fill="${WHITE}" />
    <!-- sparse date-grid squares -->
    <rect x="262" y="470" width="60" height="60" rx="14" fill="${SLATE}" />
    <rect x="262" y="680" width="60" height="60" rx="14" fill="${SLATE}" />
    <rect x="702" y="470" width="60" height="60" rx="14" fill="${SLATE}" />
    <rect x="702" y="680" width="60" height="60" rx="14" fill="${SLATE}" />
    <!-- crossed cutlery -->
    ${fork}
    ${spoon}
  </g>`;
}

function iconSvg({ withBackground, markScale = 1 }) {
  const pad = (1024 * (1 - markScale)) / 2;
  const background = withBackground
    ? `<rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bgGrad)" />`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${GREEN_TOP}" />
      <stop offset="100%" stop-color="${GREEN_BOTTOM}" />
    </linearGradient>
  </defs>
  ${background}
  <g transform="translate(${pad},${pad}) scale(${markScale})">
    ${markGroup()}
  </g>
</svg>`;
}

async function render(svg, size, file) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(OUT, file));
  console.log(`wrote assets/${file} (${size}×${size})`);
}

mkdirSync(OUT, { recursive: true });

// Full icon: mark + emerald rounded square, opaque within the square.
await render(iconSvg({ withBackground: true }), 1024, 'icon.png');
// Adaptive foreground: mark only, transparent, shrunk into the Android safe
// zone (inner ~66% circle); pairs with backgroundColor #2ECC71 in app.json.
await render(iconSvg({ withBackground: false, markScale: 0.62 }), 1024, 'adaptive-icon.png');
// Splash: the rounded-square mark centered on transparency (app.json supplies
// the near-white backgroundColor).
await render(iconSvg({ withBackground: true }), 512, 'splash-icon.png');
// Web favicon.
await render(iconSvg({ withBackground: true }), 48, 'favicon.png');
