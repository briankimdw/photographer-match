// A − value + control over a list of stops (stands in for the web's range sliders:
// deposit %, service radius), so no slider dependency is needed.
import { Minus, Plus } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { Text } from '@/components'
import { makeStyles, useTheme } from '@/theme'

type Props = { stops: number[]; value: number; onChange: (v: number) => void; format?: (v: number) => string; label: string }

const nearest = (stops: number[], v: number) => stops.reduce((best, s, i) => (Math.abs(s - v) < Math.abs(stops[best] - v) ? i : best), 0)

export default function Stepper({ stops, value, onChange, format = String, label }: Props) {
  const s = useStyles()
  const { c } = useTheme()
  const i = nearest(stops, value)
  const btn = (dir: -1 | 1) => {
    const j = i + dir
    const disabled = j < 0 || j >= stops.length
    const Icon = dir < 0 ? Minus : Plus
    return (
      <Pressable
        onPress={() => !disabled && onChange(stops[j])}
        disabled={disabled}
        hitSlop={6}
        style={({ pressed }) => [s.btn, disabled && s.off, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`${dir < 0 ? 'Less' : 'More'} ${label}`}
      >
        <Icon size={18} color={c.ink} />
      </Pressable>
    )
  }
  return (
    // One "adjustable" element for screen readers (swipe up / down to change); the − / + buttons are for touch.
    <View style={s.row} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: format(stops[i]) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const j = i + (e.nativeEvent.actionName === 'increment' ? 1 : -1)
        if (j >= 0 && j < stops.length) onChange(stops[j])
      }}
    >
      {btn(-1)}
      <Text variant="h3" style={s.value} maxFontSizeMultiplier={1.5}>{format(stops[i])}</Text>
      {btn(1)}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.35 },
  value: { minWidth: 80, textAlign: 'center' },
}))
