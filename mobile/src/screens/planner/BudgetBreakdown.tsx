// Stacked budget bar + rows (the web's components/planner/BudgetBreakdown.jsx).
// The rows double as the legend; tap a row or a segment to highlight it.
// Categories you can't book yet are drawn in grey.
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Text } from '@/components'
import { makeStyles, useTheme } from '@/theme'
import { cents } from './brief'

// Fixed categorical order (by position among the bookable categories), same as the web.
const SERIES = ['#2a78d6', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#eb6834']

export type BudgetLine = { category: string; label: string; cents: number; pct?: number | null; bookable?: boolean }

export default function BudgetBreakdown({ budget, total }: { budget: BudgetLine[]; total?: number | null }) {
  const s = useStyles()
  const { c, scheme } = useTheme()
  const [active, setActive] = useState<string | null>(null)
  if (!budget?.length) return null

  const sum = budget.reduce((acc, b) => acc + (b.cents || 0), 0)
  const shown = total ?? sum
  const shownBase = Math.max(shown || 0, sum)
  let bookableIndex = 0
  const soonColor = scheme === 'dark' ? '#3f3f46' : '#dedede'
  const rows = budget.map((b) => ({
    ...b,
    color: b.bookable ? SERIES[bookableIndex++ % SERIES.length] : soonColor,
    share: sum ? (b.cents || 0) / sum : 0,
    pctLabel: shownBase ? Math.round(((b.cents || 0) / shownBase) * 100) : Math.round(b.pct ?? 0),
  }))
  const toggle = (cat: string) => setActive((a) => (a === cat ? null : cat))
  const segs = rows.filter((r) => r.share > 0)

  return (
    <View style={s.card}>
      <View style={s.between}>
        <Text variant="label">Budget breakdown</Text>
        <Text style={s.total}>{cents(shown)}</Text>
      </View>
      <View style={s.bar} accessibilityRole="image" accessibilityLabel={rows.map((r) => `${r.label} ${cents(r.cents)}`).join(', ')}>
        {segs.map((r, i) => (
          <Pressable
            key={r.category}
            onPress={() => toggle(r.category)}
            accessible={false}
            importantForAccessibility="no"
            style={[
              s.seg,
              { flexGrow: r.share, backgroundColor: r.color },
              i === 0 && s.segFirst,
              i === segs.length - 1 && s.segLast,
              !!active && active !== r.category && s.dim,
            ]}
          />
        ))}
      </View>
      {rows.map((r, i) => (
        <Pressable
          key={r.category}
          onPress={() => toggle(r.category)}
          style={[s.row, i > 0 && s.rowBorder, active === r.category && { backgroundColor: c.soft }]}
          accessibilityRole="button"
          accessibilityLabel={`${r.label}: ${cents(r.cents)}, ${r.pctLabel}%${r.bookable ? '' : ', coming soon'}`}
          accessibilityHint="Highlights it in the bar"
          accessibilityState={{ selected: active === r.category }}
        >
          <View style={[s.dot, { backgroundColor: r.color }]} />
          <View style={s.label}>
            <Text variant="small" style={!r.bookable && { color: c.faint }} numberOfLines={1}>{r.label}</Text>
            {!r.bookable && (
              <View style={s.soonTag}>
                <Text style={s.soonText}>Coming soon</Text>
              </View>
            )}
          </View>
          <Text variant="tiny" muted style={s.pct}>{r.pctLabel}%</Text>
          <Text variant="small" weight={r.bookable ? '700' : '500'} style={[s.amt, !r.bookable && { color: c.faint }]}>{cents(r.cents)}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  card: { borderWidth: 1, borderColor: t.c.line, borderRadius: 16, padding: 14, backgroundColor: t.c.card },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { fontSize: 17, fontWeight: '700', color: t.c.ink },
  bar: { flexDirection: 'row', gap: 2, height: 12, marginTop: 8, marginBottom: 12 },
  seg: { minWidth: 4, borderRadius: 2 },
  segFirst: { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  segLast: { borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  dim: { opacity: 0.35 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  rowBorder: { borderTopWidth: 1, borderTopColor: t.c.line },
  dot: { width: 10, height: 10, borderRadius: 3 },
  label: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  soonTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: t.c.soft },
  soonText: { fontSize: 10, fontWeight: '600', color: t.c.faint },
  pct: { width: 34, textAlign: 'right' },
  amt: { width: 76, textAlign: 'right', fontVariant: ['tabular-nums'] },
}))
