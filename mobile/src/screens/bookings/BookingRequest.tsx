// Request a booking: native version of frontend/src/screens/BookingRequest.jsx.
// Package (with its price unit), hours or a Guests / Items quantity for per-person and
// per-item packages, dates from a 4-week strip showing the vendor's free days (dates from a
// search arrive pre-selected via ?dates=), a start time, location, add-ons, notes and a live total.
// Each selected date becomes its own request.
import { bookingError, requestBooking } from '@shared/api/bookings.js'
import { freeDays, getProvider } from '@shared/api/catalog.js'
import { addDays, fmtBooking, fmtChip, fromKey, isPast, parseDates, toKey, today } from '@shared/lib/dates.js'
import { callName, money, priceLabel } from '@shared/lib/format.js'
import { attributeLines, quantityFor, sessionNoun, verticalConfig } from '@shared/verticals/index.js'
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router'
import { CalendarX, Check, Info, MapPin, Minus, Plus } from 'lucide-react-native'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'

import { Button, Chip, EmptyState, ErrorState, Loading, Screen, Text, TextField } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'
import type { Package, Provider } from '@/types'
import { Callout, Note, PersonRow, PolicyTable, Row, Summary, TotalRow } from './parts'

// Start times offered (sent as HH:MM in the vendor's time zone).
const TIMES: [string, string][] = [
  ['09:00', '9:00 AM'],
  ['11:00', '11:00 AM'],
  ['14:00', '2:00 PM'],
  ['16:00', '4:00 PM'],
  ['18:00', '6:00 PM'],
]
const STRIP_DAYS = 28
const MAX_DATES = 14 // the database accepts at most 14 dates per request
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Params = { providerId: string; pkg?: string; dates?: string; event?: string }
type Qty = { type: string; label: string; min: number; max: number; default: number }
type Addon = { id: string; name: string; price: number | null }
type Pkg = Package & { id: string; name: string; priceType: string; price: number | null; hours: number | null; depositPct: number | null; attributes: Record<string, unknown> }

export default function BookingRequest() {
  const { providerId } = useLocalSearchParams<Params>()
  const q = useQuery<Provider | null>(() => getProvider(providerId) as Promise<Provider | null>, [providerId])
  const p = q.data

  if (q.loading && !p) return <Screen title="Request booking" back><Loading /></Screen>
  if (q.error) return <Screen title="Request booking" back><ErrorState error={q.error} onRetry={q.reload} /></Screen>
  if (!p) return <Screen title="Request booking" back><EmptyState icon={CalendarX} title="Listing not found" text="This listing may have been removed." /></Screen>
  if (!p.packages.length) {
    return (
      <Screen title="Request booking" back>
        <EmptyState icon={CalendarX} title="No packages yet" text={`${p.name} hasn’t published any packages to book. Send them a message instead.`} />
      </Screen>
    )
  }
  return <RequestForm p={p} />
}

