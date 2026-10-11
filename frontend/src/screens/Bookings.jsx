import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarX, ChevronDown, ChevronRight, Clock, History, MapPin, Search, Star, X } from 'lucide-react'
import DatePicker from '../components/DatePicker.jsx'
import ProfileLink, { PersonAvatar } from '../components/ProfileLink.jsx'
import SearchLauncher from '../components/SearchLauncher.jsx'
import { StatusPill, money } from '../components/Booking.jsx'
import { EmptyState, ErrorState, Loading, SignInPrompt } from '../components/States.jsx'
import { useAuth } from '../auth.jsx'
import { listMyBookings } from '../api/bookings.js'
import { availabilityByDay } from '../api/catalog.js'
import useQuery from '../lib/useQuery.js'
import { fmtChip, fromKey, isPast, toKey, today } from '../lib/dates.js'
import { deliversMedia } from '../verticals/index.js'

// What the client has to do next, per booking. Payments aren't live yet, so an
// accepted booking can't be paid in the app: say so instead of faking it.
const attentionFor = (b) => {
  if (b.status === 'countered') return { title: `New price offered: ${money(b.offer?.total ?? b.counterTotal)}`, cta: 'Review offer' }
  if (b.status === 'accepted') return { title: 'Accepted · deposit due', cta: 'Payments soon' }
  if (b.status === 'delivered') {
    return deliversMedia(b.vertical)
      ? { title: b.vertical === 'videography' ? 'Your video is ready' : 'Your photos are ready', cta: 'Review delivery', to: `/bookings/${b.id}/delivery` }
      : { title: `${(b.provider.shortName || firstName(b.provider.name)) || 'Your vendor'} marked this done`, cta: 'Confirm' }
  }
  if (b.status === 'completed' && b.reviewWindowOpen && !b.myReview) return { title: 'How did it go?', cta: 'Leave a review', to: `/bookings/${b.id}/review` }
  return null
}

const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const countdown = (date) => {
  const days = Math.round((date - today()) / 86400000)
  if (days < 0) return null
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 60) return `In ${days} days`
  return `In ${Math.round(days / 30)} months`
}

const firstName = (name = '') => name.split(' ')[0]

