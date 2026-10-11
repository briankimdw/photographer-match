// Booking UI bits shared by the bookings screens (the web's components/Booking.jsx):
// StatusPill, StatusTimeline, PolicyTable, plus small layout helpers (Row, InfoCard).
import { bookingSteps, statusLabels } from '@shared/lib/format.js'
import { useFocusEffect, useRouter } from 'expo-router'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react-native'
import { useCallback, useRef, type ReactNode } from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'

import { Avatar, IdVerified, InA11yGroup, ProBadge, Text } from '@/components'
import { makeStyles, useTheme, type Theme } from '@/theme'

const labels = statusLabels as Record<string, string>
/** "Requested", "Confirmed"... (for screen-reader labels of rows that show a StatusPill). */
export const statusLabel = (status: string) => labels[status] ?? status.replace(/_/g, ' ')

// The web's .s-<status> pill colors (styles.css), with dark-mode equivalents.
function pillColors(status: string, t: Theme): { bg: string; fg: string } {
  const dark = t.scheme === 'dark'
  switch (status) {
    case 'requested':
    case 'countered':
      return dark ? { bg: '#3a2a0a', fg: '#fcd34d' } : { bg: '#fef3c7', fg: '#92400e' }
    case 'accepted':
      return { bg: t.c.accentSoft, fg: t.c.accentInk }
    case 'confirmed':
    case 'in_progress':
      return dark ? { bg: '#13234a', fg: '#93c5fd' } : { bg: '#dbeafe', fg: '#1d4ed8' }
    case 'delivered':
      return dark ? { bg: '#2a1a4a', fg: '#c4b5fd' } : { bg: '#ede9fe', fg: '#6d28d9' }
    case 'completed':
      return dark ? { bg: '#0f2e1a', fg: '#86efac' } : { bg: '#dcfce7', fg: '#15803d' }
    case 'disputed':
    case 'declined':
    case 'cancelled_by_client':
    case 'cancelled_by_provider':
      return { bg: t.c.dangerSoft, fg: t.c.danger }
    default:
      return { bg: t.c.soft, fg: t.c.muted }
  }
}

export function StatusPill({ status }: { status: string }) {
  const t = useTheme()
  const { bg, fg } = pillColors(status, t)
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>{labels[status] || status}</Text>
    </View>
  )
}

const SIDE_BRANCHES = ['declined', 'expired', 'cancelled_by_client', 'cancelled_by_provider', 'disputed', 'refunded']
const STEP_LABELS: Record<string, string> = { ...labels, accepted: 'Accepted', countered: 'Counter offer' }

type History = { status: string; at: string }[]

// The booking state machine as a vertical timeline (web StatusTimeline).
export function StatusTimeline({ booking }: { booking: { status: string; history: History } }) {
  const s = useStyles()
  const { c } = useTheme()
  const reached = new Set(booking.history.map((h) => h.status))
  const at = (st: string) => booking.history.find((h) => h.status === st)?.at
  const branch = [...booking.history].reverse().find((h) => SIDE_BRANCHES.includes(h.status))
  const steps = (bookingSteps as string[]).flatMap((st) =>
    st === 'confirmed' ? [...['countered', 'accepted'].filter((x) => reached.has(x) || booking.status === x), st] : [st],
  )
  const rows = steps.map((st) => ({ key: st, label: STEP_LABELS[st], at: at(st), done: reached.has(st), current: booking.status === st, branch: false }))
  if (branch) rows.push({ key: `b-${branch.status}`, label: labels[branch.status], at: branch.at, done: false, current: true, branch: true })

  return (
    <View>
      {rows.map((r, i) => {
        const last = i === rows.length - 1
        const color = r.branch ? c.danger : r.done ? c.ink : c.muted
        return (
          <View key={r.key} style={s.tlRow}>
            <View style={s.tlRail}>
              <View
                style={[
                  s.dot,
                  r.done && { backgroundColor: c.ink, borderColor: c.ink },
                  r.current && !r.done && { borderColor: c.accent },
                  r.branch && { backgroundColor: c.danger, borderColor: c.danger },
                ]}
              >
                {r.done && <Check size={11} strokeWidth={3} color={c.bg} />}
              </View>
              {!last && <View style={[s.line, r.done && { backgroundColor: c.ink }]} />}
            </View>
            <View style={s.tlText}>
              <Text variant="body" weight={r.current ? '700' : '400'} style={{ color }}>{r.label}</Text>
              {!!r.at && <Text variant="tiny" muted>{r.at}</Text>}
            </View>
          </View>
        )
      })}
    </View>
  )
}

type Policy = { label: string; tiers: { when: string; refund: number }[] } | null | undefined

export function PolicyTable({ policy: p }: { policy: Policy }) {
  const s = useStyles()
  if (!p?.tiers?.length) return null
  return (
    <View style={s.policy}>
      <View style={s.policyHead}>
        <Text variant="small">
          Cancellation policy: <Text variant="small" weight="700">{p.label}</Text>
        </Text>
      </View>
      {p.tiers.map((t) => (
        <View key={t.when} style={s.policyRow}>
          <Text variant="small">{t.when}</Text>
          <Text variant="small" muted={!t.refund}>{t.refund}% refund</Text>
        </View>
      ))}
    </View>
  )
}

