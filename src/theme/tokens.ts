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
}

const light: Palette = {
  bg: '#F8F7F2',
  bgElevated: '#FDFCF8',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EFE8',
  surfaceSunken: '#EAE7DE',
  border: 'rgba(15,23,18,0.08)',
  borderStrong: 'rgba(15,23,18,0.16)',
  textPrimary: '#0F1A14',
  textSecondary: '#5B6660',
  textTertiary: '#94A099',
  textInverse: '#FDFCF8',
  primary: '#2A7F3E',
  primaryContrast: '#FFFFFF',
  primarySoft: '#DDEFD8',
  primarySoftText: '#1B5C2C',
  accent: '#C46A1F',
  accentContrast: '#FFFFFF',
  accentSoft: '#FBE7CF',
  accentSoftText: '#7E3F0A',
  success: '#2A7F3E',
  successSoft: '#DDEFD8',
  warning: '#B7791F',
  warningSoft: '#FAEBC4',
  danger: '#B0362C',
  dangerSoft: '#F5DAD6',
  dangerSoftText: '#7E2018',
  info: '#1F5BB7',
  overlay: 'rgba(15,23,18,0.04)',
  shadow: 'rgba(15,23,18,0.08)',
  scrim: 'rgba(15,23,18,0.45)',
};

const dark: Palette = {
  bg: '#0A0F0C',
  bgElevated: '#101714',
  surface: '#141B17',
  surfaceMuted: '#1B2420',
  surfaceSunken: '#0E1411',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  textPrimary: '#ECF0EC',
  textSecondary: '#9BA8A1',
  textTertiary: '#6E7E76',
  textInverse: '#0F1A14',
  primary: '#5EBE6F',
  primaryContrast: '#0A1A0F',
  primarySoft: 'rgba(94,190,111,0.18)',
  primarySoftText: '#9CDDA8',
  accent: '#E89A4B',
  accentContrast: '#1A0F03',
  accentSoft: 'rgba(232,154,75,0.18)',
  accentSoftText: '#F2BD83',
  success: '#5EBE6F',
  successSoft: 'rgba(94,190,111,0.16)',
  warning: '#E0A93D',
  warningSoft: 'rgba(224,169,61,0.16)',
  danger: '#E16B5E',
  dangerSoft: 'rgba(225,107,94,0.16)',
  dangerSoftText: '#F2A399',
  info: '#6FA1F0',
  overlay: 'rgba(255,255,255,0.04)',
  shadow: 'rgba(0,0,0,0.5)',
  scrim: 'rgba(0,0,0,0.6)',
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
    shadow: tokens.shadow,
  };
}
