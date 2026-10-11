// Icons named by string in the shared catalog (verticals/catalog.js uses lucide
// icon names like 'Camera', 'UtensilsCrossed') -> lucide-react-native components.
//   <VerticalIcon name={vertical.icon} size={22} />
//   <VerticalIcon name={vertical.icon} tint={vertical.tint} bubble />   tinted circle
// Unknown names fall back to a circle (and warn in dev), so a new catalog icon never crashes.
import * as Lucide from 'lucide-react-native'
import { View } from 'react-native'

import { readableTint, useTheme } from '@/theme'

type IconComponent = Lucide.LucideIcon
const registry = Lucide as unknown as Record<string, IconComponent | undefined>
const warned = new Set<string>()

export function iconByName(name?: string | null): IconComponent {
  const Icon = name ? registry[name] : undefined
  if (!Icon && name && __DEV__ && !warned.has(name)) {
    warned.add(name)
    console.warn(`VerticalIcon: no lucide icon named "${name}"`)
  }
  return Icon ?? Lucide.Circle
}

type Props = { name?: string | null; size?: number; color?: string; tint?: string; bubble?: boolean; bubbleSize?: number }

// Icons are decorative (the vertical's name is always next to them) and hidden from screen
// readers. Catalog tints are darkened / lightened to 3:1 against the background (WCAG 1.4.11):
// sky, amber, teal or cyan on white, or slate on black, are 1.9 to 2.8:1 as is.
export function VerticalIcon({ name, size = 22, color, tint, bubble, bubbleSize }: Props) {
  const { c, scheme } = useTheme()
  const Icon = iconByName(name)
  const fg = color ?? tint ?? c.ink
  const ink = fg.startsWith('#') && fg !== c.ink && fg !== c.onInk ? readableTint(fg, scheme, 3) : fg
  if (!bubble) return <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden><Icon size={size} color={ink} /></View>
  const box = bubbleSize ?? size * 2.2
  return (
    <View
      style={{ width: box, height: box, borderRadius: box / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: `${tint ?? c.ink}1f` }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Icon size={size} color={ink} />
    </View>
  )
}
