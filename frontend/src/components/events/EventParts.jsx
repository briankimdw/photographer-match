import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CalendarCheck, CalendarPlus, Check, ChevronRight, DatabaseZap, Plus } from 'lucide-react'
import Sheet from '../Sheet.jsx'
import PeoplePicker from '../PeoplePicker.jsx'
import { Loading } from '../States.jsx'
import CatalogIcon from '../home/CatalogIcon.jsx'
import { useAuth } from '../../auth.jsx'
import { useStore } from '../../store.jsx'
import useQuery from '../../lib/useQuery.js'
import { fromKey } from '../../lib/dates.js'
import {
  SETUP_MESSAGE, addCandidate, countdownLabel, eventError, eventsWithCandidate, inviteToEvent, isSetupError, listUpcomingEvents, whenLabel,
} from '../../api/events.js'
import './events.css'

// Overlapping member avatars ("+3" past `max`).
export function MemberStack({ members = [], max = 4, size = '' }) {
  const shown = members.slice(0, max)
  const more = members.length - shown.length
  return (
    <span className={`ev-stack ${size}`} role="img" aria-label={`${members.length} planning`}>
      {shown.map((m) => <img key={m.profileId} src={m.avatar} alt="" title={m.name} />)}
      {more > 0 && <span className="ev-more">+{more}</span>}
    </span>
  )
}

// Calendar-style date tile in the event's tint.
export function EventDate({ ev }) {
  if (!ev.startDate) {
    return (
      <span className="ev-date none" style={{ '--tint': ev.tint }}>
        <CatalogIcon name={ev.icon} size={20} />
      </span>
    )
  }
  const d = fromKey(ev.startDate)
  return (
    <span className="ev-date" style={{ '--tint': ev.tint }}>
      <span>{d.toLocaleDateString('en-US', { month: 'short' })}</span>
      <b>{d.getDate()}</b>
    </span>
  )
}

// One event in a list: date tile, title, when/where, who's planning.
export function EventRow({ ev }) {
  const countdown = countdownLabel(ev.startDate)
  const past = countdown && /ago|Yesterday/.test(countdown)
  return (
    <Link to={`/events/${ev.id}`} className="ev-row">
      <EventDate ev={ev} />
      <span className="grow">
        <span className="ev-row-title ellipsis block">{ev.title}</span>
        <span className="muted tiny ellipsis block">{[ev.typeName, ev.locationText?.split(',')[0]].filter(Boolean).join(' · ')}</span>
        <span className="row gap-xs mt-xs">
          {ev.members.length > 1 && <MemberStack members={ev.members} max={3} />}
          {countdown ? <span className={`ev-pill ${past ? '' : 'accent'}`}>{countdown}</span> : <span className="ev-pill">No date yet</span>}
        </span>
      </span>
      <ChevronRight size={16} className="muted" />
    </Link>
  )
}

// "Needs a database update" note.
export function SetupNote({ text = 'Invites, the shared board and the group chat turn on once it’s applied.' }) {
  return (
    <div className="note ev-setup">
      <DatabaseZap size={15} />
      <span>
        <b>{SETUP_MESSAGE}</b> {text}
      </span>
    </div>
  )
}

