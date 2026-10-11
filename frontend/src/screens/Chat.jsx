import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, Calendar, CalendarHeart, ChevronRight, ImagePlus, Info, MessageCircle, SendHorizontal } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import GalleryUpload from '../components/GalleryUpload.jsx'
import Sheet from '../components/Sheet.jsx'
import PeoplePicker from '../components/PeoplePicker.jsx'
import { StatusPill } from '../components/Booking.jsx'
import { ModerationSheet } from '../components/PostSheets.jsx'
import ProfileLink, { PersonAvatar } from '../components/ProfileLink.jsx'
import ShareCard from '../components/share/ShareCard.jsx'
import { EmptyState, ErrorState, Loading, SignInPrompt } from '../components/States.jsx'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import useQuery from '../lib/useQuery.js'
import { avatarUrl } from '../lib/format.js'
import {
  addGroupMembers, getConversation, leaveGroup, listMessages, markRead, messageError, openChat, renameGroup, sendMessage, vendorChatInfo,
} from '../api/messages.js'
import { getBooking } from '../api/bookings.js'
import { eventIdForConversation } from '../api/events.js'
import { GALLERY_ACCEPT } from '../lib/galleryRules.js'

const GALLERY_STATUSES = ['confirmed', 'in_progress', 'delivered'] // the provider can upload the delivery gallery

const loadThread = async (id) => {
  const [conversation, messages] = await Promise.all([getConversation(id), listMessages(id)])
  return { conversation, messages }
}

// Add a message from the server, replacing its optimistic copy (matched by tempId) and skipping duplicates.
const withMessage = (msg, tempId) => (d) => {
  if (!d) return d
  let messages = tempId ? d.messages.filter((m) => m.id !== tempId) : d.messages
  if (!messages.some((m) => m.id === msg.id)) messages = [...messages, msg]
  return { ...d, messages }
}

