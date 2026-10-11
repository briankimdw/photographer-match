import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clock, Copy, EyeOff, Inbox, MapPin, Package, Plus, Star } from 'lucide-react'
import Segmented from '../components/Segmented.jsx'
import Sheet from '../components/Sheet.jsx'
import ProfileLink, { PersonAvatar } from '../components/ProfileLink.jsx'
import { VerifiedClient } from '../components/Badges.jsx'
import { money, priceLabel } from '../components/Booking.jsx'
import { EmptyState, ErrorState, Loading } from '../components/States.jsx'
import { MapPreview, ServiceAreaEditor } from '../components/map/LazyMap.jsx'
import { useStore } from '../store.jsx'
import useQuery from '../lib/useQuery.js'
import { fmtBooking, today, toKey } from '../lib/dates.js'
import { listMyAlbums, publicUrl } from '../api/portfolio.js'
import { bookingError, respondToBooking } from '../api/bookings.js'
import { getServices } from '../api/catalog.js'
import { parsePoint, updateServiceArea } from '../api/locations.js'
import { avatarUrl } from '../lib/format.js'
import {
  addBlackout, createPackage, listBlackouts, listMyPackages, listWorkingHours, removeBlackoutDay, setPackageActive, updatePackage, updateProviderAttributes,
} from '../api/provider.js'
import PackageFields from '../components/verticals/PackageFields.jsx'
import AttributeList from '../components/verticals/AttributeList.jsx'
import { PRICE_TYPES, attributeLines, cleanAttributes, verticalConfig, verticalMeta } from '../verticals/index.js'

// Booking statuses that fill a day on the calendar, and ones that hold it while pending.
export const BOOKED = ['confirmed', 'in_progress', 'delivered', 'completed']
const HELD = ['requested', 'countered', 'accepted']

// Provider work tabs, shown inside the profile page in business mode.
// provider: getProvider() result (may still be loading); bookings: useQuery result of listProviderBookings.
export default function Dashboard({ tab, onTabChange, provider, bookings, onProviderChanged }) {
  const { myProvider } = useStore()
  const pending = (bookings?.data || []).filter((r) => r.status === 'requested').length
  // Non-visual services (DJs, planners...) don't get a Portfolio tab unless they've posted.
  const showPortfolio = verticalMeta(myProvider?.vertical).visual || (provider?.albumCount ?? 0) > 0
  if (tab === 'portfolio' && !showPortfolio) tab = 'packages'

  return (
    <div className="pad-x">
      <Segmented
        options={[
          { value: 'requests', label: pending ? `Requests · ${pending}` : 'Requests' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'packages', label: 'Packages' },
          ...(showPortfolio ? [{ value: 'portfolio', label: 'Portfolio' }] : []),
        ]}
        value={tab}
        onChange={onTabChange}
      />
      {tab === 'requests' && <Requests bookings={bookings} />}
      {tab === 'calendar' && <ProviderCalendar bookings={bookings} provider={provider} onProviderChanged={onProviderChanged} />}
      {tab === 'packages' && <Packages provider={provider} onChanged={onProviderChanged} />}
      {tab === 'portfolio' && <Portfolio />}
    </div>
  )
}