// Invite friends to an event (they become co-planners and join its chat).
export function InviteSheet({ open, onClose, event, onInvited }) {
  const { toast } = useStore()
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const close = () => {
    setPicked([])
    onClose()
  }
  const invite = async () => {
    setBusy(true)
    try {
      const n = await inviteToEvent(event.id, picked.map((p) => p.profileId))
      toast(n ? `Invited ${picked.length === 1 ? picked[0].name.split(' ')[0] : `${n} people`} to plan` : 'They’re already planning with you')
      onInvited?.()
      close()
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={close} title="Invite friends to plan">
      <p className="muted small" style={{ marginBottom: 10 }}>They can add vendors, vote and chat with everyone planning “{event?.title}”.</p>
      <PeoplePicker selected={picked} onChange={setPicked} exclude={(event?.members || []).map((m) => m.profileId)} />
      <button className="btn block mt-sm" disabled={!picked.length || busy} onClick={invite}>
        {busy ? 'Inviting…' : `Invite${picked.length ? ` ${picked.length}` : ''}`}
      </button>
    </Sheet>
  )
}

// Pick one of my events to add a vendor to (posts "Brian added X to Music" in its chat).
export function AddToEventSheet({ open, onClose, provider }) {
  const navigate = useNavigate()
  const { toast } = useStore()
  const events = useQuery(open ? () => listUpcomingEvents(20) : null, [open])
  const already = useQuery(open && provider ? () => eventsWithCandidate(provider.id) : null, [open, provider?.id])
  const [added, setAdded] = useState(() => new Set())
  const [busy, setBusy] = useState(null)
  const has = (id) => added.has(id) || already.data?.has(id)

  const add = async (ev) => {
    setBusy(ev.id)
    try {
      await addCandidate(ev.id, provider.id, { vertical: provider.vertical })
      setAdded((s) => new Set(s).add(ev.id))
      toast(`Added ${provider.name} to ${ev.title}`)
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(null)
    }
  }
  const startNew = () => {
    onClose()
    navigate(`/events/new?add=${provider.id}`)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add to event">
      {provider && <p className="muted small">Add {provider.name} to an event’s board. Everyone planning gets a note in the chat.</p>}
      {events.loading && !events.data ? (
        <Loading inline />
      ) : events.error ? (
        isSetupError(events.error) ? <SetupNote /> : <div className="muted small mt-sm">{eventError(events.error)}</div>
      ) : (
        <div className="mt-sm">
          {(events.data || []).map((ev) => (
            <div key={ev.id} className="ev-sheet-row">
              <EventDate ev={ev} />
              <span className="grow">
                <b className="small ellipsis block">{ev.title}</b>
                <span className="muted tiny ellipsis block">{[whenLabel(ev), ev.members.length > 1 && `${ev.members.length} planning`].filter(Boolean).join(' · ') || ev.typeName}</span>
              </span>
              {has(ev.id) ? (
                <span className="ev-added"><Check size={14} /> Added</span>
              ) : (
                <button className="btn sm" disabled={busy === ev.id} onClick={() => add(ev)}>
                  {busy === ev.id ? 'Adding…' : 'Add'}
                </button>
              )}
            </div>
          ))}
          {!events.data?.length && <p className="muted small">You don’t have any upcoming events yet.</p>}
        </div>
      )}
      <button className="btn ghost block mt" onClick={startNew}>
        <Plus size={16} /> New event{provider ? ` with ${provider.name}` : ''}
      </button>
    </Sheet>
  )
}

// "Add to event" trigger. variant 'icon' (top bar), 'card' (on a vendor card photo), 'button'.
// Safe inside a <Link>: clicks never reach it, and the sheet's clicks don't either.
export function AddToEventButton({ provider, variant = 'icon' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [open, setOpen] = useState(false)
  if (!provider) return null
  if (user && provider.profileId === user.id) return null
  const onClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!user) return navigate(`/sign-in?next=${encodeURIComponent(pathname + search)}`)
    setOpen(true)
  }
  const label = `Add ${provider.name} to an event`
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: 'contents' }}>
      {variant === 'card' ? (
        <button type="button" className="ev-card-add" onClick={onClick} aria-label={label} title="Add to event">
          <CalendarPlus size={16} />
        </button>
      ) : variant === 'button' ? (
        <button type="button" className="btn ghost grow" onClick={onClick}>
          <CalendarCheck size={16} /> Add to event
        </button>
      ) : (
        <button type="button" className="icon-btn" onClick={onClick} aria-label={label} title="Add to event">
          <CalendarPlus size={20} />
        </button>
      )}
      <AddToEventSheet open={open} onClose={() => setOpen(false)} provider={provider} />
    </span>
  )
}
