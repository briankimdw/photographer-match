// Small layout pieces used by the account, inbox and provider screens (the web's
// .list-row, .settings-group, .section-label, .callout, .round-icon, .toggle-row,
// .field-hint / .form-error).
import { ChevronRight, type LucideIcon } from 'lucide-react-native'
import { Children, useEffect, type ReactNode } from 'react'
import { Pressable, Switch, View, type StyleProp, type ViewStyle } from 'react-native'

import { Text } from '@/components'
import { announce } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'

export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  return (
    <View style={[s.sectionLabel, style]}>
      <Text variant="label">{children}</Text>
    </View>
  )
}

export function RoundIcon({ icon: Icon, tint, size = 18 }: { icon: LucideIcon; tint?: string; size?: number }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={s.roundIcon}>
      <Icon size={size} color={tint ?? c.ink} />
    </View>
  )
}

type ListRowProps = {
  title: string
  sub?: string | null
  subColor?: string
  icon?: LucideIcon
  left?: ReactNode
  right?: ReactNode
  onPress?: () => void
  danger?: boolean
  chevron?: boolean
  disabled?: boolean
  accessibilityLabel?: string
}

// A tappable row: icon, title + subtitle, chevron (or a custom right side).
export function ListRow({ title, sub, subColor, icon, left, right, onPress, danger, chevron = !!onPress, disabled, accessibilityLabel }: ListRowProps) {
  const s = useStyles()
  const { c } = useTheme()
  const content = (
    <>
      {left ?? (icon ? <RoundIcon icon={icon} tint={danger ? c.danger : undefined} /> : null)}
      <View style={s.grow}>
        <Text style={danger ? { color: c.danger } : undefined} numberOfLines={2}>{title}</Text>
        {!!sub && <Text variant="tiny" muted={!subColor} color={subColor} numberOfLines={3}>{sub}</Text>}
      </View>
      {right}
      {chevron && <ChevronRight size={16} color={c.muted} />}
    </>
  )
  if (!onPress) return <View style={[s.row, disabled && s.disabled]}>{content}</View>
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: c.soft }, disabled && s.disabled]}
    >
      {content}
    </Pressable>
  )
}

// A bordered group of ListRows with dividers between them.
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  const items = Children.toArray(children)
  return (
    <View style={[s.group, style]}>
      {items.map((child, i) => (
        <View key={i} style={i > 0 ? s.divider : undefined}>{child}</View>
      ))}
    </View>
  )
}

export function SoonTag() {
  const s = useStyles()
  return (
    <View style={s.soon}>
      <Text variant="caption" muted>Soon</Text>
    </View>
  )
}

// Label + switch (the web's .toggle-row).
export function ToggleRow({ label, sub, value, onChange, disabled }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={s.toggleRow}>
      <View style={s.grow}>
        <Text variant="small">{label}</Text>
        {!!sub && <Text variant="tiny" muted>{sub}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        // Off track in `faint`, not `line`: the switch's outline needs 3:1 against the page.
        trackColor={{ true: c.accent, false: c.faint }}
        thumbColor="#ffffff"
        accessibilityLabel={label}
        accessibilityHint={sub}
      />
    </View>
  )
}

// A soft panel for notes and statuses (the web's .callout / .note).
export function Callout({ children, tone = 'soft', style }: { children: ReactNode; tone?: 'soft' | 'live' | 'danger' | 'accent'; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  return <View style={[s.callout, s[tone], style]}>{children}</View>
}

// The plain text of a message (strings and numbers in children), for announcing it.
const textOf = (children: ReactNode) =>
  Children.toArray(children).filter((x) => typeof x === 'string' || typeof x === 'number').join('')

export function FieldHint({ children, error }: { children: ReactNode; error?: boolean }) {
  const msg = error ? textOf(children) : ''
  useEffect(() => {
    if (msg) announce(msg)
  }, [msg])
  return (
    <Text variant="tiny" color={error ? 'danger' : 'muted'} style={{ marginTop: 4 }} accessibilityRole={error ? 'alert' : undefined}>
      {children}
    </Text>
  )
}

// Errors are spoken when they appear (accessibilityRole "alert" alone isn't announced on iOS).
export function FormError({ children }: { children: ReactNode }) {
  const s = useStyles()
  const msg = textOf(children)
  useEffect(() => {
    if (msg) announce(msg)
  }, [msg])
  return (
    <View style={s.formError} accessibilityRole="alert">
      <Text variant="small" color="danger">{children}</Text>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  sectionLabel: { paddingTop: t.space.xl, paddingBottom: t.space.sm },
  roundIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 56 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  disabled: { opacity: 0.55 },
  group: { borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.c.card },
  divider: { borderTopWidth: 1, borderTopColor: t.c.line },
  soon: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: t.c.soft },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  callout: { padding: t.space.md, borderRadius: t.radius.lg, gap: 4 },
  soft: { backgroundColor: t.c.soft },
  live: { backgroundColor: t.scheme === 'dark' ? '#0f2e1a' : '#dcfce7' },
  danger: { backgroundColor: t.c.dangerSoft },
  accent: { backgroundColor: t.c.accentSoft },
  formError: { padding: 12, borderRadius: t.radius.md, backgroundColor: t.c.dangerSoft, marginTop: t.space.sm },
}))
