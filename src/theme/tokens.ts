import { useColorScheme } from 'react-native';

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

const dark: Palette = {
  bg: '#0A0A0A',
  bgElevated: '#141414',
  surface: '#1A1A1A',
  surfaceMuted: '#1F1F1F',
  surfaceSunken: '#0F0F0F',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  textPrimary: '#F5F5F5',
  textSecondary: '#A3A3A3',
  textTertiary: '#737373',
  textInverse: '#0A0A0A',
  primary: '#FAFAFA',
  primaryContrast: '#0A0A0A',
  primarySoft: 'rgba(255,255,255,0.10)',
  primarySoftText: '#F5F5F5',
  accent: '#BFBFBF',
  accentContrast: '#0A0A0A',
  accentSoft: 'rgba(255,255,255,0.10)',
  accentSoftText: '#E5E5E5',
  success: '#7BB28B',
  successSoft: 'rgba(123,178,139,0.16)',
  warning: '#C99A4A',
  warningSoft: 'rgba(201,154,74,0.16)',
  danger: '#E16B5E',
  dangerSoft: 'rgba(225,107,94,0.16)',
  dangerSoftText: '#F2A399',
  info: '#A3A3A3',
  overlay: 'rgba(255,255,255,0.04)',
  shadow: 'rgba(0,0,0,0.5)',
  scrim: 'rgba(0,0,0,0.6)',
  glassThin: 'rgba(20,20,20,0.55)',
  glassRegular: 'rgba(20,20,20,0.72)',
  glassThick: 'rgba(10,10,10,0.85)',
  rimLight: 'rgba(255,255,255,0.10)',
  rimGround: 'rgba(0,0,0,0.40)',
  ambienceA: '#141414',
  ambienceB: '#0A0A0A',
  ambienceC: '#050505',
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
  fontSize: {
    micro: 11,
    caption: 12,
    small: 13,
    body: 15,
    bodyLg: 16,
    title: 18,
    headline: 22,
    display: 30,
    hero: 40,
    mega: 56,
  },
  lineHeight: {
    micro: 14,
    caption: 16,
    small: 18,
    body: 22,
    bodyLg: 24,
    title: 24,
    headline: 28,
    display: 36,
    hero: 44,
    mega: 60,
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
    thin: 18,
    regular: 30,
    thick: 60,
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
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    medium: {
      shadowColor: '#000',
      shadowOpacity: 0.10,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
    strong: {
      shadowColor: '#000',
      shadowOpacity: 0.16,
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
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return {
    palette: isDark ? dark : light,
    isDark,
    scheme: isDark ? 'dark' : 'light',
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
