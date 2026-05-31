import { MD3LightTheme, MD3DarkTheme, configureFonts } from 'react-native-paper';
import { tokens } from './tokens';

// Apple HIG type scale (Large Title 34/41 down to Footnote 13/18).
const fontConfig = {
  displayLarge: { fontFamily: tokens.font.bold, fontWeight: '700' as const, fontSize: 34, lineHeight: 41, letterSpacing: -0.4 },
  headlineMedium: { fontFamily: tokens.font.bold, fontWeight: '700' as const, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  titleLarge: { fontFamily: tokens.font.semibold, fontWeight: '600' as const, fontSize: 22, lineHeight: 28, letterSpacing: -0.2 },
  titleMedium: { fontFamily: tokens.font.semibold, fontWeight: '600' as const, fontSize: 17, lineHeight: 22, letterSpacing: -0.1 },
  bodyLarge: { fontFamily: tokens.font.regular, fontWeight: '400' as const, fontSize: 17, lineHeight: 22, letterSpacing: 0 },
  bodyMedium: { fontFamily: tokens.font.regular, fontWeight: '400' as const, fontSize: 16, lineHeight: 21, letterSpacing: 0 },
  labelLarge: { fontFamily: tokens.font.medium, fontWeight: '500' as const, fontSize: 13, lineHeight: 18, letterSpacing: 0.1 },
};

export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: tokens.light.primary,
    onPrimary: tokens.light.primaryContrast,
    primaryContainer: tokens.light.primarySoft,
    onPrimaryContainer: tokens.light.primarySoftText,
    secondary: tokens.light.accent,
    onSecondary: tokens.light.accentContrast,
    secondaryContainer: tokens.light.accentSoft,
    onSecondaryContainer: tokens.light.accentSoftText,
    background: tokens.light.bg,
    surface: tokens.light.surface,
    surfaceVariant: tokens.light.surfaceMuted,
    onSurface: tokens.light.textPrimary,
    onSurfaceVariant: tokens.light.textSecondary,
    outline: tokens.light.border,
    outlineVariant: tokens.light.border,
    error: tokens.light.danger,
    errorContainer: tokens.light.dangerSoft,
    onErrorContainer: tokens.light.dangerSoftText,
  },
  fonts: configureFonts({ config: fontConfig }),
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: tokens.dark.primary,
    onPrimary: tokens.dark.primaryContrast,
    primaryContainer: tokens.dark.primarySoft,
    onPrimaryContainer: tokens.dark.primarySoftText,
    secondary: tokens.dark.accent,
    onSecondary: tokens.dark.accentContrast,
    secondaryContainer: tokens.dark.accentSoft,
    onSecondaryContainer: tokens.dark.accentSoftText,
    background: tokens.dark.bg,
    surface: tokens.dark.surface,
    surfaceVariant: tokens.dark.surfaceMuted,
    onSurface: tokens.dark.textPrimary,
    onSurfaceVariant: tokens.dark.textSecondary,
    outline: tokens.dark.border,
    outlineVariant: tokens.dark.border,
    error: tokens.dark.danger,
    errorContainer: tokens.dark.dangerSoft,
    onErrorContainer: tokens.dark.dangerSoftText,
  },
  fonts: configureFonts({ config: fontConfig }),
};

export type AppTheme = typeof lightTheme;
