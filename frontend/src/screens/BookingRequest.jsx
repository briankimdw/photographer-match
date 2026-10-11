import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CalendarX, Info, MapPin } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import PersonRow from '../components/PersonRow.jsx'
import { PolicyTable, money, priceLabel } from '../components/Booking.jsx'
import { EmptyState, ErrorState, Loading } from '../components/States.jsx'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { getProvider, freeDays } from '../api/catalog.js'
import { attributeLines, quantityFor, sessionNoun, verticalConfig } from '../verticals/index.js'
import { bookingError, requestBooking } from '../api/bookings.js'
import useQuery from '../lib/useQuery.js'
import { addDays, fmtBooking, fmtChip, fromKey, isPast, parseDates, toKey, today } from '../lib/dates.js'

// Start times offered (sent to the database as HH:MM in the photographer's time zone).
const TIMES = [
  ['09:00', '9:00 AM'],
  ['11:00', '11:00 AM'],
  ['14:00', '2:00 PM'],
  ['16:00', '4:00 PM'],
  ['18:00', '6:00 PM'],
]
const STRIP_DAYS = 28 // how far ahead the date strip goes
const MAX_DATES = 14 // the database accepts at most 14 dates per request
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function BookingRequest() {
  const { providerId } = useParams()
  const { data: p, loading, error, reload } = useQuery(() => getProvider(providerId), [providerId])

  if (loading && !p) return <><TopBar title="Request booking" /><Loading /></>
  if (error) return <><TopBar title="Request booking" /><ErrorState error={error} onRetry={reload} /></>
  if (!p) return <><TopBar title="Request booking" /><EmptyState icon={CalendarX} title="Listing not found" text="This listing may have been removed." /></>
  if (!p.packages.length)
    return (
      <>
        <TopBar title="Request booking" />
        <EmptyState icon={CalendarX} title="No packages yet" text={`${p.name} hasn't published any packages to book. Send them a message instead.`} />
      </>
    )
  return <RequestForm p={p} />
}