// "Today", "Yesterday", "Mon, Oct 5", or "Oct 5, 2025" for other years.
const dayLabel = (iso) => {
  const d = new Date(iso)
  const today = new Date()
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(today) - start(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (d.getFullYear() !== today.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const GROUP_GAP_MS = 5 * 60 * 1000 // messages closer than this from the same person stack together

let tempSeq = 0

export default function Chat() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useStore()
  const { user, loading: authLoading } = useAuth()
  const { data, loading, error, reload, setData } = useQuery(user ? () => loadThread(id) : null, [id, user?.id])
  const c = data?.conversation
  const messages = data?.messages || []
  const { data: booking } = useQuery(c?.bookingId ? () => getBooking(c.bookingId) : null, [c?.bookingId])
  const { data: eventId } = useQuery(c?.kind === 'event' ? () => eventIdForConversation(c.id) : null, [c?.id, c?.kind]) // event chats link to their board
  const { data: vendorInfo } = useQuery(c?.kind === 'event_vendors' ? () => vendorChatInfo(c.id) : null, [c?.id, c?.kind]) // who's who, closed or not
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState(null)
  const [info, setInfo] = useState(false)
  const [typing, setTyping] = useState({}) // profileId -> timestamp
  const [gallery, setGallery] = useState(null) // picked File[] while the upload sheet is open
  const galleryInput = useRef()
  const live = useRef(null)
  const scroller = useRef()
  const bottom = useRef()
  const input = useRef()
  const nearBottom = useRef(true)

  // Live: new messages, read receipts, typing. Mark read on open and on each incoming message.
  const ready = !!c
  useEffect(() => {
    if (!ready) return
    markRead(id).catch((e) => console.warn(e))
    live.current = openChat(id, {
      onMessage: (msg) => {
        setData(withMessage(msg))
        if (!msg.mine) {
          setTyping((t) => ({ ...t, [msg.from]: 0 }))
          markRead(id).catch((e) => console.warn(e))
        }
      },
      onRead: (profileId, at) =>
        setData((d) => d && { ...d, conversation: { ...d.conversation, members: d.conversation.members.map((m) => (m.profileId === profileId ? { ...m, lastReadAt: at } : m)) } }),
      onTyping: (profileId) => setTyping((t) => ({ ...t, [profileId]: Date.now() })),
    })
    return () => live.current?.close()
  }, [id, ready, setData])

  // Typing indicators fade after a few seconds.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!Object.values(typing).some((t) => Date.now() - t < 4000)) return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [typing])

  // Stay pinned to the newest message unless the user has scrolled up to read.
  useLayoutEffect(() => {
    if (nearBottom.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, ready])
  useEffect(() => {
    const el = scroller.current?.closest('.viewport')
    if (!el) return
    const onScroll = () => (nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ready])

  // Auto-grow the composer up to ~5 lines.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  // Optimistic send: show the message right away, then swap in the saved one (or mark it failed).
  const deliver = async (text, tempId) => {
    try {
      const saved = await sendMessage(id, { text })
      setData(withMessage(saved, tempId))
    } catch (err) {
      console.warn(err)
      setData((d) => d && { ...d, messages: d.messages.map((m) => (m.id === tempId ? { ...m, pending: false, failed: messageError(err) } : m)) })
    }
  }
  const send = (e) => {
    e?.preventDefault()
    const text = draft.trim()
    if (!text) return
    const tempId = `tmp-${++tempSeq}`
    const at = new Date().toISOString()
    nearBottom.current = true
    setDraft('')
    setData((d) => d && { ...d, messages: [...d.messages, { id: tempId, mine: true, from: user.id, text, at, time: new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), pending: true }] })
    deliver(text, tempId)
    input.current?.focus()
  }
  const retry = (m) => {
    setData((d) => d && { ...d, messages: d.messages.map((x) => (x.id === m.id ? { ...x, pending: true, failed: null } : x)) })
    deliver(m.text, m.id)
  }
  const discard = (m) => setData((d) => d && { ...d, messages: d.messages.filter((x) => x.id !== m.id) })

  const shell = (body) => (
    <div className="chat">
      <TopBar title="Messages" />
      {body}
    </div>
  )
  if (authLoading || (loading && !data)) return shell(<Loading />)
  if (!user) return shell(<SignInPrompt title="Sign in to see this conversation" />)
  if (error) return shell(<ErrorState error={error} onRetry={reload} />)
  if (!c) {
    return shell(
      <EmptyState
        icon={MessageCircle}
        title="Conversation not found"
        text="It may have been removed, or you’re not part of it."
        action={<Link className="btn sm ghost" to="/inbox">Back to messages</Link>}
      />,
    )
  }

  const isGroup = c.isGroup || c.kind === 'event'
  const isVendorChat = c.kind === 'event_vendors'
  const other = c.members[0]
  const byProfile = new Map(c.members.map((m) => [m.profileId, m]))
  // Vendor chats label each author by role: "Rosa · Planner", the vendor's business name.
  const participants = new Map((vendorInfo?.participants || []).map((p) => [p.profile_id, p]))
  const authorOf = (m) => {
    const member = byProfile.get(m.from)
    const base = member || { id: m.from, profileId: m.from, name: 'Former member', avatar: avatarUrl(null, '?') }
    const p = isVendorChat ? participants.get(m.from) : null
    if (!p) return base
    return {
      ...base,
      id: p.provider_id || base.id,
      name: p.name,
      avatar: member ? base.avatar : avatarUrl(null, p.name),
      label: vendorChatLabel(p),
      former: p.role === 'vendor' && !p.active,
    }
  }
  const closed = isVendorChat && !!vendorInfo?.closed
  const closesAt = vendorInfo?.closes_at ? new Date(vendorInfo.closes_at) : null
  const closedNotice = closesAt && closesAt <= new Date()
    ? `This vendor chat closed on ${closesAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. You can still read it.`
    : 'This vendor chat is closed because the event was cancelled. You can still read it.'
  const pinned = c.bookingId ? { status: booking?.status ?? c.booking?.status, name: booking?.packageName ?? c.booking?.packageName ?? 'Booking' } : null

  // Read receipts for my latest delivered message.
  const lastMine = [...messages].reverse().find((m) => m.mine && !m.pending && !m.failed)
  const seenBy = lastMine ? c.members.filter((m) => m.lastReadAt && m.lastReadAt >= lastMine.at) : []
  const receipt = !lastMine ? null : isGroup ? (seenBy.length ? `Seen by ${seenBy.length === c.members.length ? 'everyone' : seenBy.map((m) => m.name.split(' ')[0]).join(', ')}` : 'Sent') : seenBy.length ? 'Seen' : 'Sent'

  const typers = c.members.filter((m) => typing[m.profileId] && Date.now() - typing[m.profileId] < 4000)
  const canUploadGallery = !!c.bookingId && booking?.role === 'provider' && GALLERY_STATUSES.includes(booking?.status)

  return (
    <div className="chat">
      <TopBar
        title={
          isGroup || !other ? (
            <button className="chat-title" onClick={() => setInfo(true)}>{c.title}</button>
          ) : (
            <ProfileLink id={other.id}>{c.title}</ProfileLink>
          )
        }
        subtitle={typers.length ? 'typing…' : isVendorChat ? `Vendor chat · ${c.members.length + 1} people` : isGroup ? `${c.members.length + 1} people` : other?.username ? `@${other.username}` : null}
        right={
          <>
            {isVendorChat && vendorInfo?.is_planner && (
              <Link to={`/events/${vendorInfo.event_id}`} className="icon-btn" aria-label="View event" title="View event">
                <CalendarHeart size={20} />
              </Link>
            )}
            {eventId && (
              <Link to={`/events/${eventId}`} className="icon-btn" aria-label="Event board" title="Event board">
                <CalendarHeart size={20} />
              </Link>
            )}
            <button className="icon-btn" aria-label="Conversation details" onClick={() => setInfo(true)}>
              <Info size={20} />
            </button>
          </>
        }
      />

      {pinned && (
        <Link to={`/bookings/${c.bookingId}`} className="pinned-booking">
          <Calendar size={18} />
          <div className="grow">
            <b className="small">{pinned.name}</b>
            {booking && <div className="muted tiny">{[booking.date, booking.location].filter(Boolean).join(' · ')}</div>}
          </div>
          {pinned.status && <StatusPill status={pinned.status} />}
          <ChevronRight size={16} />
        </Link>
      )}

      <div className="messages" ref={scroller}>
        {messages.length === 0 && (
          <div className="chat-intro">
            {isGroup ? (
              <div className="chat-intro-avatars">
                {c.members.slice(0, 3).map((m) => <PersonAvatar key={m.profileId} id={m.id} src={m.avatar} name={m.name} username={m.username} />)}
              </div>
            ) : (
              other && <PersonAvatar id={other.id} src={other.avatar} name={other.name} username={other.username} className="avatar lg" />
            )}
            {!isGroup && other ? <ProfileLink id={other.id}><b>{c.title}</b></ProfileLink> : <b>{c.title}</b>}
            {!isGroup && other && <Link to={`/u/${other.id}`} className="btn ghost sm">View profile</Link>}
            <div className="muted small">
              {c.kind === 'inquiry' && other
                ? `Ask ${other.name?.split(' ')[0] || 'them'} about availability, pricing or style.`
                : isGroup
                  ? 'Say hi to the group.'
                  : `This is the start of your conversation with ${other?.name?.split(' ')[0] || 'them'}.`}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const next = messages[i + 1]
          const newDay = !prev || dayLabel(prev.at) !== dayLabel(m.at)
          const joinsPrev = !newDay && prev && prev.from === m.from && new Date(m.at) - new Date(prev.at) < GROUP_GAP_MS
          const joinsNext = next && next.from === m.from && dayLabel(next.at) === dayLabel(m.at) && new Date(next.at) - new Date(m.at) < GROUP_GAP_MS
          const author = m.mine ? null : authorOf(m)
          const shared = m.shared
          return (
            <div key={m.id} className="msg-wrap">
              {newDay && <div className="day-sep"><span>{dayLabel(m.at)}</span></div>}
              <div className={`msg ${m.mine ? 'mine' : ''} ${joinsPrev ? 'joined' : ''} ${m.pending ? 'pending' : ''} ${m.failed ? 'failed' : ''}`}>
                {!m.mine && (
                  <span className="msg-avatar">
                    {!joinsNext && <PersonAvatar id={author.id} src={author.avatar} name={author.name} username={author.username} className="avatar sm" />}
                  </span>
                )}
                <div className="msg-col">
                  {!m.mine && isGroup && !joinsPrev && (
                    <ProfileLink id={author.id} className="msg-author muted tiny">
                      {author.label || author.name}
                      {author.former && <span className="msg-tag">Former vendor</span>}
                    </ProfileLink>
                  )}
                  {shared && <ShareCard shared={shared} mine={m.mine} />}
                  {m.text && (
                    <div
                      className="bubble"
                      title={m.time}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        if (m.mine) return
                        setMenu({ what: 'message', username: author.username, target: { type: 'message', id: m.id }, blockProfileId: author.profileId })
                      }}
                    >
                      {m.text}
                    </div>
                  )}
                  {m.failed && (
                    <div className="msg-failed tiny">
                      <AlertCircle size={12} /> Not sent ·{' '}
                      <button onClick={() => retry(m)}>Retry</button> · <button onClick={() => discard(m)}>Delete</button>
                    </div>
                  )}
                  {!joinsNext && !m.failed && <div className="msg-time muted tiny">{m.pending ? 'Sending…' : m.time}</div>}
                </div>
              </div>
              {m === lastMine && receipt && <div className="receipt muted tiny">{receipt}</div>}
            </div>
          )
        })}
        {typers.length > 0 && (
          <div className="msg typing-row">
            <span className="msg-avatar"><PersonAvatar id={typers[0].id} src={typers[0].avatar} name={typers[0].name} username={typers[0].username} className="avatar sm" /></span>
            <div className="bubble typing" aria-label={`${typers[0].name} is typing`}>
              <i /><i /><i />
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {closed ? (
        <div className="composer sticky-bottom composer-closed muted small">{closedNotice}</div>
      ) : (
        <form className="composer sticky-bottom" onSubmit={send}>
          {canUploadGallery && (
            <>
              <button type="button" className="icon-btn" aria-label="Upload gallery" title="Upload gallery" onClick={() => galleryInput.current?.click()}>
                <ImagePlus size={20} />
              </button>
              <input
                ref={galleryInput}
                type="file"
                multiple
                accept={GALLERY_ACCEPT}
                hidden
                onChange={(e) => {
                  const picked = Array.from(e.target.files || [])
                  e.target.value = '' // so picking the same files again still fires
                  if (picked.length) setGallery(picked)
                }}
              />
            </>
          )}
          <textarea
            ref={input}
            rows={1}
            placeholder="Message…"
            maxLength={4000}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (e.target.value) live.current?.typing()
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter adds a line (phones show a return key, so the send button is the main path there).
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e)
            }}
          />
          <button className="icon-btn accent" disabled={!draft.trim()} aria-label="Send">
            <SendHorizontal size={20} />
          </button>
        </form>
      )}

      <ChatInfo
        open={info}
        onClose={() => setInfo(false)}
        conversation={c}
        onChanged={reload}
        onLeft={() => navigate('/inbox', { replace: true })}
        onReport={() => {
          setInfo(false)
          setMenu({
            what: 'conversation',
            username: isGroup ? null : other?.username,
            target: !isGroup && other ? { type: 'profile', id: other.profileId } : null,
            blockProfileId: isGroup ? null : other?.profileId,
          })
        }}
      />
      <GalleryUpload
        open={!!gallery}
        bookingId={c.bookingId}
        files={gallery}
        onClose={() => setGallery(null)}
        onChooseAgain={() => galleryInput.current?.click()}
      />
      <ModerationSheet open={!!menu} onClose={() => setMenu(null)} what={menu?.what} username={menu?.username} target={menu?.target} blockProfileId={menu?.blockProfileId} />
    </div>
  )
}

