// Month calendar where several days can be picked (the web's components/DatePicker.jsx).
//   <DatePicker selected={['2026-10-24']} onToggle={(key) => ...} isDisabled={isPast} />
// Days are 'YYYY-MM-DD' keys (lib/dates.js toKey). `dots` marks days with up to three
// colored dots ({ '2026-10-24': ['#16a34a'] }). Pass month/onMonthChange to control the month.
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { today, toKey } from '@shared/lib/dates.js'
import { makeStyles, useTheme } from '@/theme'
import { Text } from './Text'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

type Props = {
  selected?: string[]
  onToggle: (key: string) => void
  isDisabled?: (d: Date) => boolean
  dots?: Record<string, string[]>
  month?: Date
  onMonthChange?: (d: Date) => void
}

export function DatePicker({ selected = [], onToggle, isDisabled = () => false, dots = {}, month, onMonthChange }: Props) {
  const s = useStyles()
  const { c } = useTheme()
  const [ownMonth, setOwnMonth] = useState(() => monthStart(today()))
  const shown = month ?? ownMonth
  const setShown = onMonthChange ?? setOwnMonth

  const firstWeekday = shown.getDay()
  const daysInMonth = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(shown.getFullYear(), shown.getMonth(), i + 1)),
  ]
  while (cells.length % 7) cells.push(null)
  const todayKey = toKey(today())
  const title = shown.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <View>
      <View style={s.head}>
        <Pressable onPress={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))} hitSlop={8} style={s.nav} accessibilityRole="button" accessibilityLabel="Previous month">
          <ChevronLeft size={20} color={c.ink} />
        </Pressable>
        <Text variant="h4" accessibilityRole="header" accessibilityLiveRegion="polite">{title}</Text>
        <Pressable onPress={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))} hitSlop={8} style={s.nav} accessibilityRole="button" accessibilityLabel="Next month">
          <ChevronRight size={20} color={c.ink} />
        </Pressable>
      </View>
      <View style={s.grid}>
        {WEEKDAYS.map((d, i) => (
          <View key={`w${i}`} style={s.cell}>
            <Text variant="tiny" muted weight="600" importantForAccessibility="no" accessibilityElementsHidden maxFontSizeMultiplier={1.3}>{d}</Text>
          </View>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={s.cell} />
          const key = toKey(d)
          const on = selected.includes(key)
          const disabled = isDisabled(d)
          const marks = dots[key] || []
          return (
            <View key={key} style={s.cell}>
              <Pressable
                onPress={() => onToggle(key)}
                disabled={disabled}
                style={[s.day, key === todayKey && s.today, on && s.on, disabled && s.disabled]}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled }}
                accessibilityLabel={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${key === todayKey ? ', today' : ''}${marks.length ? `, ${marks.length} ${marks.length === 1 ? 'event' : 'events'}` : ''}`}
              >
                <Text variant="small" weight={on ? '700' : '500'} style={{ color: on ? c.onInk : disabled ? c.faint : c.ink }} maxFontSizeMultiplier={1.4}>{d.getDate()}</Text>
                {marks.length > 0 && (
                  <View style={s.dots}>
                    {marks.slice(0, 3).map((m, j) => <View key={j} style={[s.dot, { backgroundColor: on ? c.onInk : m }]} />)}
                  </View>
                )}
              </Pressable>
            </View>
          )
        })}
      </View>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  nav: { padding: 6, borderRadius: 999 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2, alignItems: 'center', justifyContent: 'center' },
  day: { width: '100%', height: '100%', maxWidth: 46, maxHeight: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1, borderColor: t.c.line },
  on: { backgroundColor: t.c.ink, borderColor: t.c.ink },
  disabled: { opacity: 0.45 },
  dots: { position: 'absolute', bottom: 5, flexDirection: 'row', gap: 2 },
  dot: { width: 4, height: 4, borderRadius: 2 },
}))
