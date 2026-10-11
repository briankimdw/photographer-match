// Trust badges and stars (the web's components/Badges.jsx and Stars.jsx).
// Each badge is one accessible element with a spoken label; inside a card that has its own
// accessibilityLabel (ProviderCard...) the card's label wins and already mentions them.
import { BadgeCheck, ShieldCheck, Star } from 'lucide-react-native'
import { createContext, useContext } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/theme'
import { Text } from './Text'

// Inside a grouped element (a card announced as one, with its own label) the badges must not
// be separate focus stops (TalkBack would visit them one by one): wrap the card in <InA11yGroup>.
const GroupCtx = createContext(false)
export const InA11yGroup = GroupCtx.Provider
const useA11yProps = (label: string, role: 'image' | 'text' = 'image') =>
  useContext(GroupCtx)
    ? ({ accessible: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } as const)
    : ({ accessible: true, accessibilityRole: role === 'image' ? ('image' as const) : undefined, accessibilityLabel: label })

/** "Rated 4.9 out of 5, 12 reviews" / "New, no reviews yet" (for grouped labels). */
export function ratingLabel(rating: number | null | undefined, count?: number | null) {
  if (rating == null) return 'New, no reviews yet'
  const n = count != null ? `, ${count} review${count === 1 ? '' : 's'}` : ''
  return `Rated ${rating.toFixed(1)} out of 5${n}`
}

export function IdVerified({ label = false }: { label?: boolean }) {
  const { c } = useTheme()
  const a11y = useA11yProps('Identity verified')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} {...a11y}>
      <ShieldCheck size={13} color={c.id} />
      {label && <Text variant="caption" style={{ color: c.id, fontSize: 11, fontWeight: '700' }} maxFontSizeMultiplier={1.4}>ID verified</Text>}
    </View>
  )
}

export function ProBadge() {
  const { c } = useTheme()
  const a11y = useA11yProps('Verified Pro')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.pro, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }} {...a11y}>
      <BadgeCheck size={11} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }} maxFontSizeMultiplier={1.4}>PRO</Text>
    </View>
  )
}

export function NewTag() {
  const { c } = useTheme()
  const a11y = useA11yProps('New, no reviews yet', 'text')
  return (
    <View style={{ backgroundColor: c.soft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }} {...a11y}>
      <Text style={{ fontSize: 10.5, fontWeight: '700' }} maxFontSizeMultiplier={1.6}>New</Text>
    </View>
  )
}

// Read-only stars, or (with onChange) a rating input: one "adjustable" element that
// VoiceOver / TalkBack change by swiping up / down, plus tappable stars for touch.
export function Stars({ value, size = 14, onChange, label = 'Rating' }: { value: number; size?: number; onChange?: (n: number) => void; label?: string }) {
  const { c } = useTheme()
  const group = useContext(GroupCtx)
  const rounded = Math.round(value)
  const stars = [1, 2, 3, 4, 5].map((n) => {
    const on = n <= rounded
    const icon = <Star size={size} color={on ? c.star : c.faint} fill={on ? c.star : 'none'} />
    if (!onChange) return <View key={n}>{icon}</View>
    return (
      <Pressable key={n} onPress={() => onChange(n)} hitSlop={Math.max(0, (44 - size) / 2 - 1)} importantForAccessibility="no" accessible={false}>
        {icon}
      </Pressable>
    )
  })
  if (!onChange) {
    return (
      <View style={{ flexDirection: 'row', gap: 1 }} accessible={!group} accessibilityRole="image" accessibilityLabel={`${value.toFixed(1)} out of 5 stars`}>
        {stars}
      </View>
    )
  }
  return (
    <View
      style={{ flexDirection: 'row', gap: 1 }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 5, now: rounded, text: rounded ? `${rounded} of 5 stars` : 'No stars' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(5, rounded + 1))
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(1, rounded - 1))
      }}
    >
      {stars}
    </View>
  )
}

// "★ 4.9 (12)" or a New tag before the first review.
export function RatingInline({ rating, count, size = 12 }: { rating: number | null; count?: number; size?: number }) {
  const { c } = useTheme()
  const a11y = useA11yProps(ratingLabel(rating, count), 'text')
  if (rating == null) return <NewTag />
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} {...a11y}>
      <Star size={size} color={c.star} fill={c.star} />
      <Text variant="tiny" weight="600">{rating.toFixed(1)}</Text>
      {count != null && <Text variant="tiny" muted>({count})</Text>}
    </View>
  )
}