export default function Bookings() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [month, setMonth] = useState(() => new Date(today().getFullYear(), today().getMonth(), 1))
  const [selected, setSelected] = useState([]) // date keys
  const [showPast, setShowPast] = useState(false)

  const { data, loading, error, reload } = useQuery(user ? () => listMyBookings() : null, [user?.id])
  const bookings = data || []

  const byDay = bookings.reduce((acc, b) => {
    ;(acc[b.dateKey] ??= []).push(b)
    return acc
  }, {})
  const dots = Object.fromEntries(Object.entries(byDay).map(([k, list]) => [k, list.map((b) => b.status)]))

  const attention = bookings.filter(attentionFor).sort((a, b) => a.day - b.day)
  const needs = new Set(attention.map((b) => b.id))
  const isUpcoming = (b) => b.isActive || b.status === 'disputed'
  const upcoming = bookings.filter((b) => !needs.has(b.id) && isUpcoming(b)).sort((a, b) => a.start - b.start)
  const past = bookings.filter((b) => !needs.has(b.id) && !isUpcoming(b)).sort((a, b) => b.start - a.start)

  // When the visible month has nothing active, offer a jump to the next booking.
  const inMonth = (b) => b.day.getFullYear() === month.getFullYear() && b.day.getMonth() === month.getMonth()
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  const activeThisMonth = [...attention, ...upcoming].some(inMonth)
  const nextBooked = upcoming.find((b) => b.day >= monthEnd)

  const toggle = (key) => setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key].sort()))
  // Past days can only be opened to look at what was booked on them.
  const disabled = (d) => isPast(d) && !byDay[toKey(d)]
  const futureSelected = selected.filter((k) => !isPast(fromKey(k)))
  const selectedBookings = selected.flatMap((k) => byDay[k] || [])

  // How many photographers are free on at least one of the picked dates (search is public).
  const freeKey = futureSelected.join(',')
  const { data: freeMap } = useQuery(freeKey ? () => availabilityByDay(futureSelected) : null, [freeKey])
  const freeCount = freeMap ? new Set([...freeMap.values()].flatMap((s) => [...s])).size : null

  const findPhotographers = () => navigate(`/search?dates=${futureSelected.join(',')}`)

  return (
    <div className="bookings">
      <header className="home-header">
        <h1 className="title-lg">Bookings</h1>
        {user && data && <span className="muted small">{bookings.filter((b) => b.isActive || b.status === 'delivered').length} active</span>}
      </header>

      <div className="pad-x mb-sm">
        <SearchLauncher placeholder="Find someone to book" />
      </div>

      <div className="pad-x">
        <div className="bk-cal">
          <DatePicker selected={selected} onToggle={toggle} dots={dots} isDisabled={disabled} month={month} onMonthChange={setMonth} />

          {selected.length > 0 ? (
            <div className="bk-cal-selected">
              <div className="row between">
                <div className="chips">
                  {selected.map((k) => (
                    <button key={k} className="chip date-chip" onClick={() => toggle(k)}>
                      {fmtChip(fromKey(k))} <X size={12} />
                    </button>
                  ))}
                </div>
                <button className="link-btn small muted" onClick={() => setSelected([])}>Clear</button>
              </div>
              {selectedBookings.map((b) => <MiniBooking key={b.id} b={b} />)}
              {futureSelected.length > 0 && (
                <>
                  <button className="btn accent block" onClick={findPhotographers}>
                    <Search size={16} /> Find vendors for {futureSelected.length === 1 ? fmtChip(fromKey(futureSelected[0])) : `${futureSelected.length} dates`}
                  </button>
                  {freeCount != null && (
                    <div className="muted tiny bk-free-hint">
                      {freeCount === 0 ? 'Nobody is free then yet. Try other dates.' : `${freeCount} vendor${freeCount === 1 ? '' : 's'} free`}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="bk-cal-hint">
              <span className="muted tiny">Tap the dates you need someone for</span>
              {!activeThisMonth && nextBooked && (
                <button className="link-btn tiny" onClick={() => setMonth(new Date(nextBooked.day.getFullYear(), nextBooked.day.getMonth(), 1))}>
                  Next booking: {nextBooked.day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} <ChevronRight size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

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
            <section className="pad-x">
              <h2 className="section-title h4">Needs your attention</h2>
              {attention.map((b) => {
                const a = attentionFor(b)
                return (
                  <Link key={b.id} to={a.to || `/bookings/${b.id}`} className="attention-card">
                    <PersonAvatar id={b.provider.id} src={b.provider.avatar} name={b.provider.name} username={b.provider.username} className="attention-img" />
                    <div className="grow">
                      <b className="small">{a.title}</b>
                      <div className="muted tiny">
                        {b.packageName} with <ProfileLink id={b.provider.id}>{(b.provider.shortName || firstName(b.provider.name))}</ProfileLink> · {b.date}
                      </div>
                    </div>
                    <span className="att-cta">{a.cta}</span>
                  </Link>
                )
              })}
            </section>
          )}

          <section className="pad-x">
            <h2 className="section-title h4">Upcoming</h2>
            {upcoming.length === 0 && (
              <EmptyState
                compact
                icon={CalendarX}
                title="Nothing coming up"
                text={bookings.length ? 'Requests and confirmed bookings will show here.' : 'Book a photographer, caterer, DJ or venue and it shows up here.'}
                action={<Link to="/search" className="btn sm">Find vendors</Link>}
              />
            )}
            {upcoming.map((b, i) => {
              const showMonth = i === 0 || monthLabel(b.day) !== monthLabel(upcoming[i - 1].day)
              return (
                <div key={b.id}>
                  {showMonth && <div className="month-label">{monthLabel(b.day)}</div>}
                  <TimelineItem b={b} />
                </div>
              )
            })}
          </section>

          <section className="pad-x">
            {past.length > 0 ? (
              <>
                <button className="past-toggle" onClick={() => setShowPast(!showPast)}>
                  <span>Past bookings · {past.length}</span>
                  <ChevronDown size={18} style={{ transform: showPast ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                </button>
                {showPast && past.map((b) => <TimelineItem key={b.id} b={b} past />)}
              </>
            ) : (
              <>
                <h2 className="section-title h4">Past</h2>
                <EmptyState compact icon={History} text="Finished, declined and cancelled bookings will show here." />
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function TimelineItem({ b, past }) {
  const soon = countdown(b.day)
  const needsReview = b.status === 'completed' && b.reviewWindowOpen && !b.myReview
  return (
    <Link to={`/bookings/${b.id}`} className={`bk-item ${past ? 'past' : ''}`}>
      <div className="date-block">
        <span>{b.day.toLocaleDateString('en-US', { month: 'short' })}</span>
        <b>{b.day.getDate()}</b>
        <span>{b.day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
      </div>
      <div className="bk-body">
        <div className="row between">
          <b className="small">{b.packageName}</b>
          <StatusPill status={b.status} />
        </div>
        <ProfileLink id={b.provider.id} className="row gap-xs mt-xs" preview={{ src: b.provider.avatar, name: b.provider.name }}>
          <img className="avatar sm" src={b.provider.avatar} alt="" />
          <span className="small">{b.provider.name}</span>
        </ProfileLink>
        <div className="bk-meta">
          <span><Clock size={12} /> {b.time}</span>
          {b.location && <span><MapPin size={12} /> {b.location}</span>}
        </div>
        <div className="row between mt-xs">
          {!past && soon ? <span className="countdown">{soon}</span> : <span />}
          {needsReview ? (
            <span className="review-nudge"><Star size={12} /> Leave a review</span>
          ) : (
            <span className="muted tiny">{money(b.offer?.total ?? b.total)}</span>
          )}
        </div>
      </div>
    </Link>
  )
}

function MiniBooking({ b }) {
  return (
    <Link to={`/bookings/${b.id}`} className="mini-booking">
      <PersonAvatar id={b.provider.id} src={b.provider.avatar} name={b.provider.name} username={b.provider.username} className="avatar sm" />
      <div className="grow">
        <b className="small">{b.packageName}</b>
        <div className="muted tiny">{fmtChip(b.day)} · {b.time} · <ProfileLink id={b.provider.id}>{b.provider.name}</ProfileLink></div>
      </div>
      <StatusPill status={b.status} />
    </Link>
  )
}