// How a vendor chat participant is labeled above their messages.
function vendorChatLabel(p) {
  switch (p.role) {
    case 'planner':
      return `${p.name} · Planner`
    case 'vendor':
      return p.name
    default:
      return `${p.name} · Former planner`
  }
}

// Details sheet: who's in the conversation; for groups, rename / add people / leave.
function ChatInfo({ open, onClose, conversation: c, onChanged, onLeft, onReport }) {
  const { toast } = useStore()
  const [mode, setMode] = useState(null) // null | 'add' | 'rename' | 'leave'
  const [picked, setPicked] = useState([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setMode(null)
      setPicked([])
    }
  }, [open])

  const run = async (fn, done) => {
    setBusy(true)
    try {
      await fn()
      done?.()
    } catch (e) {
      console.warn(e)
      toast(messageError(e))
    } finally {
      setBusy(false)
    }
  }

  const sheetTitle = mode === 'add' ? 'Add people' : mode === 'rename' ? 'Rename group' : mode === 'leave' ? 'Leave group?' : c.isGroup ? 'Group' : 'Details'
  return (
    <Sheet open={open} onClose={onClose} title={sheetTitle}>
      {mode === 'add' ? (
        <>
          <PeoplePicker selected={picked} onChange={setPicked} exclude={c.members.map((m) => m.profileId)} />
          <button
            className="btn block mt-sm"
            disabled={!picked.length || busy}
            onClick={() => run(() => addGroupMembers(c.id, picked.map((p) => p.profileId)), () => {
              toast(`Added ${picked.length === 1 ? picked[0].name : `${picked.length} people`}`)
              onChanged()
              setMode(null)
              setPicked([])
            })}
          >
            {busy ? 'Adding…' : `Add${picked.length ? ` ${picked.length}` : ''}`}
          </button>
        </>
      ) : mode === 'rename' ? (
        <form onSubmit={(e) => {
          e.preventDefault()
          run(() => renameGroup(c.id, title), () => {
            onChanged()
            setMode(null)
          })
        }}>
          <input className="input" autoFocus maxLength={80} placeholder="Group name" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn block mt-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </form>
      ) : mode === 'leave' ? (
        <>
          <p className="muted small">You’ll stop getting messages from “{c.title}”. Someone in the group can add you back.</p>
          <div className="row gap-sm mt-sm">
            <button className="btn ghost grow" onClick={() => setMode(null)}>Cancel</button>
            <button className="btn danger-solid grow" disabled={busy} onClick={() => run(() => leaveGroup(c.id), onLeft)}>Leave</button>
          </div>
        </>
      ) : (
        <>
          <div className="section-label">{c.isGroup ? `${c.members.length + 1} people` : 'With'}</div>
          {c.members.map((m) => (
            <Link key={m.profileId} to={`/u/${m.id}`} className="list-row" onClick={onClose}>
              <img className="avatar" src={m.avatar} alt="" />
              <div className="grow">
                <div>{m.name}</div>
                {m.username && <div className="muted tiny">@{m.username}{m.isPhotographer ? ' · Vendor' : ''}</div>}
              </div>
              <ChevronRight size={16} className="muted" />
            </Link>
          ))}
          {c.isGroup && <div className="list-row muted small">+ You</div>}
          {c.isGroup && c.kind !== 'event_vendors' && (
            <div className="settings-group mt-sm">
              <button className="list-row" onClick={() => setMode('add')}>Add people</button>
              <button className="list-row" onClick={() => { setTitle(c.customTitle || ''); setMode('rename') }}>Rename group</button>
              <button className="list-row danger" onClick={() => setMode('leave')}>Leave group</button>
            </div>
          )}
          {!c.isGroup && (
            <div className="settings-group mt-sm">
              <button className="list-row danger" onClick={onReport}>Report or block</button>
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}
