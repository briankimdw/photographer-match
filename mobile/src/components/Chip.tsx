// Pills, mirroring the web's .chip / .chip.toggle / .chip.solid.
//   <Chip label="Wedding" />                         static
//   <Chip label="All" toggle on={!cat} onPress={...} /> filter toggle
//   <ChipRow scroll>{...}</ChipRow>                  a horizontal row of chips
import type { LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Platform, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'

import { makeStyles, readableTint, useTheme } from '@/theme'
import { Text } from './Text'

const WEB = Platform.OS === 'web'

type ChipProps = {
  label: string
  onPress?: () => void
  toggle?: boolean
  on?: boolean
  solid?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  tint?: string
  iconTint?: string // color for the leading icon only (when not filled)
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  accessibilityHint?: string
  /** Announce as a radio-like choice ("selected") instead of an on/off toggle ("checked"). */
  select?: boolean
  /** Looks like a toggle but just opens something (Filters, Sort): a plain button for screen readers. */
  asButton?: boolean
}

export function Chip({ label, onPress, toggle, on, solid, icon: Icon, iconRight: IconRight, tint, iconTint, style, accessibilityLabel, accessibilityHint, select, asButton }: ChipProps) {
  const s = useStyles()
  const { c, scheme } = useTheme()
  const filled = solid || (toggle && on)
  const fg = filled ? c.onInk : tint ? readableTint(tint, scheme) : c.ink
  const content = (
    <>
      {Icon && <Icon size={13} color={filled ? fg : iconTint ? readableTint(iconTint, scheme, 3) : fg} />}
      <Text variant="small" style={{ color: fg, fontSize: 12.5, flexShrink: 1 }} weight={filled ? '600' : '500'} numberOfLines={1} maxFontSizeMultiplier={1.8}>
        {label}
      </Text>
      {IconRight && <IconRight size={12} color={fg} />}
    </>
  )
  const boxStyle = [s.chip, toggle && s.toggle, filled && s.filled, style]
  const isToggle = toggle && !asButton
  if (!onPress) return <View style={boxStyle} accessible accessibilityLabel={accessibilityLabel ?? label}>{content}</View>
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      accessibilityRole={isToggle && !select && !WEB ? 'togglebutton' : 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={isToggle && !WEB ? (select ? { selected: !!on } : { checked: !!on }) : undefined}
      // The web target has no "togglebutton" role: a button with aria-pressed is the same thing.
      {...(isToggle && WEB ? ({ 'aria-pressed': !!on } as object) : null)}
      style={({ pressed }) => [...boxStyle, pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  )
}

export function ChipRow({ children, scroll, style }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.row, s.scrollRow, style]}>
        {children}
      </ScrollView>
    )
  }
  return <View style={[s.row, s.wrap, style]}>{children}</View>
}

const useStyles = makeStyles((t) => ({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 11,
    borderRadius: t.radius.pill, backgroundColor: t.c.soft, alignSelf: 'flex-start', maxWidth: '100%',
  },
  toggle: { backgroundColor: t.c.bg, borderWidth: 1, borderColor: t.c.line },
  filled: { backgroundColor: t.c.ink, borderColor: t.c.ink },
  row: { flexDirection: 'row', gap: 6 },
  wrap: { flexWrap: 'wrap' },
  scrollRow: { paddingHorizontal: t.space.lg },
}))