function RequestForm({ p }: { p: Provider }) {
  const s = useStyles()
  const { c } = useTheme()
  const params = useLocalSearchParams<Params>()
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useStore()
  const { user } = useAuth()
  const first = (p as any).shortName || callName(p.name)
  const isMine = !!user && user.id === p.profileId
  const addonsList = (p.addons || []) as Addon[]
  const packages = p.packages as Pkg[]

  const [pkgId, setPkgId] = useState(() => (packages.some((x) => x.id === params.pkg) ? params.pkg! : packages[0].id))
  const [hours, setHours] = useState<number | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  const [requestedDates] = useState<string[]>(() => (parseDates(params.dates ?? null) as string[]).filter((k) => !isPast(fromKey(k))))
  const [dates, setDates] = useState<string[]>(requestedDates)
  const [time, setTime] = useState('14:00')
  const [loc, setLoc] = useState('')
  const [addons, setAddons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // The next few weeks plus any dates carried over from a search: which ones is this vendor free on?
  const stripKeys = useMemo(() => Array.from({ length: STRIP_DAYS }, (_, i) => toKey(addDays(today(), i + 1))), [])
  const checkKeys = useMemo(() => [...new Set([...stripKeys, ...requestedDates])].sort(), [stripKeys, requestedDates])
  const { data: free, loading: freeLoading } = useQuery<Set<string>>(() => freeDays(p.id, checkKeys), [p.id, checkKeys.join(',')])
  // `free` is undefined while loading or if the check failed; the database re-checks on submit anyway.
  const isBusy = (k: string) => !!free && !free.has(k)

  useEffect(() => {
    if (free) setDates((ds) => ds.filter((k) => free.has(k)))
  }, [free])

  const toggleDate = (k: string) => {
    setSendError(null)
    setDates((ds) => (ds.includes(k) ? ds.filter((x) => x !== k) : ds.length >= MAX_DATES ? ds : [...ds, k].sort()))
  }

  const pkg = packages.find((x) => x.id === pkgId)!
  const config = verticalConfig(p.vertical)
  const isQuote = pkg.priceType === 'quote' || pkg.price == null
  const isHourly = pkg.priceType === 'hourly'
  const isDaily = pkg.priceType === 'daily'
  const hrs = hours ?? pkg.hours ?? 1
  const qty = quantityFor(pkg, p.vertical) as Qty | null
  const count = qty ? Math.min(qty.max, Math.max(qty.min, quantity ?? qty.default)) : null
  const price = pkg.price ?? 0
  const base = isQuote ? 0 : isHourly ? price * hrs : qty ? price * count! : price
  const chosenAddons = addonsList.filter((a) => addons.includes(a.id))
  const addonTotal = chosenAddons.reduce((sum, a) => sum + (a.price ?? 0), 0)
  const total = base + addonTotal
  const deposit = Math.round(total * (pkg.depositPct ?? 0)) / 100

  const send = async () => {
    if (!user) {
      // Keep the whole request (incl. ?event= from an event's board) for after signing in.
      const query = new URLSearchParams({
        ...(params.pkg ? { pkg: params.pkg } : {}),
        ...(params.dates ? { dates: params.dates } : {}),
        ...(params.event ? { event: params.event } : {}),
      }).toString()
      router.push({ pathname: '/sign-in', params: { next: `${pathname}${query ? `?${query}` : ''}` } })
      return
    }
    setSending(true)
    setSendError(null)
    try {
      const rows: any[] = await requestBooking({
        packageId: pkg.id,
        dates,
        startTime: time,
        hours: isHourly ? hrs : null,
        quantity: qty ? count : null,
        addonIds: addons,
        location: loc.trim(),
        notes: note.trim(),
        eventId: params.event || null, // from an event's board (/events/[id])
      } as any)
      toast(rows.length > 1 ? `${rows.length} requests sent. ${first} has 48h to respond.` : `Request sent. ${first} has 48h to respond.`)
      if (rows.length === 1) router.replace({ pathname: '/bookings/[id]', params: { id: rows[0].id } })
      else router.replace('/bookings')
    } catch (err) {
      const msg = bookingError(err)
      setSendError(msg)
      toast(msg)
      setSending(false)
    }
  }

  const buttonTitle = sending
    ? 'Sending…'
    : dates.length === 0
      ? 'Pick a date'
      : !user
        ? 'Sign in to send request'
        : dates.length === 1
          ? `Send request · ${fmtBooking(fromKey(dates[0]))}`
          : `Send ${dates.length} requests`

  return (
    <Screen title="Request booking" back>
      <PersonRow person={p} sub={[p.rating != null ? `${p.rating.toFixed(1)} ★` : 'New', p.serviceArea].join(' · ')} />
      <View style={s.pad}>
        <Text variant="h4" style={s.sectionTitle}>Package</Text>
        {packages.map((x) => {
          const on = pkgId === x.id
          const facts = [x.hours && `${x.hours}h`, ...attributeLines(config.packageFields, x.attributes, config.packageKeys)].filter(Boolean).join(' · ')
          return (
            <Pressable
              key={x.id}
              onPress={() => { setPkgId(x.id); setHours(null); setQuantity(null) }}
              style={[s.option, on && s.optionOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }} aria-checked={on}
              accessibilityLabel={`${x.name}, ${priceLabel(x)}`}
            >
              <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
              <View style={s.grow}>
                <Text variant="body" weight="700">{x.name}</Text>
                {!!facts && <Text variant="small" muted>{facts}</Text>}
              </View>
              <Text variant="body" weight="700">{priceLabel(x)}</Text>
            </Pressable>
          )
        })}

        {isHourly && (
          <View style={[s.between, s.mtSm]}>
            <Text variant="small">Hours</Text>
            <Stepper
              value={hrs}
              label="hours"
              canDec={hrs > 1}
              canInc={hrs < 12}
              onDec={() => setHours(Math.max(1, hrs - 0.5))}
              onInc={() => setHours(Math.min(12, hrs + 0.5))}
            />
          </View>
        )}

        {qty && !isQuote && <QuantityStepper qty={qty} value={count!} onChange={setQuantity} priceText={priceLabel(pkg)} />}

        <Text variant="h4" style={s.sectionTitle}>{dates.length > 1 ? `Dates (${dates.length})` : 'Date'}</Text>
        {requestedDates.length > 0 && (
          <>
            <Text variant="tiny" muted>
              Your dates{free ? ` · ${first} is free on ${requestedDates.filter((k) => free.has(k)).length} of ${requestedDates.length}` : ''}
            </Text>
            <View style={[s.chips, s.mtXs]}>
              {requestedDates.map((k) => (
                <Chip
                  key={k}
                  label={`${fmtChip(fromKey(k))}${isBusy(k) ? ' · busy' : ''}`}
                  toggle
                  on={dates.includes(k)}
                  onPress={isBusy(k) ? undefined : () => toggleDate(k)}
                  style={isBusy(k) ? s.busyChip : undefined}
                />
              ))}
            </View>
            <Text variant="tiny" muted style={s.mtSm}>Or pick from the next 4 weeks</Text>
          </>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip} style={freeLoading && !free ? s.pending : undefined}>
        {stripKeys.map((k) => {
          const d = fromKey(k)
          const busy = isBusy(k)
          const on = dates.includes(k)
          return (
            <Pressable
              key={k}
              onPress={() => toggleDate(k)}
              disabled={busy}
              style={[s.day, busy && s.dayBusy, on && s.dayOn]}
              accessibilityRole="button"
              accessibilityLabel={busy ? `${fmtBooking(d)}: ${first} isn’t available` : fmtBooking(d)}
              accessibilityState={{ selected: on, disabled: busy }}
            >
              <Text style={[s.dayWeek, on && s.dayTextOn]}>{WEEKDAYS[d.getDay()]}</Text>
              <Text style={[s.dayNum, busy && s.dayNumBusy, on && s.dayTextOn]}>{d.getDate()}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      <View style={s.pad}>
        <Text variant="tiny" muted style={s.mtXs}>
          {freeLoading ? 'Checking availability…' : free ? 'Crossed-out days are booked or outside working hours.' : ''}
        </Text>
        <View style={[s.chips, s.mtSm]}>
          {TIMES.map(([value, label]) => (
            <Chip key={value} label={label} toggle on={time === value} onPress={() => setTime(value)} />
          ))}
        </View>

        <Text variant="h4" style={s.sectionTitle}>Location</Text>
        <TextField placeholder="Venue or address" value={loc} onChangeText={setLoc} />
        <View style={[s.inline, s.mtXs]}>
          <MapPin size={12} color={c.muted} />
          <Text variant="tiny" muted style={s.shrink}>{p.serviceArea}. {p.travelFee}.</Text>
        </View>

        {addonsList.length > 0 && (
          <>
            <Text variant="h4" style={s.sectionTitle}>Add-ons</Text>
            {addonsList.map((a) => {
              const on = addons.includes(a.id)
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAddons(on ? addons.filter((x) => x !== a.id) : [...addons, a.id])}
                  style={s.checkRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }} aria-checked={on}
                >
                  <View style={[s.check, on && s.checkOn]}>{on && <Check size={13} color={c.onInk} strokeWidth={3} />}</View>
                  <Text variant="body" style={s.grow}>{a.name}</Text>
                  <Text variant="body">+{money(a.price)}</Text>
                </Pressable>
              )
            })}
          </>
        )}

        <Text variant="h4" style={s.sectionTitle}>Notes for {first}</Text>
        <TextField placeholder={`Tell them about your ${sessionNoun(p.vertical)}…`} value={note} onChangeText={setNote} multiline style={s.textarea} />

        <Text variant="h4" style={s.sectionTitle}>Price</Text>
        {isQuote ? (
          <Note icon={Info}>This package is quote-based. {first} will reply with a custom price.</Note>
        ) : (
          <Summary>
            <Row
              label={`${pkg.name}${isHourly ? ` (${hrs}h × ${money(price)})` : qty ? ` (${count} ${qty.label.toLowerCase()} × ${money(price)})` : ''}`}
              value={money(base)}
            />
            {chosenAddons.map((a) => <Row key={a.id} label={a.name} value={money(a.price)} />)}
            <TotalRow label={dates.length > 1 ? (isDaily ? 'Per day' : 'Per date') : 'Total'} value={money(total)} />
            {dates.length > 1 && <TotalRow label={`Total for ${dates.length} ${isDaily ? 'days' : 'dates'}`} value={money(total * dates.length)} />}
            {(pkg.depositPct ?? 0) > 0 && (
              <Row label={`Deposit to confirm (${pkg.depositPct}%)${dates.length > 1 ? ', per date' : ''}`} value={money(deposit)} muted />
            )}
            <Text variant="tiny" muted style={s.mtXs}>Travel outside the service area isn’t included. {first} will confirm any travel fee.</Text>
          </Summary>
        )}

        <View style={s.mt}>
          <PolicyTable policy={p.cancellationPolicy} />
        </View>

        <Note icon={Info} style={s.mt}>
          Sending a request doesn’t charge you. {first} has 48 hours to accept, decline or offer a different price. In-app deposits are coming soon.
        </Note>

        {isMine && <Callout tone="danger" text="This is your own listing, so you can’t book it." />}
        {!!sendError && <Callout tone="danger" text={sendError} />}

        <Button title={buttonTitle} variant="accent" block disabled={!dates.length || sending || isMine} loading={sending} onPress={send} style={s.mtLg} />
      </View>
    </Screen>
  )
}

function Stepper({ value, label, canDec, canInc, onDec, onInc, children }: {
  value: number; label: string; canDec: boolean; canInc: boolean; onDec: () => void; onInc: () => void; children?: ReactNode
}) {
  const s = useStyles()
  const { c } = useTheme()
  // Without a typed field: one "adjustable" element (VoiceOver / TalkBack: swipe up / down).
  // With one (guests / items), the field and the − / + buttons stay separate so the number can be typed.
  const adjustable = !children
  return (
    <View
      style={s.stepper}
      accessible={adjustable}
      accessibilityRole={adjustable ? 'adjustable' : undefined}
      accessibilityLabel={adjustable ? label : undefined}
      accessibilityValue={adjustable ? { text: `${value} ${label}` } : undefined}
      accessibilityActions={adjustable ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && canInc) onInc()
        if (e.nativeEvent.actionName === 'decrement' && canDec) onDec()
      }}
    >
      <Pressable onPress={onDec} disabled={!canDec} style={[s.stepBtn, !canDec && s.stepOff]} accessibilityRole="button" accessibilityLabel={`Fewer ${label}`} accessibilityState={{ disabled: !canDec }} hitSlop={8}>
        <Minus size={14} color={c.ink} />
      </Pressable>
      {children ?? <Text variant="body" weight="700" style={s.stepValue} maxFontSizeMultiplier={1.5}>{value}</Text>}
      <Pressable onPress={onInc} disabled={!canInc} style={[s.stepBtn, !canInc && s.stepOff]} accessibilityRole="button" accessibilityLabel={`More ${label}`} accessibilityState={{ disabled: !canInc }} hitSlop={8}>
        <Plus size={14} color={c.ink} />
      </Pressable>
    </View>
  )
}

// Guests / items for a package priced per person or per item. Tap − / + or type a number;
// min / max come from the package (min_quantity / max_quantity).
function QuantityStepper({ qty, value, onChange, priceText }: { qty: Qty; value: number; onChange: (n: number) => void; priceText: string }) {
  const s = useStyles()
  const [draft, setDraft] = useState<string | null>(null)
  const step = qty.max >= 200 && value >= 20 ? 5 : 1
  const clamp = (n: number) => Math.min(qty.max, Math.max(qty.min, Math.round(n)))
  const commit = () => {
    if (draft != null && draft.trim() !== '' && !Number.isNaN(Number(draft))) onChange(clamp(Number(draft)))
    setDraft(null)
  }
  const range = qty.max < 100000 && qty.min > 1 ? `${qty.min}–${qty.max.toLocaleString()}` : qty.min > 1 ? `at least ${qty.min}` : `up to ${qty.max.toLocaleString()}`
  return (
    <View style={s.qtyRow}>
      <View style={s.shrink}>
        <Text variant="small" weight="700">{qty.label}</Text>
        <Text variant="tiny" muted>{range} · {priceText}</Text>
      </View>
      <Stepper
        value={value}
        label={qty.label.toLowerCase()}
        canDec={value > qty.min}
        canInc={value < qty.max}
        onDec={() => onChange(clamp(value - step))}
        onInc={() => onChange(clamp(value + step))}
      >
        <TextInput
          value={draft ?? String(value)}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          returnKeyType="done"
          selectTextOnFocus
          accessibilityLabel={`${qty.label}, ${range}`}
          accessibilityHint="Type a number, or use the Fewer and More buttons"
          // Screen readers: step without leaving the field (actions menu / rotor).
          accessibilityActions={[{ name: 'increment', label: `More ${qty.label.toLowerCase()}` }, { name: 'decrement', label: `Fewer ${qty.label.toLowerCase()}` }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') onChange(clamp(value + step))
            if (e.nativeEvent.actionName === 'decrement') onChange(clamp(value - step))
          }}
          maxFontSizeMultiplier={1.5}
          style={s.qtyInput}
        />
      </Stepper>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  pad: { paddingHorizontal: t.space.lg },
  sectionTitle: { marginTop: 22, marginBottom: 10 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mtXs: { marginTop: 4 },
  mtSm: { marginTop: 8 },
  mt: { marginTop: 16 },
  mtLg: { marginTop: 24 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg, padding: 12, marginBottom: 8 },
  optionOn: { borderColor: t.c.ink, borderWidth: 2, padding: 11 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: t.c.faint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: t.c.ink },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.c.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: t.c.line, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8 },
  stepBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
  stepOff: { opacity: 0.35 },
  stepValue: { minWidth: 34, textAlign: 'center' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg },
  qtyInput: { width: 54, textAlign: 'center', fontWeight: '700', fontSize: 15, color: t.c.ink, paddingVertical: 2 },
  busyChip: { opacity: 0.45 },
  strip: { gap: 6, paddingHorizontal: t.space.lg, paddingTop: 10 },
  pending: { opacity: 0.45 },
  day: { width: 44, alignItems: 'center', paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: t.c.line },
  dayBusy: { backgroundColor: t.c.soft },
  dayOn: { backgroundColor: t.c.ink, borderColor: t.c.ink },
  dayWeek: { fontSize: 11, color: t.c.muted },
  dayNum: { fontSize: 15, fontWeight: '700', color: t.c.ink },
  dayNumBusy: { color: t.c.faint, textDecorationLine: 'line-through' },
  dayTextOn: { color: t.c.onInk },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.c.line },
  check: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: t.c.faint, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: t.c.ink, borderColor: t.c.ink },
  textarea: { minHeight: 76, textAlignVertical: 'top' },
}))
