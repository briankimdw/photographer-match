// Bookings tab: native version of frontend/src/screens/Bookings.jsx.
// Calendar of your bookings (tap dates to see what's booked or find vendors who are free),
// "Needs your attention" cards, then Upcoming / Past (a segmented control here, where the
// web shows Upcoming plus a collapsible Past list).
import { listMyBookings } from '@shared/api/bookings.js'
import { availabilityByDay } from '@shared/api/catalog.js'
import { fmtChip, fromKey, isPast, toKey, today } from '@shared/lib/dates.js'
import { callName, money } from '@shared/lib/format.js'
import { deliversMedia } from '@shared/verticals/index.js'
import { useRouter, type Href } from 'expo-router'
import { CalendarX, ChevronRight, Clock, History, MapPin, Search, Star, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Avatar, Button, Chip, EmptyState, ErrorState, Loading, Screen, Segmented, SignInPrompt, Text } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { makeStyles, useTheme } from '@/theme'
import DatePicker from './DatePicker'
import type { Booking } from './NeedsAction'
import { StatusPill, statusLabel, useRefocus } from './parts'

// How to address the vendor: "Maya" or "The Glasshouse DTLA" (never just "The").
const callOf = (p?: { name?: string; shortName?: string } | null) => p?.shortName || callName(p?.name || '')

// What the client has to do next, per booking (web attentionFor). Payments aren't live
// yet, so an accepted booking can't be paid in the app: say so instead of faking it.
function attentionFor(b: Booking): { title: string; cta: string; to?: string } | null {
  if (b.status === 'countered') return { title: `New price offered: ${money(b.offer?.total ?? b.counterTotal)}`, cta: 'Review offer' }
  if (b.status === 'accepted') return { title: 'Accepted · deposit due', cta: 'Payments soon' }
  if (b.status === 'delivered') {
    return deliversMedia(b.vertical)
      ? { title: b.vertical === 'videography' ? 'Your video is ready' : 'Your photos are ready', cta: 'Review delivery', to: `/bookings/${b.id}/delivery` }
      : { title: `${callOf(b.provider as any) || 'Your vendor'} marked this done`, cta: 'Confirm' }
  }
  if (b.status === 'completed' && b.reviewWindowOpen && !b.myReview) return { title: 'How did it go?', cta: 'Leave a review', to: `/bookings/${b.id}/review` }
  return null
}

const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const countdown = (date: Date) => {
  const days = Math.round((+date - +today()) / 86400000)
  if (days < 0) return null
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 60) return `In ${days} days`
  return `In ${Math.round(days / 30)} months`
}