function RequestForm({ p }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const { toast } = useStore()
  const { user } = useAuth()
  const first = p.shortName || p.name.split(' ')[0]
  const isMine = !!user && user.id === p.profileId

  const initialPkg = p.packages.some((x) => x.id === params.get('pkg')) ? params.get('pkg') : p.packages[0].id
  const [pkgId, setPkgId] = useState(initialPkg)
  const [hours, setHours] = useState(null)
  const [quantity, setQuantity] = useState(null) // guests / items / days (null = the package's default)
  // Dates picked in a date search arrive pre-selected; each selected date becomes its own request.
  const [requestedDates] = useState(() => parseDates(params.get('dates')).filter((k) => !isPast(fromKey(k))))
  const [dates, setDates] = useState(requestedDates) // 'YYYY-MM-DD'[]
  const [time, setTime] = useState('14:00')
  const [loc, setLoc] = useState('')
  const [addons, setAddons] = useState([])
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)

  // The next few weeks plus any dates carried over from a search: which ones is this photographer free on?
  const stripKeys = useMemo(() => Array.from({ length: STRIP_DAYS }, (_, i) => toKey(addDays(today(), i + 1))), [])
  const checkKeys = useMemo(() => [...new Set([...stripKeys, ...requestedDates])].sort(), [stripKeys, requestedDates])
  const { data: free, loading: freeLoading } = useQuery(() => freeDays(p.id, checkKeys), [p.id, checkKeys.join(',')])
  // `free` is undefined while loading or if the check failed; the database re-checks on submit anyway.
  const isBusy = (k) => !!free && !free.has(k)

  // Drop carried-over dates the photographer turns out to be busy on.
  useEffect(() => {
    if (free) setDates((ds) => ds.filter((k) => free.has(k)))
  }, [free])

  const toggleDate = (k) => {
    setSendError(null)
    setDates((ds) => (ds.includes(k) ? ds.filter((x) => x !== k) : ds.length >= MAX_DATES ? ds : [...ds, k].sort()))
  }

  const pkg = p.packages.find((x) => x.id === pkgId)
  const config = verticalConfig(p.vertical)
  const isQuote = pkg.priceType === 'quote' || pkg.price == null
  const isHourly = pkg.priceType === 'hourly'
  const isDaily = pkg.priceType === 'daily' // charged once per booked day: each date picked is a day
  const hrs = hours ?? pkg.hours ?? 1
  // Per-person, per-item and per-day packages are priced × a quantity.
  const qty = quantityFor(pkg, p.vertical)
  const count = qty ? Math.min(qty.max, Math.max(qty.min, quantity ?? qty.default)) : null
  const base = isQuote ? 0 : isHourly ? pkg.price * hrs : qty ? pkg.price * count : pkg.price
  const chosenAddons = p.addons.filter((a) => addons.includes(a.id))
  const addonTotal = chosenAddons.reduce((s, a) => s + (a.price ?? 0), 0)
  const total = base + addonTotal
  const deposit = Math.round(total * (pkg.depositPct ?? 0)) / 100 // to the cent, like the database

  const send = async () => {
    // Requests need an account: sign in, then come straight back to this form.
    if (!user) {
      navigate(`/sign-in?next=${encodeURIComponent(pathname + search)}`)
      return
    }
    setSending(true)
    setSendError(null)
    try {
      const rows = await requestBooking({
        packageId: pkg.id,
        dates,
        startTime: time,
        hours: isHourly ? hrs : null,
        quantity: qty ? count : null, // only sent for packages priced per guest / item / day
        addonIds: addons,
        location: loc.trim(),
        notes: note.trim(),
        eventId: params.get('event') || null, // from an event's board (/events/:id)
      })
      toast(rows.length > 1 ? `${rows.length} requests sent. ${first} has 48h to respond.` : `Request sent. ${first} has 48h to respond.`)
      navigate(rows.length === 1 ? `/bookings/${rows[0].id}` : '/bookings', { replace: true })
    } catch (err) {
      const msg = bookingError(err)
      setSendError(msg)
      toast(msg)
      setSending(false)
    }
  }

  return (
    <div>
      <TopBar title="Request booking" />
      <PersonRow person={p} sub={[p.rating != null ? `${p.rating.toFixed(1)} ★` : 'New', p.serviceArea].join(' · ')} />
      <div className="pad">
        <h2 className="section-title h4">Package</h2>
        {p.packages.map((x) => (
          <label key={x.id} className={`option ${pkgId === x.id ? 'on' : ''}`}>
            <input type="radio" checked={pkgId === x.id} onChange={() => { setPkgId(x.id); setHours(null); setQuantity(null) }} />
            <div className="grow">
              <b>{x.name}</b>
              <div className="muted small">
                {[x.hours && `${x.hours}h`, ...attributeLines(config.packageFields, x.attributes, config.packageKeys)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <b>{priceLabel(x)}</b>
          </label>
        ))}

        {isHourly && (
          <div className="row between mt-sm">
            <span className="small">Hours</span>
            <div className="stepper">
              <button onClick={() => setHours(Math.max(1, hrs - 0.5))}>−</button>
              <b>{hrs}</b>
              <button onClick={() => setHours(Math.min(12, hrs + 0.5))}>+</button>
            </div>
          </div>
        )}

        {qty && !isQuote && (
          <QuantityStepper qty={qty} value={count} onChange={setQuantity} priceText={priceLabel(pkg)} />
        )}

        <h2 className="section-title h4">{dates.length > 1 ? `Dates (${dates.length})` : 'Date'}</h2>
        {requestedDates.length > 0 && (
          <>
            <div className="muted tiny">Your dates{free ? ` · ${first} is free on ${requestedDates.filter((k) => free.has(k)).length} of ${requestedDates.length}` : ''}</div>
            <div className="chips mt-xs mb-sm">
              {requestedDates.map((k) => (
                <button key={k} className={`chip toggle ${dates.includes(k) ? 'on' : ''} ${isBusy(k) ? 'busy' : ''}`} disabled={isBusy(k)} onClick={() => toggleDate(k)}>
                  {fmtChip(fromKey(k))}{isBusy(k) ? ' · busy' : ''}
                </button>
              ))}
            </div>
            <div className="muted tiny mt-sm">Or pick from the next 4 weeks</div>
          </>
        )}
        <div className="avail-strip">
          {stripKeys.map((k) => {
            const d = fromKey(k)
            const busy = isBusy(k)
            return (
              <button
                key={k}
                className={`avail-day ${busy ? 'busy' : ''} ${dates.includes(k) ? 'on' : ''}`}
                disabled={busy}
                onClick={() => toggleDate(k)}
                title={busy ? `${first} isn't available` : fmtBooking(d)}
              >
                <span>{WEEKDAYS[d.getDay()]}</span>
                <b>{d.getDate()}</b>
              </button>
            )
          })}
        </div>
        <div className="muted tiny mt-xs">
          {freeLoading ? 'Checking availability…' : free ? 'Crossed-out days are booked or outside working hours.' : ''}
        </div>
        <div className="chips mt-sm">
          {TIMES.map(([value, label]) => (
            <button key={value} className={`chip toggle ${time === value ? 'on' : ''}`} onClick={() => setTime(value)}>
              {label}
            </button>
          ))}
        </div>

        <h2 className="section-title h4">Location</h2>
        <input className="input" placeholder="Venue or address" value={loc} onChange={(e) => setLoc(e.target.value)} />
        <div className="muted tiny mt-xs inline-icon">
          <MapPin size={12} /> {p.serviceArea}. {p.travelFee}.
        </div>

        {p.addons.length > 0 && (
          <>
            <h2 className="section-title h4">Add-ons</h2>
            {p.addons.map((a) => (
              <label key={a.id} className="check-row">
                <input
                  type="checkbox"
                  checked={addons.includes(a.id)}
                  onChange={() => setAddons(addons.includes(a.id) ? addons.filter((x) => x !== a.id) : [...addons, a.id])}
                />
                <span className="grow">{a.name}</span>
                <span>+{money(a.price)}</span>
              </label>
            ))}
          </>
        )}

        <h2 className="section-title h4">Notes for {first}</h2>
        <textarea className="input" rows={3} placeholder={`Tell them about your ${sessionNoun(p.vertical)}…`} value={note} onChange={(e) => setNote(e.target.value)} />

        <h2 className="section-title h4">Price</h2>
        {isQuote ? (
          <div className="note">
            <Info size={16} /> This package is quote-based. {first} will reply with a custom price.
          </div>
        ) : (
          <div className="summary">
            <div className="row between">
              <span>{pkg.name}{isHourly ? ` (${hrs}h × ${money(pkg.price)})` : qty ? ` (${count} ${qty.label.toLowerCase()} × ${money(pkg.price)})` : ''}</span>
              <span>{money(base)}</span>
            </div>
            {chosenAddons.map((a) => (
              <div key={a.id} className="row between"><span>{a.name}</span><span>{money(a.price)}</span></div>
            ))}
            <div className="row between total"><span>{dates.length > 1 ? (isDaily ? 'Per day' : 'Per date') : 'Total'}</span><span>{money(total)}</span></div>
            {dates.length > 1 && (
              <div className="row between total"><span>Total for {dates.length} {isDaily ? 'days' : 'dates'}</span><span>{money(total * dates.length)}</span></div>
            )}
            {pkg.depositPct > 0 && (
              <div className="row between muted small"><span>Deposit to confirm ({pkg.depositPct}%){dates.length > 1 && ', per date'}</span><span>{money(deposit)}</span></div>
            )}
            <div className="muted tiny mt-xs">Travel outside the service area isn't included. {first} will confirm any travel fee.</div>
          </div>
        )}

        <div className="mt">
          <PolicyTable policy={p.cancellationPolicy} />
        </div>

        <div className="note mt">
          <Info size={16} />
          Sending a request doesn't charge you. {first} has 48 hours to accept, decline or offer a different price. In-app deposits are coming soon.
        </div>

        {isMine && <div className="callout danger mt">This is your own listing, so you can't book it.</div>}
        {sendError && <div className="callout danger mt bk-error">{sendError}</div>}

        <button className="btn accent block mt-lg" disabled={!dates.length || sending || isMine} onClick={send}>
          {sending
            ? 'Sending…'
            : dates.length === 0
              ? 'Pick a date'
              : !user
                ? 'Sign in to send request'
                : dates.length === 1
                  ? `Send request · ${fmtBooking(fromKey(dates[0]))}`
                  : `Send ${dates.length} requests`}
        </button>
      </div>
    </div>
  )
}

// Guests / items / days for a package priced per person, per item or per day.
// Tap − / + or type a number; min/max come from the package (e.g. min_guests).
function QuantityStepper({ qty, value, onChange, priceText }) {
  const [draft, setDraft] = useState(null) // text while typing
  const step = qty.max >= 200 && value >= 20 ? 5 : 1
  const clamp = (n) => Math.min(qty.max, Math.max(qty.min, Math.round(n)))
  const commit = () => {
    if (draft != null && draft.trim() !== '' && !Number.isNaN(Number(draft))) onChange(clamp(Number(draft)))
    setDraft(null)
  }
  const range = qty.max < 100000 && qty.min > 1 ? `${qty.min}–${qty.max.toLocaleString()}` : qty.min > 1 ? `at least ${qty.min}` : `up to ${qty.max.toLocaleString()}`
  return (
    <div className="qty-row">
      <div>
        <b className="small">{qty.label}</b>
        <div className="muted tiny">{range} · {priceText}</div>
      </div>
      <div className="stepper">
        <button type="button" aria-label={`Fewer ${qty.label.toLowerCase()}`} disabled={value <= qty.min} onClick={() => onChange(clamp(value - step))}>−</button>
        <input
          type="number"
          inputMode="numeric"
          aria-label={qty.label}
          min={qty.min}
          max={qty.max}
          value={draft ?? value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button type="button" aria-label={`More ${qty.label.toLowerCase()}`} disabled={value >= qty.max} onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  )
}
