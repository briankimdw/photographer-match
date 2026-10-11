import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CalendarDays, CalendarX, Check, ChevronRight, MapPin, MessageCircle, MessagesSquare, MoreHorizontal, Search as SearchIcon, Send, ThumbsUp, Trash2, UserPlus,
  Users,
} from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import Sheet from '../components/Sheet.jsx'
import ShareSheet from '../components/share/ShareSheet.jsx'
import { EmptyState, ErrorState, Loading, SignInPrompt } from '../components/States.jsx'
import { TintIcon } from '../components/home/CatalogIcon.jsx'
import { RatingInline } from '../components/home/Cards.jsx'
import { CoverFallback } from '../components/verticals/VerticalIcon.jsx'
import { InviteSheet, MemberStack, SetupNote } from '../components/events/EventParts.jsx'
import '../components/events/events.css'
import { useAuth } from '../auth.jsx'
import { useStore } from '../store.jsx'
import useQuery from '../lib/useQuery.js'
import { cents } from '../lib/planBrief.js'
import { priceFrom } from '../api/home.js'
import {
  CANDIDATE_STATUSES, EVENT_KINDS, countdownLabel, deleteEvent, editEvent, eventError, getEventBoard, getVendorChat, leaveEvent,
  readdVendorToChat, removeCandidate, removeEventMember, removeVendorFromChat, setCandidateStatus, setVote, subscribeToEvent, whenLabel,
} from '../api/events.js'
import { verticalMeta } from '../verticals/index.js'

const STAGE = {
  considering: { label: 'Considering', cls: '' },
  shortlisted: { label: 'Shortlisted', cls: 'violet' },
  requested: { label: 'Requested', cls: 'blue' },
  booked: { label: 'Booked', cls: 'ok' },
}
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a')

// /events/:id — the event workspace: who's planning, the group chat, and the
// "Who we're hiring" board (candidates per category, votes, status).
export default function EventDetail() {
  const { id } = useParams()
  const { user, loading: authLoading } = useAuth()
  const board = useQuery(user ? () => getEventBoard(id) : null, [id, user?.id])

  // Live: someone adds a vendor, votes or joins.
  const { reload } = board
  const ready = !!board.data?.setup
  useEffect(() => (ready ? subscribeToEvent(id, reload) : undefined), [id, ready, reload])

  if (authLoading || (board.loading && !board.data)) return <><TopBar title="Event" /><Loading /></>
  if (!user) return <><TopBar title="Event" /><SignInPrompt title="Sign in to see this event" text="Events are shared with the people planning them." /></>
  if (board.error) return <><TopBar title="Event" /><ErrorState error={board.error} onRetry={board.reload} /></>
  if (!board.data) {
    return (
      <>
        <TopBar title="Event" />
        <EmptyState icon={CalendarX} title="Event not found" text="It may have been deleted, or you’re not planning it." action={<Link className="btn sm ghost" to="/events">My events</Link>} />
      </>
    )
  }
  return <Workspace board={board} />
}

