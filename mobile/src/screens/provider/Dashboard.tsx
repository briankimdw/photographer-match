// Provider work tabs shown on the Me tab in business mode: native port of
// frontend/src/screens/Dashboard.jsx (Requests, Calendar, Packages, Portfolio).
//   provider: getProvider() result (may still be loading)
//   bookings: useQuery result of listProviderBookings
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Clock, Copy, EyeOff, Inbox, Package as PackageIcon, Plus, Star } from 'lucide-react-native'
import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'

import { bookingError, respondToBooking } from '@shared/api/bookings.js'
import { getServices } from '@shared/api/catalog.js'
import { listMyAlbums, publicUrl } from '@shared/api/portfolio.js'
import {
  addBlackout, createPackage, listBlackouts, listMyPackages, listWorkingHours, removeBlackoutDay, setPackageActive, updatePackage, updateProviderAttributes,
} from '@shared/api/provider.js'
import { fmtBooking, today, toKey } from '@shared/lib/dates.js'
import { money, priceLabel } from '@shared/lib/format.js'
import { PRICE_TYPES, attributeLines, cleanAttributes, verticalConfig, verticalMeta } from '@shared/verticals/index.js'
import { Avatar, Button, Card, Chip, ChipRow, EmptyState, ErrorState, Loading, Photo, Segmented, Sheet, Text, TextField } from '@/components'
import useQuery, { type QueryState } from '@/hooks/useQuery'
import { StatusPill } from '@/screens/bookings/parts'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'
import { FormError } from '../account/ui'
import AttributeList from './AttributeList'
import PackageFields, { type FieldDef } from './PackageFields'
import ServiceArea from './ServiceArea'
import Stepper from './Stepper'

// Booking statuses that fill a day on the calendar, and ones that hold it while pending.
export const BOOKED = ['confirmed', 'in_progress', 'delivered', 'completed']
const HELD = ['requested', 'countered', 'accepted']

export type DashTab = 'requests' | 'calendar' | 'packages' | 'portfolio'

type Props = { tab: DashTab; onTabChange: (t: DashTab) => void; provider: any; bookings: QueryState<any[]>; onProviderChanged: () => void }

