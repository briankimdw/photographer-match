// Buttons, mirroring the web's .btn variants.
//   <Button title="Book" variant="accent" onPress={...} />
//   <Button title="Ask a question" variant="ghost" icon={MessageCircle} size="sm" />
//   <IconButton icon={Heart} label="Save" onPress={...} />
import type { LucideIcon } from 'lucide-react-native'
import { ActivityIndicator, Pressable, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'

import { makeStyles, useTheme } from '@/theme'
import { Text } from './Text'

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'outline' | 'danger' | 'link'

type ButtonProps = {
  title: string
  onPress?: () => void
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  icon?: LucideIcon
  iconRight?: LucideIcon
  block?: boolean
  grow?: boolean
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  accessibilityHint?: string
}

export function Button({
  title, onPress, variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, block, grow, disabled, loading, style, accessibilityLabel, accessibilityHint,
}: ButtonProps) {
  const s = useStyles()
  const { c } = useTheme()
  const fg = {
    primary: c.onInk, accent: c.onAccent, ghost: c.ink, outline: c.ink, danger: c.danger, link: c.ink,
  }[variant]
  const iconSize = size === 'sm' ? 14 : 16
  // Two buttons side by side on a narrow phone (320pt): tighter padding and text, so
  // "Ask a question" fits on one line instead of ending in "…".
  const { width } = useWindowDimensions()
  const tight = !!grow && width < 360
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={size === 'sm' ? 5 : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        s.base, s[size], s[variant], block && s.block, grow && s.grow, tight && s.tight,
        (disabled || loading) && s.disabled, pressed && s.pressed, style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : Icon ? <Icon size={iconSize} color={fg} /> : null}
      {/* Large text: two lines rather than "Ask a quest…" (one line at the default size). */}
      <Text variant={size === 'sm' ? 'small' : 'body'} weight="600" style={[{ color: fg, flexShrink: 1 }, tight && size === 'md' && { fontSize: 13.5 }]} numberOfLines={2} maxFontSizeMultiplier={1.6}>
        {title}
      </Text>
      {IconRight ? <IconRight size={iconSize} color={fg} /> : null}
    </Pressable>
  )
}

// Icon-only: `label` is what VoiceOver / TalkBack say. `selected` for on/off icons (Save, Like).
// 34pt + hitSlop 5 = a 44pt touch target.
export function IconButton({
  icon: Icon, onPress, label, hint, selected, disabled, color, size = 22, filled, style,
}: {
  icon: LucideIcon; onPress?: () => void; label: string; hint?: string; selected?: boolean; disabled?: boolean
  color?: string; size?: number; filled?: boolean; style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  const tint = color ?? c.ink
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={Math.max(5, (44 - size - 12) / 2)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={selected != null || disabled ? { selected, disabled: !!disabled } : undefined}
      style={({ pressed }) => [{ padding: 6, borderRadius: 999, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }, style]}
    >
      <View>
        <Icon size={size} color={tint} fill={filled ? tint : 'none'} />
      </View>
    </Pressable>
  )
}

const useStyles = makeStyles((t) => ({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start' },
  md: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: t.radius.md, minHeight: 44 },
  sm: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: t.radius.sm, minHeight: 34 },
  primary: { backgroundColor: t.c.ink },
  accent: { backgroundColor: t.c.accent },
  ghost: { backgroundColor: t.c.soft },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: t.c.line },
  danger: { backgroundColor: t.c.dangerSoft },
  link: { backgroundColor: 'transparent', paddingHorizontal: 0, minHeight: 0 },
  block: { alignSelf: 'stretch' },
  grow: { flex: 1, alignSelf: 'auto' },
  tight: { paddingHorizontal: 8, gap: 5 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
}))
