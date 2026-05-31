import React from 'react';
import { Text as RNText, TextProps as RNTextProps, TextStyle, StyleProp } from 'react-native';
import { useAppTheme } from '../../theme/tokens';

type Variant =
  | 'mega'
  | 'hero'
  | 'display'
  | 'headline'
  | 'title'
  | 'body'
  | 'bodyLg'
  | 'small'
  | 'caption'
  | 'micro'
  | 'eyebrow';

type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

type Tone = 'primary' | 'secondary' | 'tertiary' | 'inverse' | 'accent' | 'success' | 'danger';

interface Props extends RNTextProps {
  variant?: Variant;
  weight?: Weight;
  tone?: Tone;
  tabularNums?: boolean;
  style?: StyleProp<TextStyle>;
}

const VARIANT_DEFAULT_WEIGHT: Record<Variant, Weight> = {
  mega: 'bold',
  hero: 'bold',
  display: 'bold',
  headline: 'semibold',
  title: 'semibold',
  body: 'regular',
  bodyLg: 'regular',
  small: 'regular',
  caption: 'regular',
  micro: 'medium',
  eyebrow: 'medium',
};

export function Text({
  variant = 'body',
  weight,
  tone = 'primary',
  tabularNums,
  style,
  children,
  ...rest
}: Props) {
  const t = useAppTheme();

  const fontSize =
    variant === 'mega' ? t.fontSize.mega
    : variant === 'hero' ? t.fontSize.hero
    : variant === 'display' ? t.fontSize.display
    : variant === 'headline' ? t.fontSize.headline
    : variant === 'title' ? t.fontSize.title
    : variant === 'bodyLg' ? t.fontSize.bodyLg
    : variant === 'small' ? t.fontSize.small
    : variant === 'caption' ? t.fontSize.caption
    : variant === 'micro' || variant === 'eyebrow' ? t.fontSize.micro
    : t.fontSize.body;

  const lineHeight =
    variant === 'mega' ? t.lineHeight.mega
    : variant === 'hero' ? t.lineHeight.hero
    : variant === 'display' ? t.lineHeight.display
    : variant === 'headline' ? t.lineHeight.headline
    : variant === 'title' ? t.lineHeight.title
    : variant === 'bodyLg' ? t.lineHeight.bodyLg
    : variant === 'small' ? t.lineHeight.small
    : variant === 'caption' ? t.lineHeight.caption
    : variant === 'micro' || variant === 'eyebrow' ? t.lineHeight.micro
    : t.lineHeight.body;

  const letterSpacing =
    variant === 'eyebrow' ? t.letter.eyebrow
    : variant === 'mega' || variant === 'hero' ? t.letter.tight
    : variant === 'display' || variant === 'headline' ? t.letter.snug
    : 0;

  const w = weight ?? VARIANT_DEFAULT_WEIGHT[variant];
  const fontFamily =
    w === 'bold' ? t.font.bold
    : w === 'semibold' ? t.font.semibold
    : w === 'medium' ? t.font.medium
    : t.font.regular;

  const color =
    tone === 'secondary' ? t.palette.textSecondary
    : tone === 'tertiary' ? t.palette.textTertiary
    : tone === 'inverse' ? t.palette.textInverse
    : tone === 'accent' ? t.palette.accent
    : tone === 'success' ? t.palette.success
    : tone === 'danger' ? t.palette.danger
    : t.palette.textPrimary;

  return (
    <RNText
      style={[
        {
          color,
          fontFamily,
          fontSize,
          lineHeight,
          letterSpacing,
          // Subtle shadow keeps white text legible over the radial gradient.
          textShadowColor: 'rgba(0,0,0,0.25)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 2,
          ...(variant === 'eyebrow' ? { textTransform: 'uppercase' } : null),
          ...(tabularNums ? { fontVariant: ['tabular-nums'] } : null),
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