export default function Dashboard({ tab, onTabChange, provider, bookings, onProviderChanged }: Props) {
  const s = useStyles()
  const { myProvider } = useStore()
  const pending = (bookings?.data || []).filter((r) => r.status === 'requested').length
  // Non-visual services (DJs, planners...) don't get a Portfolio tab unless they've posted.
  const showPortfolio = verticalMeta(myProvider?.vertical).visual || (provider?.albumCount ?? 0) > 0
  const current: DashTab = tab === 'portfolio' && !showPortfolio ? 'packages' : tab

  return (
    <View style={s.pad}>
      <Segmented<DashTab>
        options={[
          { value: 'requests', label: pending ? `Requests · ${pending}` : 'Requests' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'packages', label: 'Packages' },
          ...(showPortfolio ? [{ value: 'portfolio' as DashTab, label: 'Portfolio' }] : []),
        ]}
        value={current}
        onChange={onTabChange}
      />
      {current === 'requests' && <Requests bookings={bookings} />}
      {current === 'calendar' && <ProviderCalendar bookings={bookings} provider={provider} onProviderChanged={onProviderChanged} />}
      {current === 'packages' && <Packages provider={provider} onChanged={onProviderChanged} />}
      {current === 'portfolio' && <Portfolio />}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function Requests({ bookings }: { bookings: QueryState<any[]> }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { toast } = useStore()
  const [counterFor, setCounterFor] = useState<any | null>(null)
  const [counterPrice, setCounterPrice] = useState('')
  const [counterNote, setCounterNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  if (bookings.loading && !bookings.data) return <Loading inline />
  if (bookings.error) return <ErrorState error={bookings.error} onRetry={bookings.reload} />

  // New requests first, then ones waiting on the client.
  const order: Record<string, number> = { requested: 0, countered: 1, accepted: 2 }
  const list = (bookings.data || []).filter((r) => r.status in order).sort((a, b) => order[a.status] - order[b.status] || a.start - b.start)

  const respond = async (r: any, action: 'accept' | 'decline' | 'counter', extra?: { total: number; message: string | null }) => {
    setBusy(r.id)
    try {
      await respondToBooking(r.id, action, extra as any)
      const first = r.client.name?.split(' ')[0] || 'The client'
      toast(action === 'accept' ? `Accepted. ${first} will be asked to pay the deposit.` : action === 'counter' ? 'Counter offer sent' : 'Request declined')
      bookings.reload()
      return true
    } catch (e) {
      toast(bookingError(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  const sendCounter = async () => {
    if (await respond(counterFor, 'counter', { total: Number(counterPrice), message: counterNote.trim() || null })) setCounterFor(null)
  }

  if (!list.length) {
    return (
      <View style={s.mt}>
        <EmptyState compact icon={Inbox} title="No requests right now" text="New booking requests from clients show up here." />
      </View>
    )
  }

  return (
    <View style={s.mt}>
      {list.map((r) => (
        <Card key={r.id} style={s.card}>
          <View style={s.row}>
            <Pressable onPress={() => router.push({ pathname: '/u/[id]', params: { id: r.client.id } })} accessibilityRole="link" accessibilityLabel={`${r.client.name}'s profile`}>
              <Avatar uri={r.client.avatar} name={r.client.name} />
            </Pressable>
            <View style={s.grow}>
              <Text weight="700" onPress={() => router.push({ pathname: '/u/[id]', params: { id: r.client.id } })} accessibilityRole="link">{r.client.name}</Text>
              {r.client.rating ? (
                <View style={s.inline}>
                  <Star size={11} color={c.star} fill={c.star} />
                  <Text variant="tiny">{r.client.rating.toFixed(1)} as a client ({r.client.reviews})</Text>
                </View>
              ) : (
                <Text variant="tiny" muted>New client, no ratings yet</Text>
              )}
              {r.client.verified && <Text variant="tiny" color="id">Verified client</Text>}
            </View>
            <Text weight="700">{money(r.total)}</Text>
          </View>
          <Pressable onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: r.id } })} style={s.mtSm} accessibilityRole="link">
            <Text variant="small"><Text variant="small" weight="700">{r.packageName}</Text> · {r.date} · {r.time}</Text>
          </Pressable>
          {!!r.location && <Text variant="small" muted>{r.location}</Text>}
          {!!r.note && <View style={s.quote}><Text variant="small">“{r.note}”</Text></View>}

          {r.status === 'requested' ? (
            <>
              {!!r.expiresIn && (
                <View style={[s.inline, s.mtSm]}>
                  <Clock size={12} color={c.warn} />
                  <Text variant="tiny" color="warn">Expires in {r.expiresIn}</Text>
                </View>
              )}
              <View style={[s.row, s.mtSm]}>
                <Button title="Accept" size="sm" grow disabled={busy === r.id} onPress={() => respond(r, 'accept')} />
                <Button title="Counter" size="sm" variant="ghost" grow disabled={busy === r.id}
                  onPress={() => { setCounterFor(r); setCounterPrice(r.total == null ? '' : String(r.total)); setCounterNote('') }} />
                <Button title="Decline" size="sm" variant="danger" grow disabled={busy === r.id} onPress={() => respond(r, 'decline')} />
              </View>
            </>
          ) : (
            <Text variant="small" style={s.mtSm}>
              {r.status === 'accepted' && '✓ Accepted · waiting for deposit'}
              {r.status === 'countered' && `Counter sent: ${money(r.counterTotal)} · waiting for ${r.client.name?.split(' ')[0] || 'the client'}`}
            </Text>
          )}
        </Card>
      ))}

      <Sheet open={!!counterFor} onClose={() => setCounterFor(null)} title="Send a counter offer">
        {counterFor && (
          <>
            <Text variant="small" muted>{counterFor.client.name} · {counterFor.packageName} · {counterFor.date}</Text>
            <TextField label="Your price ($)" keyboardType="decimal-pad" value={counterPrice} onChangeText={(v) => setCounterPrice(v.replace(/[^0-9.]/g, ''))} containerStyle={s.mt} />
            <TextField label="Message" multiline placeholder="Explain the change" value={counterNote} onChangeText={setCounterNote} style={s.textarea} containerStyle={s.mtSm} />
            <Button
              title={busy === counterFor.id ? 'Sending…' : 'Send counter'}
              block
              disabled={!counterPrice || Number(counterPrice) < 0 || busy === counterFor.id}
              onPress={sendCounter}
              style={s.mt}
            />
          </>
        )}
      </Sheet>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday first
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtHour = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`
}
// [{weekday, start, end}] -> "Tue–Sun, 8 AM – 8 PM" (one line per distinct set of hours).
function hoursSummary(rules: { weekday: number; start: string; end: string }[]) {
  const groups = new Map<string, { start: string; end: string; days: Set<number> }>()
  for (const r of rules) {
    const k = `${r.start}-${r.end}`
    if (!groups.has(k)) groups.set(k, { start: r.start, end: r.end, days: new Set() })
    groups.get(k)!.days.add(r.weekday)
  }
  return [...groups.values()].map((g) => {
    const idx = WEEK_ORDER.map((d) => g.days.has(d))
    const runs: string[] = []
    for (let i = 0; i < 7; i++) {
      if (!idx[i]) continue
      let j = i
      while (j + 1 < 7 && idx[j + 1]) j++
      runs.push(j - i >= 2 ? `${DAY_NAMES[WEEK_ORDER[i]]}–${DAY_NAMES[WEEK_ORDER[j]]}` : WEEK_ORDER.slice(i, j + 1).map((d) => DAY_NAMES[d]).join(', '))
      i = j
    }
    return `${runs.join(', ')}, ${fmtHour(g.start)} – ${fmtHour(g.end)}`
  })
}

function ProviderCalendar({ bookings, provider, onProviderChanged }: { bookings: QueryState<any[]>; provider: any; onProviderChanged: () => void }) {
  const s = useStyles()
  const t = useTheme()
  const { c } = t
  const { myProvider, toast } = useStore()
  const providerId: string | undefined = myProvider?.id
  const tz: string = myProvider?.timezone || provider?.timezone || 'America/Los_Angeles'
  const [month, setMonth] = useState(() => {
    const d = today()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [busyDay, setBusyDay] = useState<string | null>(null)
  const blackouts = useQuery<any[]>(providerId ? () => listBlackouts(providerId, tz) : null, [providerId, tz])
  const hours = useQuery<any[]>(providerId ? () => listWorkingHours(providerId) : null, [providerId])

  // 'YYYY-MM-DD' -> 'booked' | 'held' | 'blackout'
  const state: Record<string, 'booked' | 'held' | 'blackout'> = {}
  const blackoutByDay: Record<string, any> = {}
  for (const b of blackouts.data || []) for (const d of b.days) { state[d] = 'blackout'; blackoutByDay[d] = b }
  for (const b of bookings?.data || []) {
    if (BOOKED.includes(b.status)) state[b.dateKey] = 'booked'
    else if (HELD.includes(b.status) && state[b.dateKey] !== 'booked') state[b.dateKey] = 'held'
  }

  const year = month.getFullYear()
  const m = month.getMonth()
  const daysInMonth = new Date(year, m + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array(month.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, m, i + 1))]
  while (cells.length % 7) cells.push(null)
  const todayKey = toKey(today())

  const toggleBlackout = async (day: Date) => {
    const key = toKey(day)
    if (!providerId || busyDay || key < todayKey) return
    if (state[key] === 'booked' || state[key] === 'held') return toast('That day has a booking. Manage it from the request.')
    setBusyDay(key)
    try {
      if (state[key] === 'blackout') {
        await removeBlackoutDay(providerId, blackoutByDay[key], key, tz)
        toast(`${fmtBooking(day)} is open again`)
      } else {
        await addBlackout(providerId, key, tz)
        toast(`Blocked off ${fmtBooking(day)}`)
      }
      blackouts.reload()
    } catch (e: any) {
      console.warn(e)
      toast('Couldn’t update your calendar: ' + (e?.message || 'try again'))
    } finally {
      setBusyDay(null)
    }
  }

  const cellStyle = (st?: string) =>
    st === 'booked' ? { backgroundColor: c.ink } : st === 'held' ? { backgroundColor: c.accentSoft } : st === 'blackout' ? { backgroundColor: c.soft } : null
  const cellText = (st?: string) => (st === 'booked' ? c.onInk : st === 'held' ? c.accentInk : st === 'blackout' ? c.faint : c.ink)
  const shift = (n: number) => setMonth(new Date(year, m + n, 1))
  const hourLines = hoursSummary(hours.data || [])
  const buffer = myProvider?.buffer_minutes

  return (
    <View style={s.mt}>
      <View style={s.between}>
        <View style={s.inline}>
          <Pressable onPress={() => shift(-1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous month" style={s.iconBtn}><ChevronLeft size={18} color={c.ink} /></Pressable>
          <Text weight="700" accessibilityRole="header" accessibilityLiveRegion="polite">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
          <Pressable onPress={() => shift(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next month" style={s.iconBtn}><ChevronRight size={18} color={c.ink} /></Pressable>
        </View>
        <Text variant="tiny" muted>Tap a free day to block it</Text>
      </View>
      {blackouts.error && <FormError>Couldn’t load blocked-off days: {blackouts.error.message}</FormError>}
      <View style={s.cal}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <View key={i} style={s.calCell} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden><Text variant="tiny" muted weight="600">{d}</Text></View>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={s.calCell} />
          const key = toKey(d)
          const st = state[key]
          const past = key < todayKey
          return (
            <View key={i} style={s.calCell}>
              <Pressable
                onPress={() => toggleBlackout(d)}
                disabled={past}
                accessibilityRole="button"
                accessibilityLabel={`${fmtBooking(d)}${st ? `, ${st === 'held' ? 'pending request' : st === 'blackout' ? 'blocked off' : 'booked'}` : ', free'}`}
                accessibilityHint={past ? undefined : st === 'blackout' ? 'Double-tap to unblock' : !st ? 'Double-tap to block off' : undefined}
                accessibilityState={{ disabled: past, busy: busyDay === key }}
                style={[s.day, cellStyle(st), key === todayKey && s.today, past && s.past]}
              >
                {busyDay === key ? <ActivityIndicator size="small" color={c.muted} /> : (
                  <Text variant="small" weight="600" style={[{ color: cellText(st) }, st === 'blackout' && s.strike]}>{d.getDate()}</Text>
                )}
              </Pressable>
            </View>
          )
        })}
      </View>
      <View style={s.legend}>
        {([['booked', 'Booked'], ['held', 'Pending request'], ['blackout', 'Blocked off']] as const).map(([k, label]) => (
          <View key={k} style={s.inline}>
            <View style={[s.swatch, cellStyle(k), k === 'blackout' && { borderWidth: 1, borderColor: c.line }]} />
            <Text variant="tiny" muted>{label}</Text>
          </View>
        ))}
      </View>
      <Card style={s.mt}>
        <View style={s.between}>
          <Text variant="small">Working hours</Text>
          <View style={s.right}>
            {hours.loading ? <Text variant="small" weight="700">…</Text> : hourLines.length ? hourLines.map((l) => <Text key={l} variant="small" weight="700" style={s.rightText}>{l}</Text>) : <Text variant="small" weight="700">Any day (not set)</Text>}
          </View>
        </View>
        {buffer != null && (
          <View style={[s.between, s.mtXs]}>
            <Text variant="small">Buffer between bookings</Text>
            <Text variant="small" weight="700">{buffer ? `${buffer} min` : 'None'}</Text>
          </View>
        )}
      </Card>
      <ServiceArea provider={provider} onChanged={onProviderChanged} />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

type PackageForm = {
  id: string | null; name: string; description: string; categoryId: string; priceType: string; price: string; hours: string
  depositPct: number; attributes: Record<string, any>; isActive: boolean
}
const EMPTY_FORM: PackageForm = { id: null, name: '', description: '', categoryId: '', priceType: 'fixed', price: '', hours: '', depositPct: 30, attributes: {}, isActive: true }
const PRICE_FIELD: Record<string, string> = { fixed: 'Price', hourly: 'Price per hour', per_person: 'Price per person', per_item: 'Price per item', daily: 'Price per day' }
const DEPOSIT_STOPS = Array.from({ length: 21 }, (_, i) => i * 5)
const PACKAGE_EXAMPLES: Record<string, string> = {
  photography: 'Engagement session', videography: 'Wedding highlight film', catering: 'Taco bar buffet', venue: 'Saturday evening rental',
  music: 'Reception DJ set', florals: 'Bridal bouquet', cakes: 'Three-tier wedding cake', bar: 'Open bar, 4 hours', 'hair-makeup': 'Bridal glam',
  rentals: 'Chiavari chair', planning: 'Day-of coordination',
}

function Packages({ provider, onChanged }: { provider: any; onChanged: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const { myProvider, toast } = useStore()
  const providerId: string | undefined = myProvider?.id
  const vertical: string = myProvider?.vertical || provider?.vertical || 'photography'
  const config = verticalConfig(vertical)
  const packages = useQuery<any[]>(providerId ? () => listMyPackages(providerId) : null, [providerId])
  const { data: allCategories } = useQuery<any[]>(() => getServices(vertical), [vertical])
  const [form, setForm] = useState<PackageForm | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof PackageForm>(k: K) => (v: PackageForm[K]) => setForm((f) => f && { ...f, [k]: v })

  // Services this listing offers (fallback: every service in its vertical).
  const offered = (allCategories || []).filter((x) => provider?.categorySlugs?.includes(x.slug))
  const categories = offered.length ? offered : allCategories || []
  // An older package may use a price type this vertical doesn't list; keep it selectable.
  const priceTypes: string[] = form && !config.priceTypes.includes(form.priceType) ? [form.priceType, ...config.priceTypes] : config.priceTypes

  const openNew = () => setForm({ ...EMPTY_FORM, priceType: config.defaultPriceType, categoryId: categories[0]?.id || '' })
  const openEdit = (p: any) =>
    setForm({
      id: p.id, name: p.name, description: p.description ?? '', categoryId: p.categoryId, priceType: p.priceType,
      price: p.price == null ? '' : String(p.price), hours: p.hours == null ? '' : String(p.hours), depositPct: p.depositPct ?? 30,
      attributes: { ...(p.attributes || {}) }, isActive: p.isActive,
    })

  const done = (msg: string) => {
    packages.reload()
    onChanged?.()
    setForm(null)
    toast(msg)
  }

  const save = async () => {
    if (!form || !providerId) return
    setSaving(true)
    const attributes: Record<string, any> = cleanAttributes(config.packageFields, form.attributes)
    // A cleared guest limit is saved as null (it's a column, not an attribute).
    for (const k of ['min_quantity', 'max_quantity']) if (k in form.attributes && !(k in attributes)) attributes[k] = null
    const values = { ...form, attributes }
    try {
      if (form.id) {
        await updatePackage(form.id, values)
        done('Package updated')
      } else {
        await createPackage(providerId, { ...values, sortOrder: (packages.data?.length || 0) + 1 })
        done('Package published')
      }
    } catch (e: any) {
      console.warn(e)
      toast('Couldn’t save: ' + (/invalid input value for enum/i.test(e?.message || '') ? 'this pricing option isn’t available yet.' : e?.message || 'try again'))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    if (!form?.id) return
    setSaving(true)
    try {
      await setPackageActive(form.id, !form.isActive)
      done(form.isActive ? 'Package hidden from your profile' : 'Package is visible again')
    } catch (e: any) {
      console.warn(e)
      toast('Couldn’t update: ' + (e?.message || 'try again'))
    } finally {
      setSaving(false)
    }
  }

  const priceOk = !!form && (form.priceType === 'quote' || (form.price !== '' && Number(form.price) >= 0))

  return (
    <View style={s.mt}>
      <ListingDetails provider={provider} vertical={vertical} onChanged={onChanged} />
      {packages.loading && !packages.data && <Loading inline />}
      {packages.error && <ErrorState error={packages.error} onRetry={packages.reload} />}
      {packages.data?.length === 0 && (
        <EmptyState compact icon={PackageIcon} title="No packages yet" text="Add what you offer, with a price, so clients can request a booking." />
      )}
      {packages.data?.map((p) => (
        <Card key={p.id} onPress={() => openEdit(p)} style={[s.card, !p.isActive && s.inactive]} accessibilityLabel={`Edit ${p.name}`}>
          <View style={s.between}>
            <Text variant="h4" style={s.grow} numberOfLines={2}>{p.name}</Text>
            <Text weight="700">{priceLabel(p)}</Text>
          </View>
          <View style={s.facts}>
            {!!p.category && <Text variant="tiny" muted>{p.category}</Text>}
            {!!p.hours && <View style={s.inline}><Clock size={12} color={c.muted} /><Text variant="tiny" muted>{p.hours}h</Text></View>}
            {attributeLines(config.packageFields, p.attributes, config.packageKeys).map((l: string) => <Text key={l} variant="tiny" muted>{l}</Text>)}
            <Text variant="tiny" muted>{p.depositPct}% deposit</Text>
            {!p.isActive && <View style={s.inline}><EyeOff size={12} color={c.muted} /><Text variant="tiny" muted>Hidden</Text></View>}
          </View>
        </Card>
      ))}
      {!!providerId && <Button title="New package" icon={Plus} variant="ghost" block onPress={openNew} style={s.mtSm} />}

      <Sheet open={!!form} onClose={() => !saving && setForm(null)} title={form?.id ? 'Edit package' : 'New package'}>
        {form && (
          <>
            <TextField label="Name" maxLength={80} value={form.name} onChangeText={set('name')} placeholder={`e.g. ${PACKAGE_EXAMPLES[vertical] || 'Standard package'}`} />
            <Text variant="small" muted style={s.label}>Service</Text>
            <ChipRow>
              {categories.map((x: any) => <Chip key={x.id} label={x.name} toggle on={form.categoryId === x.id} onPress={() => set('categoryId')(x.id)} />)}
            </ChipRow>
            {!!allCategories && !categories.length && (
              <Text variant="tiny" color="danger">{verticalMeta(vertical).name} isn’t open for bookings yet, so packages can’t be published.</Text>
            )}
            <Text variant="small" muted style={s.label}>Pricing</Text>
            <ChipRow>
              {priceTypes.map((pt) => <Chip key={pt} label={(PRICE_TYPES as Record<string, { label: string }>)[pt]?.label || pt} toggle on={form.priceType === pt} onPress={() => set('priceType')(pt)} />)}
            </ChipRow>
            {form.priceType !== 'quote' && (
              <TextField label={`${PRICE_FIELD[form.priceType] || 'Price'} ($)`} keyboardType="decimal-pad" value={form.price}
                onChangeText={(v) => set('price')(v.replace(/[^0-9.]/g, ''))} containerStyle={s.mtSm} />
            )}
            <TextField label="Hours included (optional)" keyboardType="decimal-pad" value={form.hours}
              onChangeText={(v) => set('hours')(v.replace(/[^0-9.]/g, ''))} containerStyle={s.mtSm} />
            <TextField label="Description (optional)" multiline maxLength={1000} value={form.description} onChangeText={set('description')}
              placeholder="What’s included, in a sentence or two" style={s.textarea} containerStyle={s.mtSm} />
            <PackageFields fields={config.packageFields as FieldDef[]} values={form.attributes} onChange={(attributes) => set('attributes')(attributes)} />
            <Text variant="small" muted style={s.label}>Deposit</Text>
            <Stepper label="deposit" stops={DEPOSIT_STOPS} value={Number(form.depositPct)} onChange={(v) => set('depositPct')(v)} format={(v) => `${v}%`} />
            <Button
              title={saving ? 'Saving…' : form.id ? 'Save changes' : 'Publish package'}
              block
              disabled={saving || !form.name.trim() || !form.categoryId || !priceOk}
              onPress={save}
              style={s.mt}
            />
            {!!form.id && (
              <Button title={form.isActive ? 'Hide from my profile' : 'Show on my profile'} variant="ghost" block disabled={saving} onPress={toggleActive} style={s.mtSm} />
            )}
          </>
        )}
      </Sheet>
    </View>
  )
}

// The listing's own custom fields (cuisines, capacity, genres...), shown above its packages.
function ListingDetails({ provider, vertical, onChanged }: { provider: any; vertical: string; onChanged: () => void }) {
  const s = useStyles()
  const { myProvider, refreshProvider, toast } = useStore()
  const fields = (verticalConfig(vertical).providerFields as FieldDef[]).filter((f) => f.key !== 'specialties')
  const [draft, setDraft] = useState<Record<string, any> | null>(null)
  const [saving, setSaving] = useState(false)
  if (!fields.length || !myProvider) return null
  const attrs = provider?.attributes || myProvider.attributes || {}
  const meta = verticalMeta(vertical)

  const save = async () => {
    setSaving(true)
    try {
      // Keep keys this form doesn't edit (photography's gear, specialties...).
      await updateProviderAttributes(myProvider.id, cleanAttributes(fields, { ...attrs, ...draft }))
      await refreshProvider()
      onChanged?.()
      setDraft(null)
      toast('Details saved')
    } catch (e: any) {
      console.warn(e)
      toast('Couldn’t save: ' + (e?.message || 'try again'))
    } finally {
      setSaving(false)
    }
  }

  const empty = !attributeLines(fields, attrs).length
  return (
    <Card style={s.card}>
      <View style={s.between}>
        <Text variant="small" weight="700">Your {meta.noun} details</Text>
        <Button title={empty ? 'Add' : 'Edit'} size="sm" variant="ghost" onPress={() => setDraft({ ...attrs })} />
      </View>
      {empty ? <Text variant="tiny" muted>{fields.map((f) => f.label).join(', ')}. Clients filter by these.</Text> : <AttributeList fields={fields} attrs={attrs} />}
      <Sheet open={!!draft} onClose={() => !saving && setDraft(null)} title={`Your ${meta.noun} details`}>
        {draft && (
          <>
            <PackageFields fields={fields} values={draft} onChange={setDraft} />
            <Button title={saving ? 'Saving…' : 'Save'} block disabled={saving} onPress={save} style={s.mt} />
          </>
        )}
      </Sheet>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

function Portfolio() {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { myProvider } = useStore()
  const providerId: string | undefined = myProvider?.id
  const { data: albums, loading, error, reload } = useQuery<any[]>(providerId ? () => listMyAlbums(providerId) : null, [providerId])

  const cover = (a: any) => {
    const photos = [...(a.photos || [])].sort((x, y) => x.position - y.position)
    const pick = a.kind === 'before_after' ? photos.find((p) => p.pair_role === 'after') || photos[0] : photos[0]
    return pick ? publicUrl('portfolio', pick.display_path) : null
  }

  return (
    <View style={s.mt}>
      <Text variant="small" muted>This is what clients see on your profile.</Text>
      {error && <ErrorState error={error} onRetry={reload} />}
      <View style={[s.grid, s.mtSm]}>
        <Pressable onPress={() => router.push('/upload')} style={[s.tile, s.addTile]} accessibilityRole="button" accessibilityLabel="Post photos">
          <Plus size={22} color={c.ink} />
          <Text variant="tiny">Post photos</Text>
        </Pressable>
        {loading && <View style={[s.tile, s.addTile]}><ActivityIndicator color={c.muted} /></View>}
        {albums?.filter((a) => a.photos?.length).map((a) => (
          <Pressable
            key={a.id}
            onPress={() => router.push({ pathname: '/my-work', params: { post: a.id } })}
            style={s.tile}
            accessibilityRole="button"
            accessibilityLabel={`${a.title || 'Post'}${a.kind === 'before_after' ? ', before and after' : a.photos.length > 1 ? `, ${a.photos.length} photos` : ''}`}
          >
            <Photo uri={cover(a)} style={s.tileImg} />
            {a.photos.length > 1 && a.kind !== 'before_after' && (
              <View style={s.count}><Copy size={11} color="#fff" /><Text variant="caption" style={s.white}>{a.photos.length}</Text></View>
            )}
            {a.kind === 'before_after' && <View style={s.count}><Text variant="caption" style={s.white}>B/A</Text></View>}
          </Pressable>
        ))}
      </View>
      {albums?.length === 0 && <Text variant="small" muted style={s.mtSm}>Nothing posted yet. Your albums will appear here.</Text>}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  pad: { paddingHorizontal: t.space.lg, marginTop: t.space.lg },
  mt: { marginTop: t.space.md },
  mtSm: { marginTop: t.space.sm },
  mtXs: { marginTop: t.space.xs },
  card: { marginTop: t.space.sm, gap: 4 },
  inactive: { opacity: 0.55 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  quote: { marginTop: t.space.sm, padding: 10, borderRadius: t.radius.md, backgroundColor: t.c.soft },
  textarea: { minHeight: 72, textAlignVertical: 'top' },
  label: { marginTop: t.space.md, marginBottom: 6 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2, marginTop: 2 },
  iconBtn: { padding: 4 },
  cal: { flexDirection: 'row', flexWrap: 'wrap', marginTop: t.space.sm },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2, alignItems: 'center', justifyContent: 'center' },
  day: { width: '100%', height: '100%', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: t.c.accent },
  past: { opacity: 0.35 },
  strike: { textDecorationLine: 'line-through' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: t.space.sm },
  swatch: { width: 12, height: 12, borderRadius: 4 },
  right: { alignItems: 'flex-end', flexShrink: 1 },
  rightText: { textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tile: { width: '32.5%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden' },
  tileImg: { width: '100%', height: '100%' },
  addTile: { backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center', gap: 4 },
  count: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: t.c.overlay, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  white: { color: '#fff' },
}))
