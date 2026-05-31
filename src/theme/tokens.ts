export interface Palette {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceMuted: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  primary: string;
  primaryContrast: string;
  primarySoft: string;
  primarySoftText: string;
  accent: string;
  accentContrast: string;
  accentSoft: string;
  accentSoftText: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  dangerSoftText: string;
  info: string;
  overlay: string;
  shadow: string;
  scrim: string;
  // Glass system
  glassThin: string;
  glassRegular: string;
  glassThick: string;
  rimLight: string;
  rimGround: string;
  ambienceA: string;
  ambienceB: string;
  ambienceC: string;
  blurTint: 'light' | 'dark' | 'default';
}

const light: Palette = {
  bg: '#FFFFFF',
  bgElevated: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F5F5',
  surfaceSunken: '#ECECEC',
  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.14)',
  textPrimary: '#0A0A0A',
  textSecondary: '#525252',
  textTertiary: '#A3A3A3',
  textInverse: '#FFFFFF',
  primary: '#0A0A0A',
  primaryContrast: '#FFFFFF',
  primarySoft: '#F0F0F0',
  primarySoftText: '#0A0A0A',
  accent: '#404040',
  accentContrast: '#FFFFFF',
  accentSoft: '#ECECEC',
  accentSoftText: '#1A1A1A',
  success: '#3F7A4D',
  successSoft: '#E9EFEA',
  warning: '#8A6A2C',
  warningSoft: '#F2EBD9',
  danger: '#A8362C',
  dangerSoft: '#F1DBD8',
  dangerSoftText: '#7E2018',
  info: '#404040',
  overlay: 'rgba(0,0,0,0.04)',
  shadow: 'rgba(0,0,0,0.08)',
  scrim: 'rgba(0,0,0,0.45)',
  glassThin: 'rgba(255,255,255,0.55)',
  glassRegular: 'rgba(255,255,255,0.70)',
  glassThick: 'rgba(255,255,255,0.85)',
  rimLight: 'rgba(255,255,255,0.65)',
  rimGround: 'rgba(0,0,0,0.06)',
  ambienceA: '#FFFFFF',
  ambienceB: '#F7F7F7',
  ambienceC: '#EFEFEF',
  blurTint: 'light',
};

// Single Liquid Glass field: glass surfaces are translucent white frosting over
// the charcoal→black radial backdrop, with high-contrast white text. This is the
// app's only rendered palette (see useAppTheme) regardless of OS color scheme.
const dark: Palette = {
  bg: '#000000',
  bgElevated: 'rgba(255,255,255,0.04)',
  surface: 'rgba(255,255,255,0.06)',
  surfaceMuted: 'rgba(255,255,255,0.10)',
  surfaceSunken: 'rgba(0,0,0,0.28)',
  border: 'rgba(255,255,255,0.12)',
  borderStrong: 'rgba(255,255,255,0.22)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.72)',
  textTertiary: 'rgba(255,255,255,0.48)',
  textInverse: '#0A0A0A',
  primary: '#FAFAFA',
  primaryContrast: '#0A0A0A',
  primarySoft: 'rgba(255,255,255,0.12)',
  primarySoftText: '#FFFFFF',
  accent: '#E5E5E5',
  accentContrast: '#0A0A0A',
  accentSoft: 'rgba(255,255,255,0.12)',
  accentSoftText: '#F5F5F5',
  success: '#7BB28B',
  successSoft: 'rgba(123,178,139,0.18)',
  warning: '#C99A4A',
  warningSoft: 'rgba(201,154,74,0.18)',
  danger: '#E16B5E',
  dangerSoft: 'rgba(225,107,94,0.18)',
  dangerSoftText: '#F2A399',
  info: '#E5E5E5',
  overlay: 'rgba(255,255,255,0.06)',
  shadow: 'rgba(0,0,0,0.6)',
  scrim: 'rgba(0,0,0,0.6)',
  glassThin: 'rgba(255,255,255,0.10)',
  glassRegular: 'rgba(255,255,255,0.14)',
  glassThick: 'rgba(255,255,255,0.18)',
  rimLight: 'rgba(255,255,255,0.25)',
  rimGround: 'rgba(0,0,0,0.15)',
  ambienceA: '#2A2A2E',
  ambienceB: '#161618',
  ambienceC: '#000000',
  blurTint: 'dark',
};

export const tokens = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48,
  },
  radius: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 28,
    pill: 999,
  },
  // Apple HIG type scale (size / line-height):
  // Caption2 11 → micro, Caption1 12/16, Footnote 13/18, Subhead 15/20,
  // Callout 16/21, Body 17/22, Headline 17/22, Title2 22/28, Title1 28/34,
  // Large Title 34/41.
  fontSize: {
    micro: 12,
    caption: 13,
    small: 15,
    body: 16,
    bodyLg: 17,
    title: 17,
    headline: 22,
    display: 28,
    hero: 34,
    mega: 40,
  },
  lineHeight: {
    micro: 16,
    caption: 18,
    small: 20,
    body: 21,
    bodyLg: 22,
    title: 22,
    headline: 28,
    display: 34,
    hero: 41,
    mega: 44,
  },
  font: {
    regular: 'Geist_400Regular',
    medium: 'Geist_500Medium',
    semibold: 'Geist_600SemiBold',
    bold: 'Geist_700Bold',
  },
  letter: {
    tight: -0.5,
    snug: -0.2,
    normal: 0,
    wide: 0.4,
    eyebrow: 1.4,
  },
  duration: {
    fast: 150,
    base: 220,
    slow: 320,
  },
  spring: {
    damping: 22,
    stiffness: 220,
    mass: 0.9,
  },
  blur: {
    thin: 40,
    regular: 60,
    thick: 80,
  },
  shadow: {
    none: {
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    soft: {
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4,
    },
    medium: {
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    strong: {
      shadowColor: '#000',
      shadowOpacity: 0.24,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
      elevation: 14,
    },
  },
  light,
  dark,
} as const;

export type ThemeContext = {
  palette: Palette;
  isDark: boolean;
  scheme: 'light' | 'dark';
  spacing: typeof tokens.spacing;
  radius: typeof tokens.radius;
  fontSize: typeof tokens.fontSize;
  lineHeight: typeof tokens.lineHeight;
  font: typeof tokens.font;
  letter: typeof tokens.letter;
  duration: typeof tokens.duration;
  spring: typeof tokens.spring;
  blur: typeof tokens.blur;
  shadow: typeof tokens.shadow;
};

export function useAppTheme(): ThemeContext {
  // Liquid Glass renders as a single dark field with white-on-glass text,
  // independent of the OS color scheme — always use the dark palette.
  return {
    palette: dark,
    isDark: true,
    scheme: 'dark',
    spacing: tokens.spacing,
    radius: tokens.radius,
    fontSize: tokens.fontSize,
    lineHeight: tokens.lineHeight,
    font: tokens.font,
    letter: tokens.letter,
    duration: tokens.duration,
    spring: tokens.spring,
    blur: tokens.blur,
    shadow: tokens.shadow,
  };
}
