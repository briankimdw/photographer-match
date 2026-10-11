// Text with the app's type scale. Variants mirror the web's h2/h3/h4, .small, .tiny, .muted.
//   <Text variant="h3">Title</Text>  <Text variant="small" muted>Secondary</Text>
import type { Ref } from 'react'
import { Text as RNText, type TextProps, type TextStyle } from 'react-native'

import { font, useTheme, type Colors } from '@/theme'

export type TextVariant = 'display' | 'h1' | 'h2' | 'h3' | 'h4' | 'body' | 'small' | 'tiny' | 'label' | 'caption'

const VARIANTS: Record<TextVariant, TextStyle> = {
  display: { fontSize: font.size.xxl, fontWeight: '800', letterSpacing: -0.6 },
  h1: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  h2: { fontSize: font.size.xl, fontWeight: '700' },
  h3: { fontSize: font.size.lg, fontWeight: '600', letterSpacing: -0.1 },
  h4: { fontSize: font.size.body, fontWeight: '600' },
  body: { fontSize: font.size.md, lineHeight: 20 },
  small: { fontSize: font.size.sm, lineHeight: 18 },
  tiny: { fontSize: font.size.tiny, lineHeight: 15 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  caption: { fontSize: 10.5, fontWeight: '600' },
}

export type AppTextProps = TextProps & {
  ref?: Ref<RNText> // React 19: a plain prop (focus a heading with lib/a11y focusOn)
  variant?: TextVariant
  muted?: boolean
  color?: keyof Colors | (string & {})
  weight?: TextStyle['fontWeight']
  center?: boolean
}

// Headings are announced as headers (VoiceOver rotor / TalkBack "headings" navigation).
const HEADERS = new Set<TextVariant>(['display', 'h1', 'h2', 'h3', 'label'])
// Dynamic Type: text grows with the phone's font size up to 200% (WCAG 1.4.4); big headings
// (already 20-24pt) stop at 150% so one-line titles stay readable. Tight spots (badges on
// photos, tab labels) pass a lower maxFontSizeMultiplier themselves.
const MAX_SCALE: Partial<Record<TextVariant, number>> = { display: 1.5, h1: 1.5, h2: 1.6, caption: 1.6 }

export function Text({ variant = 'body', muted, color, weight, center, style, ...rest }: AppTextProps) {
  const { c } = useTheme()
  const tint = color ? ((c as Record<string, string>)[color] ?? color) : muted ? c.muted : variant === 'label' ? c.muted : c.ink
  return (
    <RNText
      accessibilityRole={HEADERS.has(variant) && !rest.onPress ? 'header' : undefined}
      maxFontSizeMultiplier={MAX_SCALE[variant] ?? 2}
      {...rest}
      style={[VARIANTS[variant], { color: tint }, weight != null && { fontWeight: weight }, center && { textAlign: 'center' }, style]}
    />
  )
}