// "label ........ value" line (the web's .row.between in totals / detail cards).
export function Row({ label, value, bold, muted, style }: { label: ReactNode; value: ReactNode; bold?: boolean; muted?: boolean; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  const w = bold ? '700' : undefined
  return (
    <View style={[s.row, style]}>
      {typeof label === 'string' ? <Text variant="small" weight={w} muted={muted} style={s.shrink}>{label}</Text> : label}
      {typeof value === 'string' ? <Text variant="small" weight={w} muted={muted}>{value}</Text> : value}
    </View>
  )
}

export function Section({ title, children, right, style }: { title?: string; children: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  return (
    <View style={[s.section, style]}>
      {(title || right) && (
        <View style={s.sectionHead}>
          {!!title && <Text variant="h4">{title}</Text>}
          {right}
        </View>
      )}
      {children}
    </View>
  )
}

// A person (vendor or client) that opens their profile (the web's components/PersonRow.jsx).
type PersonLike = { id?: string; name?: string | null; avatar?: string | null; idVerified?: boolean; pro?: boolean }
export function PersonRow({ person, sub, right }: { person: PersonLike; sub?: string; right?: ReactNode }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  return (
    <View style={s.person}>
      <InA11yGroup value>
      <Pressable
        style={({ pressed }) => [s.personLink, pressed && { opacity: 0.7 }]}
        onPress={person.id ? () => router.push({ pathname: '/u/[id]', params: { id: person.id! } }) : undefined}
        accessibilityRole="link"
        accessibilityLabel={[person.name, person.idVerified && 'identity verified', person.pro && 'Verified Pro'].filter(Boolean).join(', ') || undefined}
      >
        <Avatar uri={person.avatar} name={person.name ?? ''} size="md" />
        <View style={s.personText}>
          <View style={s.personName}>
            <Text variant="body" weight="600" numberOfLines={1} style={s.shrink}>{person.name}</Text>
            {person.idVerified && <IdVerified />}
            {person.pro && <ProBadge />}
          </View>
          {!!sub && <Text variant="small" muted numberOfLines={1}>{sub}</Text>}
        </View>
        <ChevronRight size={16} color={c.muted} />
      </Pressable>
      </InA11yGroup>
      {right}
    </View>
  )
}

// A tinted message box (the web's .callout / .callout.accent / .callout.danger).
export function Callout({ tone = 'default', title, text, children, style }: {
  tone?: 'default' | 'accent' | 'danger'; title?: ReactNode; text?: ReactNode; children?: ReactNode; style?: StyleProp<ViewStyle>
}) {
  const s = useStyles()
  return (
    <View style={[s.callout, tone === 'accent' && s.calloutAccent, tone === 'danger' && s.calloutDanger, style]}>
      {typeof title === 'string' ? <Text variant="body" weight="700">{title}</Text> : title}
      {typeof text === 'string' ? <Text variant="small" muted>{text}</Text> : text}
      {children}
    </View>
  )
}

// A soft info line with a leading icon (the web's .note).
export function Note({ icon: Icon, children, style }: { icon?: LucideIcon; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={[s.note, style]}>
      {Icon && <Icon size={16} color={c.muted} style={s.noteIcon} />}
      <Text variant="small" style={s.noteText}>{children}</Text>
    </View>
  )
}

// A bordered summary block (the web's .summary).
export function Summary({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles()
  return <View style={[s.summary, style]}>{children}</View>
}

export function TotalRow({ label, value }: { label: string; value: string }) {
  const s = useStyles()
  return <Row label={label} value={value} bold style={s.total} />
}

// Reload a query when the screen comes back into focus (not on the first focus,
// where useQuery already loads): bookings change on other screens.
export function useRefocus(reload: () => void) {
  const first = useRef(true)
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false
        return
      }
      reload()
    }, [reload]),
  )
}

const useStyles = makeStyles((t) => ({
  tlRow: { flexDirection: 'row', gap: 12 },
  tlRail: { width: 20, alignItems: 'center' },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: t.c.line, backgroundColor: t.c.bg, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, minHeight: 14, backgroundColor: t.c.line },
  tlText: { flex: 1, paddingBottom: 14 },
  policy: { borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg, overflow: 'hidden' },
  policyHead: { paddingVertical: 10, paddingHorizontal: 12, backgroundColor: t.c.soft },
  policyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: t.c.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 3 },
  shrink: { flexShrink: 1 },
  section: { paddingHorizontal: t.space.lg, paddingTop: t.space.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: t.space.lg, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.c.line },
  personLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  personText: { flex: 1, minWidth: 0 },
  personName: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  callout: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: t.radius.lg, backgroundColor: t.c.soft, marginTop: 12, gap: 2 },
  calloutAccent: { backgroundColor: t.c.accentSoft },
  calloutDanger: { backgroundColor: t.c.dangerSoft },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: t.radius.md, backgroundColor: t.c.soft },
  noteIcon: { marginTop: 1 },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: t.scheme === 'dark' ? t.c.muted : '#444' },
  summary: { borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg, padding: 12, gap: 3 },
  total: { borderTopWidth: 1, borderTopColor: t.c.line, paddingTop: 8, marginTop: 4 },
}))