function Workspace({ board: query }) {
  const navigate = useNavigate()
  const { toast } = useStore()
  const { data: board, reload, setData } = query
  const ev = board.event
  const [params, setParams] = useSearchParams()
  // ?invite=1 (from the AI planner's "Invite friends") opens the invite sheet once.
  const [invite, setInvite] = useState(() => params.get('invite') === '1' && board.setup)
  useEffect(() => {
    if (params.has('invite')) setParams({}, { replace: true })
  }, [params, setParams])
  const [share, setShare] = useState(false)
  const [more, setMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState(null) // candidate whose sheet is open

  const countdown = countdownLabel(ev.startDate)
  const others = ev.members.filter((m) => !m.isMe)
  const names = others.length ? `You, ${others.slice(0, 3).map((m) => m.firstName).join(', ')}${others.length > 3 ? ` +${others.length - 3}` : ''}` : 'Just you so far'
  const dateQuery = ev.startDate ? `dates=${ev.startDate}` : ''

  const openChat = () => {
    if (!board.chatId) return toast('The group chat needs a database update first.')
    navigate(`/inbox/${board.chatId}`)
  }

  // Optimistic vote toggle.
  const vote = async (c) => {
    const on = !c.votedByMe
    const patch = (fn) => setData((d) => d && { ...d, groups: d.groups.map((g) => ({ ...g, items: g.items.map((x) => (x.providerId === c.providerId ? fn(x) : x)) })) })
    patch((x) => ({ ...x, votedByMe: on, votes: x.votes + (on ? 1 : -1), voters: on ? [...x.voters, 'You'] : x.voters.filter((n) => n !== 'You') }))
    try {
      await setVote(ev.id, c.providerId, on)
      reload()
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
      reload()
    }
  }

  const { planned, booked, pending } = board.budget
  const showBudget = planned != null || booked > 0 || pending > 0
  const neededGroups = board.groups.filter((g) => g.needed || g.items.length)

  return (
    <div style={{ '--tint': ev.tint }}>
      <TopBar
        title="Event"
        right={
          <>
            <button className="icon-btn" onClick={() => setShare(true)} aria-label="Share event"><Send size={20} /></button>
            <button className="icon-btn" onClick={() => setMore(true)} aria-label="More"><MoreHorizontal size={20} /></button>
          </>
        }
      />

      <div className="ev-hero">
        <div className="ev-hero-top">
          <TintIcon item={{ icon: ev.icon, tint: ev.tint }} size={44} className="on-card" />
          {countdown && <span className="ev-count">{countdown}</span>}
        </div>
        <h2>{ev.title}</h2>
        <div className="ev-hero-lines">
          <span><CalendarDays size={14} /> {whenLabel(ev) || 'Date to be decided'}</span>
          <span className="ellipsis"><MapPin size={14} /> {ev.locationText || 'Place to be decided'}</span>
          {ev.guestCount != null && <span><Users size={14} /> {ev.guestCount} guests · {ev.typeName}</span>}
        </div>
        <div className="ev-people">
          <MemberStack members={ev.members} max={5} size="lg" />
          <span className="grow ev-people-names ellipsis">{names}</span>
          <button className="btn sm" onClick={() => setInvite(true)} disabled={!board.setup}>
            <UserPlus size={15} /> Invite
          </button>
        </div>
      </div>

      <div className="ev-actions">
        <button className="btn" onClick={openChat}>
          <MessageCircle size={16} /> Open group chat
        </button>
      </div>

      {!board.setup && <SetupNote />}

      {showBudget && (
        <div className="ev-budget">
          <div className="row between small">
            <b>Budget</b>
            <span className="muted">{planned != null ? `${cents(booked)} of ${cents(planned)} booked` : `${cents(booked)} booked`}</span>
          </div>
          {planned > 0 && (
            <div className="ev-budget-bar" aria-hidden="true">
              <i className="booked" style={{ width: `${Math.min(100, (booked / planned) * 100)}%` }} />
              <i className="pending" style={{ width: `${Math.max(0, Math.min(100 - (booked / planned) * 100, (pending / planned) * 100))}%` }} />
            </div>
          )}
          <div className="ev-budget-legend">
            <span><i className="ev-dot" style={{ background: 'var(--ok)' }} />Booked <b>{cents(booked)}</b></span>
            {pending > 0 && <span><i className="ev-dot" style={{ background: '#fbbf24' }} />Requested <b>{cents(pending)}</b></span>}
            {planned != null && <span>Left <b>{cents(Math.max(0, planned - booked - pending))}</b></span>}
          </div>
        </div>
      )}

      <div className="ev-board-head">
        <div>
          <h3>Who we’re hiring</h3>
          <div className="muted tiny">{board.counts.covered} of {board.counts.categories} booked · tap 👍 on the ones you like</div>
        </div>
      </div>

      {neededGroups.map((g) => {
        const done = g.items.some((c) => c.stage === 'booked')
        const findTo = `/search?v=${g.vertical.slug}${dateQuery && `&${dateQuery}`}`
        return (
          <section key={g.vertical.slug} className={`ev-group ${done ? 'done' : ''}`}>
            <div className="ev-group-head">
              <TintIcon item={g.vertical} size={34} />
              <span className="grow">
                <b className="block">{g.vertical.name}</b>
                <span className="muted tiny">
                  {done ? 'Booked' : g.items.length ? `${g.items.length} option${g.items.length === 1 ? '' : 's'}` : 'Nothing picked yet'}
                </span>
              </span>
              {done ? <span className="ev-pill ok"><Check size={12} /> Done</span> : !g.items.length && (
                <Link to={findTo} className="ev-find-inline">Find {article(g.vertical.noun)} {g.vertical.noun} <ChevronRight size={14} /></Link>
              )}
            </div>
            {g.items.length > 0 && (
              <div className="ev-group-items">
                {g.items.map((c) => (
                  <Candidate key={c.providerId} c={c} onVote={() => vote(c)} onOpen={() => setPicked(c)} canVote={board.setup && c.onBoard} />
                ))}
                {!done && (
                  <Link to={findTo} className="ev-find"><SearchIcon size={14} /> Find another {g.vertical.noun}</Link>
                )}
              </div>
            )}
          </section>
        )
      })}
      <p className="muted tiny pad-x mt">Add vendors from their profile with “Add to event”. Book from here and the booking is linked to this event.</p>
      <VendorChat event={ev} />
      <div className="mt-lg" />

      <InviteSheet open={invite} onClose={() => setInvite(false)} event={ev} onInvited={reload} />
      <CandidateSheet c={picked} event={ev} dateQuery={dateQuery} onClose={() => setPicked(null)} onChanged={reload} />
      <MoreSheet open={more} onClose={() => setMore(false)} event={ev} setup={board.setup} onEdit={() => { setMore(false); setEditing(true) }} onChanged={reload} />
      <EditSheet open={editing} onClose={() => setEditing(false)} event={ev} onSaved={reload} />
      {share && <ShareSheet item={{ kind: 'event', id: ev.id, title: ev.title, subtitle: [whenLabel(ev), ev.locationText].filter(Boolean).join(' · ') }} onClose={() => setShare(false)} />}
    </div>
  )
}

function Candidate({ c, onVote, onOpen, canVote }) {
  const p = c.provider
  const stage = STAGE[c.stage]
  const price = p && priceFrom(p)
  return (
    <div className="ev-cand">
      <Link to={`/u/${c.providerId}`} className="ev-cand-img" aria-label={p?.name || 'Vendor'}>
        {p?.cover ? <img className="ev-cand-img" src={p.cover} alt="" loading="lazy" /> : <CoverFallback vertical={p?.vertical || c.vertical} className="ev-cand-img fallback" />}
      </Link>
      <div className="grow">
        <button className="ev-cand-name ellipsis block" style={{ maxWidth: '100%' }} onClick={onOpen}>{p?.name || 'A vendor'}</button>
        <div className="muted tiny ellipsis">
          {p ? <><RatingInline p={p} />{price && ` · ${price}`}</> : 'No longer listed'}
        </div>
        {c.note && <div className="ev-note">“{c.note}”</div>}
        <div className="ev-cand-meta">
          <button className={`ev-pill ${stage.cls} ev-stage`} onClick={onOpen} aria-label={`Status: ${stage.label}. Change`}>
            {c.stage === 'booked' && <Check size={11} />} {stage.label}
          </button>
          {canVote && (
            <button className={`ev-vote ${c.votedByMe ? 'on' : ''}`} onClick={onVote} aria-pressed={c.votedByMe} title={c.voters.join(', ') || 'Vote'}>
              <ThumbsUp size={12} /> {c.votes || ''}
            </button>
          )}
          {c.addedBy && <span className="muted tiny ellipsis">by {c.addedBy.isMe ? 'you' : c.addedBy.firstName}</span>}
        </div>
      </div>
    </div>
  )
}

// The chat with the event's booked vendors: open it, see who's in, and (owner) remove / add back.
function VendorChat({ event: ev }) {
  const navigate = useNavigate()
  const { toast } = useStore()
  const { data: vc, error, reload } = useQuery(() => getVendorChat(ev.id), [ev.id])
  const [confirm, setConfirm] = useState(null) // vendor about to be removed
  const [gone, setGone] = useState(null) // name of a vendor "Add back" couldn't bring in
  const [busy, setBusy] = useState(false)

  // Hidden while loading and before the database update (getVendorChat returns null then).
  if (!error && !vc) return null

  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
      reload()
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = (v) =>
    run(async () => {
      await removeVendorFromChat(ev.id, v.provider_id)
      setConfirm(null)
      setGone(null)
      toast(`Removed ${v.name} from the vendor chat`)
    })
  const readd = (v) =>
    run(async () => {
      const back = await readdVendorToChat(ev.id, v.provider_id)
      setGone(back ? null : v.name)
      if (back) toast(`${v.name} is back in the vendor chat`)
    })

  return (
    <section className="pad-x mt">
      <div className="section-label">Vendor chat</div>
      {error ? (
        <p className="muted small">{eventError(error)}</p>
      ) : !vc.conversation_id ? (
        <p className="muted small">The vendor chat opens when 2 vendors have accepted bookings for this event.</p>
      ) : (
        <>
          <button className="btn block" onClick={() => navigate(`/inbox/${vc.conversation_id}`)}>
            <MessagesSquare size={16} /> Open vendor chat
          </button>
          {gone && <p className="muted small mt-sm"><b>{gone}</b>: They no longer have an active booking for this event.</p>}
          {vc.vendors.map((v) => (
            <div key={v.provider_id} className="list-row">
              <div className="grow">
                <Link to={`/u/${v.provider_id}`}>{v.name}</Link>
                <div className="muted tiny">{v.vertical ? verticalMeta(v.vertical).name : 'Vendor'}</div>
              </div>
              {(v.in_chat || v.removed) && <span className={`ev-pill ${v.in_chat ? 'ok' : ''}`}>{v.in_chat ? 'In chat' : 'Removed'}</span>}
              {vc.is_owner && v.in_chat && (
                <button className="btn sm ghost" disabled={busy} onClick={() => setConfirm(v)}>Remove</button>
              )}
              {vc.is_owner && v.removed && (
                <button className="btn sm ghost" disabled={busy} onClick={() => readd(v)}>Add back</button>
              )}
            </div>
          ))}
        </>
      )}
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title="Remove from vendor chat?">
        <p className="muted small">Remove {confirm?.name} from the vendor chat? Their booking isn’t affected, and their earlier messages stay.</p>
        <div className="row gap-sm mt">
          <button className="btn ghost grow" onClick={() => setConfirm(null)}>Cancel</button>
          <button className="btn danger-solid grow" disabled={busy} onClick={() => remove(confirm)}>Remove</button>
        </div>
      </Sheet>
    </section>
  )
}

// Move a candidate along, book it, or take it off the board.
function CandidateSheet({ c, event, dateQuery, onClose, onChanged }) {
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  if (!c) return null
  const run = async (fn, msg) => {
    setBusy(true)
    try {
      await fn()
      if (msg) toast(msg)
      onChanged()
      onClose()
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(false)
    }
  }
  const name = c.provider?.name || 'This vendor'
  const bookTo = `/book/${c.providerId}?event=${event.id}${dateQuery && `&${dateQuery}`}`
  return (
    <Sheet open onClose={onClose} title={name}>
      {c.booking ? (
        <div className="note">
          <Check size={15} />
          <span>{c.stage === 'booked' ? 'Booked' : 'Requested'} for this event{c.booking.packageName ? ` · ${c.booking.packageName}` : ''}{c.booking.totalCents != null ? ` · ${cents(c.booking.totalCents)}` : ''}.{' '}
            {c.booking.mine && <Link to={`/bookings/${c.booking.id}`} onClick={onClose}><b>Open booking</b></Link>}
          </span>
        </div>
      ) : c.onBoard ? (
        <div className="ev-stage-opts">
          {CANDIDATE_STATUSES.map(([value, label]) => (
            <button
              key={value}
              className={`ev-stage-opt ${c.status === value ? 'on' : ''}`}
              disabled={busy}
              onClick={() => (c.status === value ? onClose() : run(() => setCandidateStatus(event.id, c.providerId, value)))}
            >
              <span className={`ev-pill ${STAGE[value].cls}`}>{label}</span>
              <span className="grow muted tiny">
                {value === 'considering' ? 'Still deciding' : value === 'shortlisted' ? 'A favorite: tell the group' : 'Hired outside the app'}
              </span>
              {c.status === value && <Check size={16} />}
            </button>
          ))}
        </div>
      ) : null}
      {c.voters.length > 0 && <p className="muted small mt-sm">👍 {c.voters.join(', ')}</p>}
      <div className="row gap-xs mt">
        <Link to={`/u/${c.providerId}`} className="btn ghost grow" onClick={onClose}>View profile</Link>
        {!c.booking && <Link to={bookTo} className="btn accent grow" onClick={onClose}>Book for this event</Link>}
      </div>
      {c.onBoard && (
        <button className="btn ghost danger block mt-sm" disabled={busy} onClick={() => run(() => removeCandidate(event.id, c.providerId), `Removed ${name}`)}>
          <Trash2 size={15} /> Remove from board
        </button>
      )}
    </Sheet>
  )
}

// People, edit, leave / delete.
function MoreSheet({ open, onClose, event: ev, setup, onEdit, onChanged }) {
  const navigate = useNavigate()
  const { toast } = useStore()
  const [confirm, setConfirm] = useState(null) // 'leave' | 'delete'
  const [busy, setBusy] = useState(false)
  const close = () => {
    setConfirm(null)
    onClose()
  }
  const run = async (fn, after) => {
    setBusy(true)
    try {
      await fn()
      after?.()
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(false)
    }
  }
  if (confirm) {
    const leaving = confirm === 'leave'
    return (
      <Sheet open={open} onClose={close} title={leaving ? 'Leave this event?' : 'Delete this event?'}>
        <p className="muted small">
          {leaving ? `You’ll leave “${ev.title}” and its group chat. Anyone planning can invite you back.` : `“${ev.title}”, its board and its group chat are deleted for everyone. Bookings stay in Bookings.`}
        </p>
        <div className="row gap-sm mt">
          <button className="btn ghost grow" onClick={() => setConfirm(null)}>Cancel</button>
          <button
            className="btn danger-solid grow"
            disabled={busy}
            onClick={() => run(() => (leaving ? leaveEvent(ev.id) : deleteEvent(ev.id)), () => {
              toast(leaving ? 'You left the event' : 'Event deleted')
              navigate('/events', { replace: true })
            })}
          >
            {leaving ? 'Leave' : 'Delete'}
          </button>
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet open={open} onClose={close} title="Event">
      <div className="section-label">{ev.members.length} planning</div>
      {ev.members.map((m) => (
        <div key={m.profileId} className="list-row">
          <Link to={`/u/${m.id}`} onClick={close}><img className="avatar" src={m.avatar} alt="" /></Link>
          <div className="grow">
            <div>{m.isMe ? `${m.name} (you)` : m.name}</div>
            <div className="muted tiny">{m.isOwner ? 'Organizer' : 'Co-planner'}{m.username ? ` · @${m.username}` : ''}</div>
          </div>
          {ev.isOwner && !m.isMe && setup && (
            <button className="btn sm ghost" disabled={busy} onClick={() => run(() => removeEventMember(ev.id, m.profileId), () => { toast(`Removed ${m.firstName}`); onChanged() })}>
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="settings-group mt-sm">
        <button className="list-row" onClick={onEdit}>Edit details</button>
        {ev.isOwner ? (
          <button className="list-row danger" onClick={() => setConfirm('delete')}>Delete event</button>
        ) : (
          <button className="list-row danger" onClick={() => setConfirm('leave')}>Leave event</button>
        )}
      </div>
    </Sheet>
  )
}

function EditSheet({ open, onClose, event: ev, onSaved }) {
  const { toast } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setForm({
        title: ev.title,
        type: ev.type,
        date: ev.startDate || '',
        place: ev.locationText || '',
        guests: ev.guestCount ?? '',
        budget: ev.budgetCents != null ? Math.round(ev.budgetCents / 100) : '',
      })
    }
  }, [open, ev])
  if (!open || !form) return null
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await editEvent(ev.id, {
        title: form.title,
        type: form.type,
        date: form.date || null,
        endDate: ev.endDate && form.date === ev.startDate ? ev.endDate : null,
        locationText: form.place,
        guestCount: form.guests === '' ? null : Number(form.guests),
        budget: form.budget === '' ? null : Number(form.budget),
      })
      toast('Saved')
      onSaved()
      onClose()
    } catch (err) {
      console.warn(err)
      toast(eventError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={onClose} title="Edit event">
      <form className="ev-form" style={{ padding: 0 }} onSubmit={save}>
        <label className="field">Name<input className="input" maxLength={120} value={form.title} onChange={set('title')} /></label>
        <div className="ev-kinds">
          {EVENT_KINDS.map(([slug, name]) => (
            <button key={slug} type="button" className={`chip toggle ${form.type === slug ? 'on' : ''}`} onClick={() => setForm((f) => ({ ...f, type: slug }))}>{name}</button>
          ))}
        </div>
        <div className="row two">
          <label className="field">Date<input className="input" type="date" value={form.date} onChange={set('date')} /></label>
          <label className="field">Guests<input className="input" type="number" min={0} value={form.guests} onChange={set('guests')} /></label>
        </div>
        <label className="field">Where<input className="input" maxLength={200} value={form.place} onChange={set('place')} /></label>
        <label className="field">Total budget ($)<input className="input" type="number" min={0} value={form.budget} onChange={set('budget')} /></label>
        <button className="btn block" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  )
}