function Requests({ bookings }) {
  const { toast } = useStore()
  const [counterFor, setCounterFor] = useState(null)
  const [counterPrice, setCounterPrice] = useState('')
  const [counterNote, setCounterNote] = useState('')
  const [busy, setBusy] = useState(null)

  if (bookings.loading && !bookings.data) return <Loading inline />
  if (bookings.error) return <ErrorState error={bookings.error} onRetry={bookings.reload} />

  // New requests first, then ones waiting on the client.
  const order = { requested: 0, countered: 1, accepted: 2 }
  const list = (bookings.data || [])
    .filter((r) => r.status in order)
    .sort((a, b) => order[a.status] - order[b.status] || a.start - b.start)

  const respond = async (r, action, extra) => {
    setBusy(r.id)
    try {
      await respondToBooking(r.id, action, extra)
      const first = r.client.name?.split(' ')[0] || 'The client'
      toast(
        action === 'accept' ? `Accepted. ${first} will be asked to pay the deposit.` : action === 'counter' ? 'Counter offer sent' : 'Request declined',
      )
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
      <div className="mt-sm">
        <EmptyState compact icon={Inbox} title="No requests right now" text="New booking requests from clients show up here." />
      </div>
    )
  }

  return (
    <div className="mt-sm">
      {list.map((r) => (
        <div key={r.id} className="request-card">
          <div className="row gap-xs">
            <PersonAvatar id={r.client.id} src={r.client.avatar} name={r.client.name} username={r.client.username} className="avatar" />
            <div className="grow">
              <ProfileLink id={r.client.id}><b>{r.client.name}</b></ProfileLink>
              <div className="row gap-xs tiny">
                {r.client.rating ? (
                  <>
                    <Star size={11} className="star-on" fill="currentColor" /> {r.client.rating.toFixed(1)} as a client ({r.client.reviews})
                  </>
                ) : (
                  <span className="muted">New client, no ratings yet</span>
                )}
              </div>
              {r.client.verified && <VerifiedClient />}
            </div>
            <b>{money(r.total)}</b>
          </div>
          <Link to={`/bookings/${r.id}`} className="small mt-sm req-pkg">
            <b>{r.packageName}</b> · {r.date} · {r.time}
          </Link>
          {r.location && <div className="muted small">{r.location}</div>}
          {r.note && <div className="quote small">“{r.note}”</div>}

          {r.status === 'requested' ? (
            <>
              {r.expiresIn && <div className="tiny warn inline-icon"><Clock size={12} /> Expires in {r.expiresIn}</div>}
              <div className="row gap-xs mt-sm">
                {/* Quote requests have no price to accept: the database needs a counter offer first. */}
                {r.total != null && <button className="btn sm grow" disabled={busy === r.id} onClick={() => respond(r, 'accept')}>Accept</button>}
                <button
                  className={`btn sm grow ${r.total == null ? '' : 'ghost'}`}
                  disabled={busy === r.id}
                  onClick={() => { setCounterFor(r); setCounterPrice(r.total == null ? '' : String(r.total)); setCounterNote('') }}
                >
                  {r.total == null ? 'Send a price' : 'Counter'}
                </button>
                <button className="btn ghost sm grow danger" disabled={busy === r.id} onClick={() => respond(r, 'decline')}>Decline</button>
              </div>
            </>
          ) : (
            <div className="small mt-sm">
              {r.status === 'accepted' && '✓ Accepted · waiting for deposit'}
              {r.status === 'countered' && `Counter sent: ${money(r.counterTotal)} · waiting for ${r.client.name?.split(' ')[0] || 'the client'}`}
            </div>
          )}
        </div>
      ))}

      <Sheet open={!!counterFor} onClose={() => setCounterFor(null)} title="Send a counter offer">
        {counterFor && (
          <>
            <div className="muted small">{counterFor.client.name} · {counterFor.packageName} · {counterFor.date}</div>
            <label className="field mt">
              <span>Your price</span>
              <div className="money-input">
                $<input type="number" min="0" value={counterPrice} onChange={(e) => setCounterPrice(e.target.value)} />
              </div>
            </label>
            <label className="field mt-sm">
              <span>Message</span>
              <textarea className="input" rows={3} placeholder="Explain the change" value={counterNote} onChange={(e) => setCounterNote(e.target.value)} />
            </label>
            <button className="btn block mt" disabled={!(Number(counterPrice) > 0) || busy === counterFor.id} onClick={sendCounter}>
              {busy === counterFor.id ? 'Sending…' : 'Send counter'}
            </button>
          </>
        )}
      </Sheet>
    </div>
  )
}

