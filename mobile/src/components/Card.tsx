// A bordered surface (the web's .info-card / .package-card / .result-card).
// Pass onPress to make the whole card tappable.
import type { ReactNode } from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'

import { makeStyles } from '@/theme'

type CardProps = {
  children: ReactNode
  onPress?: () => void
  padded?: boolean
  radius?: 'lg' | 'xl'
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
  accessibilityHint?: string
}

export function Card({ children, onPress, padded = true, radius = 'lg', style, accessibilityLabel, accessibilityHint }: CardProps) {
  const s = useStyles()
  const box = [s.card, radius === 'xl' && s.xl, padded && s.padded, style]
  if (!onPress) return <View style={box}>{children}</View>
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} style={({ pressed }) => [...box, pressed && s.pressed]}>
      {children}
    </Pressable>
  )
}

const useStyles = makeStyles((t) => ({
  card: { borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg, backgroundColor: t.c.card, overflow: 'hidden' },
  xl: { borderRadius: t.radius.xl },
  padded: { padding: t.space.md },
  pressed: { opacity: 0.85 },
}))