export default function Bookings() {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [month, setMonth] = useState(() => new Date(today().getFullYear(), today().getMonth(), 1))
  const [selected, setSelected] = useState<string[]>([])
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')

  const { data, loading, error, reload } = useQuery<Booking[]>(user ? () => listMyBookings() : null, [user?.id])
  useRefocus(reload)
  const bookings = data || []

  const byDay = bookings.reduce<Record<string, Booking[]>>((acc, b) => {
    ;(acc[b.dateKey] ??= []).push(b)
    return acc
  }, {})
  const dots = Object.fromEntries(Object.entries(byDay).map(([k, list]) => [k, list.map((b) => b.status)]))

  const attention = bookings.filter(attentionFor).sort((a, b) => +a.day - +b.day)
  const needs = new Set(attention.map((b) => b.id))
  const isUpcoming = (b: Booking) => b.isActive || b.status === 'disputed'
  const upcoming = bookings.filter((b) => !needs.has(b.id) && isUpcoming(b)).sort((a, b) => +a.start - +b.start)
  const past = bookings.filter((b) => !needs.has(b.id) && !isUpcoming(b)).sort((a, b) => +b.start - +a.start)

  const inMonth = (b: Booking) => b.day.getFullYear() === month.getFullYear() && b.day.getMonth() === month.getMonth()
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  const activeThisMonth = [...attention, ...upcoming].some(inMonth)
  const nextBooked = upcoming.find((b) => b.day >= monthEnd)

  const toggle = (key: string) => setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].sort()))
  const disabled = (d: Date) => isPast(d) && !byDay[toKey(d)]
  const futureSelected = selected.filter((k) => !isPast(fromKey(k)))
  const selectedBookings = selected.flatMap((k) => byDay[k] || [])

  // How many vendors are free on at least one of the picked dates (search is public).
  const freeKey = futureSelected.join(',')
  const { data: freeMap } = useQuery<Map<string, Set<string>>>(freeKey ? () => availabilityByDay(futureSelected) : null, [freeKey])
  const freeCount = freeMap ? new Set([...freeMap.values()].flatMap((x) => [...x])).size : null

  const activeCount = bookings.filter((b) => b.isActive || b.status === 'delivered').length
  const list = tab === 'upcoming' ? upcoming : past

  return (
    <Screen
      header={
        <View style={s.header}>
          <Text variant="display">Bookings</Text>
          {user && data && <Text variant="small" muted>{activeCount} active</Text>}
        </View>
      }
      refreshing={false}
      onRefresh={user ? reload : undefined}
    >
      <View style={s.pad}>
        <View style={s.cal}>
          <DatePicker selected={selected} onToggle={toggle} dots={dots} isDisabled={disabled} month={month} onMonthChange={setMonth} />
          {selected.length > 0 ? (
            <View style={s.calFoot}>
              <View style={s.between}>
                <View style={s.chips}>
                  {selected.map((k) => (
                    <Chip key={k} label={fmtChip(fromKey(k))} solid iconRight={X} onPress={() => toggle(k)} />
                  ))}
                </View>
                <Pressable onPress={() => setSelected([])} hitSlop={8} accessibilityRole="button">
                  <Text variant="small" muted>Clear</Text>
                </Pressable>
              </View>
              {selectedBookings.map((b) => <MiniBooking key={b.id} b={b} />)}
              {futureSelected.length > 0 && (
                <>
                  <Button
                    title={`Find vendors for ${futureSelected.length === 1 ? fmtChip(fromKey(futureSelected[0])) : `${futureSelected.length} dates`}`}
                    icon={Search}
                    variant="accent"
                    block
                    onPress={() => router.push({ pathname: '/search', params: { dates: futureSelected.join(',') } })}
                  />
                  {freeCount != null && (
                    <Text variant="tiny" muted center>
                      {freeCount === 0 ? 'Nobody is free then yet. Try other dates.' : `${freeCount} vendor${freeCount === 1 ? '' : 's'} free`}
                    </Text>
                  )}
                </>
              )}
            </View>
          ) : (
            <View style={[s.calFoot, s.between]}>
              <Text variant="tiny" muted style={s.shrink}>Tap the dates you need someone for</Text>
              {!activeThisMonth && nextBooked && (
                <Pressable
                  onPress={() => setMonth(new Date(nextBooked.day.getFullYear(), nextBooked.day.getMonth(), 1))}
                  style={s.jump}
                  accessibilityRole="button"
                >
                  <Text variant="tiny" color="accent" weight="600">
                    Next booking: {nextBooked.day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                  <ChevronRight size={12} color={c.accent} />
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>

      {authLoading ? (
        <Loading />
      ) : !user ? (
        <SignInPrompt title="Sign in to see your bookings" text="Your requests, upcoming events and past bookings show up here." />
      ) : loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          {attention.length > 0 && (
            <View style={s.pad}>
              <Text variant="h4" style={s.sectionTitle}>Needs your attention</Text>
              {attention.map((b) => <AttentionCard key={b.id} b={b} />)}
            </View>
          )}

          <View style={[s.pad, s.segWrap]}>
            <Segmented
              options={[
                { value: 'upcoming', label: `Upcoming${upcoming.length ? ` · ${upcoming.length}` : ''}` },
                { value: 'past', label: `Past${past.length ? ` · ${past.length}` : ''}` },
              ]}
              value={tab}
              onChange={setTab}
            />
          </View>

          <View style={s.pad}>
            {list.length === 0 ? (
              tab === 'upcoming' ? (
                <EmptyState
                  compact
                  icon={CalendarX}
                  title="Nothing coming up"
                  text={bookings.length ? 'Requests and confirmed bookings will show here.' : 'Book a photographer, caterer, DJ or venue and it shows up here.'}
                  action={<Button title="Find vendors" size="sm" onPress={() => router.push('/search')} />}
                />
              ) : (
                <EmptyState compact icon={History} text="Finished, declined and cancelled bookings will show here." />
              )
            ) : (
              list.map((b, i) => {
                const showMonth = tab === 'upcoming' && (i === 0 || monthLabel(b.day) !== monthLabel(list[i - 1].day))
                return (
                  <View key={b.id}>
                    {showMonth && <Text variant="label" style={s.monthLabel}>{monthLabel(b.day)}</Text>}
                    <TimelineItem b={b} past={tab === 'past'} />
                  </View>
                )
              })
            )}
          </View>
        </>
      )}
    </Screen>
  )
}

function AttentionCard({ b }: { b: Booking }) {
  const s = useStyles()
  const router = useRouter()
  const a = attentionFor(b)!
  return (
    <Pressable
      onPress={() => router.push((a.to || `/bookings/${b.id}`) as Href)}
      style={({ pressed }) => [s.attention, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${a.title}. ${a.cta}`}
    >
      <Avatar uri={b.provider.avatar} name={b.provider.name} size={44} />
      <View style={s.grow}>
        <Text variant="small" weight="700">{a.title}</Text>
        <Text variant="tiny" muted numberOfLines={2}>{b.packageName} with {callOf(b.provider as any)} · {b.date}</Text>
      </View>
      <View style={s.attCta}>
        <Text style={s.attCtaText}>{a.cta}</Text>
      </View>
    </Pressable>
  )
}

function TimelineItem({ b, past }: { b: Booking; past?: boolean }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const soon = countdown(b.day)
  const needsReview = b.status === 'completed' && b.reviewWindowOpen && !b.myReview
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: b.id } })}
      style={({ pressed }) => [s.item, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${b.packageName} with ${b.provider.name}, ${b.date}, ${statusLabel(b.status)}${needsReview ? ', leave a review' : ''}`}
    >
      <View style={[s.dateBlock, past && s.dateBlockPast]}>
        <Text style={[s.dateSmall, past && s.dateTextPast]}>{b.day.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</Text>
        <Text style={[s.dateBig, past && s.dateTextPast]}>{b.day.getDate()}</Text>
        <Text style={[s.dateSmall, past && s.dateTextPast]}>{b.day.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</Text>
      </View>
      <View style={[s.body, past && s.bodyPast]}>
        <View style={s.between}>
          <Text variant="small" weight="700" numberOfLines={1} style={s.shrink}>{b.packageName}</Text>
          <StatusPill status={b.status} />
        </View>
        <View style={s.who}>
          <Avatar uri={b.provider.avatar} name={b.provider.name} size="sm" />
          <Text variant="small" numberOfLines={1} style={s.shrink}>{b.provider.name}</Text>
        </View>
        <View style={s.meta}>
          <View style={s.metaItem}><Clock size={12} color={c.muted} /><Text variant="tiny" muted>{b.time}</Text></View>
          {!!b.location && (
            <View style={[s.metaItem, s.shrink]}><MapPin size={12} color={c.muted} /><Text variant="tiny" muted numberOfLines={1} style={s.shrink}>{b.location}</Text></View>
          )}
        </View>
        <View style={[s.between, s.mtXs]}>
          {!past && soon ? <View style={s.countdown}><Text style={s.countdownText}>{soon}</Text></View> : <View />}
          {needsReview ? (
            <View style={s.metaItem}><Star size={12} color={c.accent} /><Text variant="tiny" weight="700" color="accent">Leave a review</Text></View>
          ) : (
            <Text variant="tiny" muted>{money(b.offer?.total ?? b.total)}</Text>
          )}
        </View>
      </View>
    </Pressable>
  )
}

function MiniBooking({ b }: { b: Booking }) {
  const s = useStyles()
  const router = useRouter()
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: b.id } })}
      style={({ pressed }) => [s.mini, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${b.packageName}, ${fmtChip(b.day)}, ${b.time}, with ${b.provider.name}, ${statusLabel(b.status)}`}
    >
      <Avatar uri={b.provider.avatar} name={b.provider.name} size="sm" />
      <View style={s.grow}>
        <Text variant="small" weight="700" numberOfLines={1}>{b.packageName}</Text>
        <Text variant="tiny" muted numberOfLines={1}>{fmtChip(b.day)} · {b.time} · {b.provider.name}</Text>
      </View>
      <StatusPill status={b.status} />
    </Pressable>
  )
}

const useStyles = makeStyles((t) => {
  const dark = t.scheme === 'dark'
  return {
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.space.lg, paddingTop: 12, paddingBottom: 12 },
    pad: { paddingHorizontal: t.space.lg },
    cal: { borderWidth: 1, borderColor: t.c.line, borderRadius: 20, padding: 10, paddingBottom: 12, backgroundColor: t.c.card },
    calFoot: { borderTopWidth: 1, borderTopColor: t.c.line, marginTop: 8, paddingTop: 10, paddingHorizontal: 4, gap: 8 },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    jump: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    shrink: { flexShrink: 1 },
    grow: { flex: 1, minWidth: 0 },
    sectionTitle: { marginTop: 22, marginBottom: 10 },
    segWrap: { marginTop: 22, marginBottom: 12 },
    monthLabel: { marginTop: 4, marginBottom: 8, fontSize: 11.5, fontWeight: '700' },
    attention: {
      flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderRadius: 16,
      backgroundColor: t.c.accentSoft, borderWidth: 1, borderColor: dark ? '#5a2a1c' : '#ffd2c4',
    },
    attCta: { backgroundColor: t.c.accent, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10 },
    attCtaText: { color: t.c.onAccent, fontSize: 12, fontWeight: '700' },
    pressed: { opacity: 0.8 },
    item: { flexDirection: 'row', gap: 12, marginBottom: 12 },
    dateBlock: { width: 54, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 14, backgroundColor: t.c.ink, alignSelf: 'flex-start' },
    dateBlockPast: { backgroundColor: t.c.soft },
    dateSmall: { fontSize: 10.5, letterSpacing: 0.5, color: t.c.onInk, opacity: 0.75 },
    dateBig: { fontSize: 22, lineHeight: 26, fontWeight: '700', color: t.c.onInk },
    dateTextPast: { color: t.c.muted },
    body: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: t.c.line, borderRadius: 16, padding: 12, backgroundColor: t.c.card },
    bodyPast: { backgroundColor: dark ? t.c.soft : '#fcfcfc' },
    who: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    mtXs: { marginTop: 6 },
    countdown: { backgroundColor: dark ? '#13234a' : '#dbeafe', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    countdownText: { fontSize: 11.5, fontWeight: '700', color: dark ? '#93c5fd' : '#1d4ed8' },
    mini: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: t.c.soft },
  }
})