const LEGEND = [
  ['booked', 'Booked'],
  ['held', 'Pending request'],
  ['blackout', 'Blocked off'],
]

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday first
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtHour = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`
}
// [{weekday, start, end}] -> "Tue–Sun, 8 AM – 8 PM" (one line per distinct set of hours).
function hoursSummary(rules) {
  const groups = new Map()
  for (const r of rules) {
    const k = `${r.start}-${r.end}`
    if (!groups.has(k)) groups.set(k, { start: r.start, end: r.end, days: new Set() })
    groups.get(k).days.add(r.weekday)
  }
  return [...groups.values()].map((g) => {
    const idx = WEEK_ORDER.map((d) => g.days.has(d))
    const runs = []
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

function ProviderCalendar({ bookings, provider, onProviderChanged }) {
  const { myProvider, toast } = useStore()
  const providerId = myProvider?.id
  const tz = myProvider?.timezone || provider?.timezone || 'America/Los_Angeles'
  const [month, setMonth] = useState(() => {
    const t = today()
    return new Date(t.getFullYear(), t.getMonth(), 1)
  })
  const [busyDay, setBusyDay] = useState(null)
  const blackouts = useQuery(providerId ? () => listBlackouts(providerId, tz) : null, [providerId, tz])
  const hours = useQuery(providerId ? () => listWorkingHours(providerId) : null, [providerId])

  // 'YYYY-MM-DD' -> 'booked' | 'held' | 'blackout'
  const state = {}
  const blackoutByDay = {}
  for (const b of blackouts.data || []) for (const d of b.days) (state[d] = 'blackout'), (blackoutByDay[d] = b)
  for (const b of bookings?.data || []) {
    if (BOOKED.includes(b.status)) state[b.dateKey] = 'booked'
    else if (HELD.includes(b.status) && state[b.dateKey] !== 'booked') state[b.dateKey] = 'held'
  }

  const year = month.getFullYear()
  const m = month.getMonth()
  const daysInMonth = new Date(year, m + 1, 0).getDate()
  const cells = [...Array(month.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, m, i + 1))]
  const todayKey = toKey(today())

  const toggleBlackout = async (day) => {
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
    } catch (e) {
      console.warn(e)
      toast('Couldn’t update your calendar: ' + (e.message || 'try again'))
    } finally {
      setBusyDay(null)
    }
  }

  const shift = (n) => setMonth(new Date(year, m + n, 1))
  const hourLines = hoursSummary(hours.data || [])
  const buffer = myProvider?.buffer_minutes

  return (
    <div className="mt-sm">
      <div className="row between">
        <div className="row gap-xs">
          <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
          <b>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b>
          <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        </div>
        <span className="muted tiny">Tap a free day to block it off</span>
      </div>
      {blackouts.error && <div className="form-error mt-sm">Couldn’t load blocked-off days: {blackouts.error.message}</div>}
      <div className="cal">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="cal-head">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const key = toKey(d)
          return (
            <button
              key={i}
              className={`cal-day ${state[key] || ''} ${key === todayKey ? 'today' : ''} ${key < todayKey ? 'past' : ''} ${busyDay === key ? 'busy' : ''}`}
              onClick={() => toggleBlackout(d)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
      <div className="legend">
        {LEGEND.map(([k, label]) => (
          <span key={k}><i className={`cal-swatch ${k}`} /> {label}</span>
        ))}
      </div>
      <div className="info-card mt">
        <div className="row between small hours-row">
          <span>Working hours</span>
          <b className="right-text">
            {hours.loading ? '…' : hourLines.length ? hourLines.map((l) => <div key={l}>{l}</div>) : 'Any day (not set)'}
          </b>
        </div>
        {buffer != null && <div className="row between small mt-xs"><span>Buffer between bookings</span><b>{buffer ? `${buffer} min` : 'None'}</b></div>}
      </div>
      <ServiceArea provider={provider} onChanged={onProviderChanged} />
    </div>
  )
}

// Where the provider is based and how far they travel (shown on the map and their profile).
function ServiceArea({ provider, onChanged }) {
  const { myProvider, refreshProvider, toast } = useStore()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  if (!myProvider) return null

  const location = parsePoint(myProvider.base_location)
  const radiusKm = myProvider.service_radius_km
  const city = myProvider.city || ''
  const avatar = provider?.avatar || avatarUrl(null, myProvider.display_name)

  const save = async (area) => {
    setSaving(true)
    try {
      await updateServiceArea(myProvider.id, area)
      await refreshProvider()
      onChanged?.()
      setOpen(false)
      toast('Service area saved')
    } catch (e) {
      console.warn(e)
      toast('Couldn’t save: ' + (e.message || 'try again'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="info-card sa-card">
      <div className="row between gap-xs">
        <MapPin size={18} className="muted" />
        <div className="grow">
          <div className="small"><b>Service area</b></div>
          <div className="muted tiny">
            {location ? `${city.split(',')[0] || 'Your base'} · you travel up to ${radiusKm} km` : 'Not set yet, so clients can’t find you on the map.'}
          </div>
        </div>
        <button className={`btn sm ${location ? 'ghost' : ''}`} onClick={() => setOpen(true)}>{location ? 'Edit' : 'Set up'}</button>
      </div>
      {location && (
        <button className="area-preview" onClick={() => setOpen(true)} aria-label="Edit your service area">
          <MapPreview location={location} radiusKm={radiusKm} avatar={avatar} height={130} />
        </button>
      )}
      <Sheet open={open} onClose={() => !saving && setOpen(false)} title="Service area">
        <p className="muted small">Where you’re based and how far you’ll travel. Clients see this on the map and on your profile.</p>
        <div className="mt-sm">
          <ServiceAreaEditor initial={{ location, radiusKm, city }} avatar={avatar} onSave={save} saving={saving} />
        </div>
      </Sheet>
    </div>
  )
}

const EMPTY_FORM = { id: null, name: '', description: '', categoryId: '', priceType: 'fixed', price: '', hours: '', depositPct: 30, attributes: {}, isActive: true }

// What the price field is called for each price type.
const PRICE_FIELD = { fixed: 'Price', hourly: 'Price per hour', per_person: 'Price per person', per_item: 'Price per item', daily: 'Price per day' }

function Packages({ provider, onChanged }) {
  const { myProvider, toast } = useStore()
  const providerId = myProvider?.id
  const vertical = myProvider?.vertical || provider?.vertical || 'photography'
  const config = verticalConfig(vertical)
  const packages = useQuery(providerId ? () => listMyPackages(providerId) : null, [providerId])
  const { data: allCategories } = useQuery(() => getServices(vertical), [vertical])
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  // Services this listing offers (fallback: every service in its vertical).
  const offered = (allCategories || []).filter((c) => provider?.categorySlugs?.includes(c.slug))
  const categories = offered.length ? offered : allCategories || []
  // An older package may use a price type this vertical doesn't list; keep it selectable.
  const priceTypes = form && !config.priceTypes.includes(form.priceType) ? [form.priceType, ...config.priceTypes] : config.priceTypes

  const openNew = () => setForm({ ...EMPTY_FORM, priceType: config.defaultPriceType, categoryId: categories[0]?.id || '' })
  const openEdit = (p) =>
    setForm({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      categoryId: p.categoryId,
      priceType: p.priceType,
      price: p.price ?? '',
      hours: p.hours ?? '',
      depositPct: p.depositPct ?? 30,
      attributes: { ...(p.attributes || {}) },
      isActive: p.isActive,
    })

  const done = (msg) => {
    packages.reload()
    onChanged?.()
    setForm(null)
    toast(msg)
  }

  const save = async () => {
    setSaving(true)
    const attributes = cleanAttributes(config.packageFields, form.attributes)
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
    } catch (e) {
      console.warn(e)
      toast('Couldn’t save: ' + (/invalid input value for enum/i.test(e.message || '') ? 'this pricing option isn’t available yet.' : e.message || 'try again'))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    setSaving(true)
    try {
      await setPackageActive(form.id, !form.isActive)
      done(form.isActive ? 'Package hidden from your profile' : 'Package is visible again')
    } catch (e) {
      console.warn(e)
      toast('Couldn’t update: ' + (e.message || 'try again'))
    } finally {
      setSaving(false)
    }
  }

  const priceOk = form && (form.priceType === 'quote' || (form.price !== '' && Number(form.price) >= 0))

  return (
    <div className="mt-sm">
      <ListingDetails provider={provider} vertical={vertical} onChanged={onChanged} />
      {packages.loading && !packages.data && <Loading inline />}
      {packages.error && <ErrorState error={packages.error} onRetry={packages.reload} />}
      {packages.data?.length === 0 && (
        <EmptyState compact icon={Package} title="No packages yet" text="Add what you offer, with a price, so clients can request a booking." />
      )}
      {packages.data?.map((p) => (
        <button key={p.id} className={`package-card pkg-edit ${p.isActive ? '' : 'inactive'}`} onClick={() => openEdit(p)}>
          <div className="row between">
            <h4>{p.name}</h4>
            <b>{priceLabel(p)}</b>
          </div>
          <div className="pkg-facts">
            {p.category && <span>{p.category}</span>}
            {p.hours && <span><Clock size={13} /> {p.hours}h</span>}
            {attributeLines(config.packageFields, p.attributes, config.packageKeys).map((l) => <span key={l}>{l}</span>)}
            <span>{p.depositPct}% deposit</span>
            {!p.isActive && <span><EyeOff size={13} /> Hidden</span>}
          </div>
        </button>
      ))}
      {providerId && <button className="btn ghost block mt-sm" onClick={openNew}><Plus size={16} /> New package</button>}

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit package' : 'New package'}>
        {form && (
          <>
            <label className="field"><span>Name</span><input className="input" maxLength={80} value={form.name} onChange={set('name')} placeholder={`e.g. ${PACKAGE_EXAMPLES[vertical] || 'Standard package'}`} /></label>
            <label className="field mt-sm">
              <span>Service</span>
              <select className="input" value={form.categoryId} onChange={set('categoryId')}>
                {!form.categoryId && <option value="">Choose…</option>}
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {allCategories && !categories.length && <small className="field-hint">{verticalMeta(vertical).name} isn’t open for bookings yet, so packages can’t be published.</small>}
            </label>
            <label className="field mt-sm">
              <span>Pricing</span>
              <select className="input" value={form.priceType} onChange={set('priceType')}>
                {priceTypes.map((t) => <option key={t} value={t}>{PRICE_TYPES[t]?.label || t}</option>)}
              </select>
            </label>
            {form.priceType !== 'quote' && (
              <label className="field mt-sm">
                <span>{PRICE_FIELD[form.priceType] || 'Price'}</span>
                <input className="input" type="number" min="0" inputMode="decimal" placeholder="$" value={form.price} onChange={set('price')} />
              </label>
            )}
            <label className="field mt-sm"><span>Hours included <span className="pf-optional">optional</span></span><input className="input" type="number" min="0" step="0.5" value={form.hours} onChange={set('hours')} /></label>
            <label className="field mt-sm">
              <span>Description <span className="pf-optional">optional</span></span>
              <textarea className="input" rows={2} maxLength={1000} value={form.description} onChange={set('description')} placeholder="What’s included, in a sentence or two" />
            </label>
            <PackageFields fields={config.packageFields} values={form.attributes} onChange={(attributes) => setForm({ ...form, attributes })} />
            <label className="field mt-sm"><span>Deposit: {form.depositPct}%</span><input type="range" min="0" max="100" step="5" value={form.depositPct} onChange={set('depositPct')} /></label>
            <button className="btn block mt" disabled={saving || !form.name.trim() || !form.categoryId || !priceOk} onClick={save}>
              {saving ? 'Saving…' : form.id ? 'Save changes' : 'Publish package'}
            </button>
            {form.id && (
              <button className="btn ghost block mt-sm" disabled={saving} onClick={toggleActive}>
                {form.isActive ? 'Hide from my profile' : 'Show on my profile'}
              </button>
            )}
          </>
        )}
      </Sheet>
    </div>
  )
}

const PACKAGE_EXAMPLES = {
  photography: 'Engagement session', videography: 'Wedding highlight film', catering: 'Taco bar buffet', venue: 'Saturday evening rental',
  music: 'Reception DJ set', florals: 'Bridal bouquet', cakes: 'Three-tier wedding cake', bar: 'Open bar, 4 hours', 'hair-makeup': 'Bridal glam',
  rentals: 'Chiavari chair', planning: 'Day-of coordination',
}

// The listing's own custom fields (cuisines, capacity, genres...), shown above its packages.
function ListingDetails({ provider, vertical, onChanged }) {
  const { myProvider, refreshProvider, toast } = useStore()
  const fields = verticalConfig(vertical).providerFields.filter((f) => f.key !== 'specialties')
  const [draft, setDraft] = useState(null)
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
    } catch (e) {
      console.warn(e)
      toast('Couldn’t save: ' + (e.message || 'try again'))
    } finally {
      setSaving(false)
    }
  }

  const empty = !attributeLines(fields, attrs).length
  return (
    <div className="info-card listing-details">
      <div className="row between gap-xs">
        <div className="small"><b>Your {meta.noun} details</b></div>
        <button className="btn sm ghost" onClick={() => setDraft({ ...attrs })}>{empty ? 'Add' : 'Edit'}</button>
      </div>
      {empty ? (
        <div className="muted tiny mt-xs">{fields.map((f) => f.label).join(', ')}. Clients filter by these.</div>
      ) : (
        <AttributeList fields={fields} attrs={attrs} />
      )}
      <Sheet open={!!draft} onClose={() => !saving && setDraft(null)} title={`Your ${meta.noun} details`}>
        {draft && (
          <>
            <PackageFields fields={fields} values={draft} onChange={setDraft} />
            <button className="btn block mt" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        )}
      </Sheet>
    </div>
  )
}

// Your real albums from Supabase. Tap one to open it in the viewer.
function Portfolio() {
  const { myProvider } = useStore()
  const providerId = myProvider?.id
  const { data: albums, loading, error, reload } = useQuery(providerId ? () => listMyAlbums(providerId) : null, [providerId])

  const cover = (a) => {
    const photos = [...(a.photos || [])].sort((x, y) => x.position - y.position)
    const pick = a.kind === 'before_after' ? photos.find((p) => p.pair_role === 'after') || photos[0] : photos[0]
    return pick ? publicUrl('portfolio', pick.display_path) : null
  }

  return (
    <div className="mt-sm">
      <div className="muted small">This is what clients see on your profile.</div>
      {error && <ErrorState error={error} onRetry={reload} />}
      <div className="grid3 mt-sm rounded-grid">
        <Link to="/upload" className="add-tile">
          <Plus size={22} />
          <span className="tiny">Post photos</span>
        </Link>
        {loading && <div className="add-tile muted"><div className="spinner" /></div>}
        {albums?.filter((a) => a.photos?.length).map((a) => (
          <Link key={a.id} to={`/my-work?post=${a.id}`} className="album-tile" title={a.title}>
            <img src={cover(a)} alt="" loading="lazy" />
            {a.photos.length > 1 && a.kind !== 'before_after' && (
              <span className="album-count"><Copy size={12} /> {a.photos.length}</span>
            )}
            {a.kind === 'before_after' && <span className="album-count">B/A</span>}
          </Link>
        ))}
      </div>
      {albums?.length === 0 && <p className="muted small mt-sm">Nothing posted yet. Your albums will appear here.</p>}
    </div>
  )
}
