// The next two weeks as day pills, booked days struck through (the web Profile's
// AvailabilityStrip and the swipe deck's "Next 2 weeks").
//   <AvailabilityStrip free={setOfKeys} pending={!setOfKeys} />     free days already loaded
//   <AvailabilityStrip providerId={p.id} />                           loads them (one freeDays call)
//   onSelect(key) makes free days tappable; selected: key(s) to highlight.
//   startToday: start at today instead of tomorrow (the deck's view).
import { useMemo } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { freeDays } from '@shared/api/catalog.js'
import { addDays, today, toKey } from '@shared/lib/dates.js'
import useQuery from '@/hooks/useQuery'
import { makeStyles, useTheme } from '@/theme'
import { Text } from './Text'

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/** The days the strip shows: the next `count` days, starting tomorrow (or today). */
export const stripDates = (count = 14, startToday = false): Date[] =>
  Array.from({ length: count }, (_, i) => addDays(today(), i + (startToday ? 0 : 1)))

type Props = {
  free?: Set<string> | null
  providerId?: string
  selected?: string | string[] | null
  onSelect?: (key: string) => void
  pending?: boolean
  startToday?: boolean
  inset?: number // horizontal padding inside the scroller (to line up with the screen gutter)
}

export function AvailabilityStrip({ free, providerId, selected, onSelect, pending = false, startToday = false, inset = 0 }: Props) {
  const s = useStyles()
  const { c } = useTheme()
  const days = useMemo(() => stripDates(14, startToday), [startToday])
  const loaded = useQuery<Set<string>>(providerId && !free ? () => freeDays(providerId, days) : null, [providerId, !!free])
  const freeSet = free || loaded.data
  const picked = Array.isArray(selected) ? selected : selected ? [selected] : []
  const dim = pending || (!!providerId && !freeSet)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.row, { paddingHorizontal: inset }]} style={dim && s.pending}>
      {days.map((d) => {
        const key = toKey(d)
        const busy = freeSet ? !freeSet.has(key) : false
        const on = picked.includes(key)
        return (
          <Pressable
            key={key}
            disabled={busy || !onSelect}
            onPress={() => onSelect?.(key)}
            style={[s.day, busy && s.busy, on && s.on]}
            accessibilityRole={onSelect ? 'button' : 'text'}
            accessibilityLabel={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${!freeSet ? 'loading' : busy ? 'not available' : 'available'}`}
            accessibilityState={onSelect ? { selected: on, disabled: busy } : undefined}
          >
            <Text variant="tiny" style={{ color: on ? c.onInk : c.muted, fontSize: 11 }} maxFontSizeMultiplier={1.3}>{DAYS[d.getDay()]}</Text>
            <Text
              weight="700"
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, color: on ? c.onInk : busy ? c.faint : c.ink, textDecorationLine: busy ? 'line-through' : 'none' }}
            >
              {d.getDate()}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const useStyles = makeStyles((t) => ({
  row: { gap: 6, paddingVertical: 2 },
  pending: { opacity: 0.45 },
  day: { width: 44, alignItems: 'center', paddingVertical: 6, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.line },
  busy: { backgroundColor: t.c.soft },
  on: { backgroundColor: t.c.ink, borderColor: t.c.ink },
}))
