import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, CalendarDays, MessageCircle, PenSquare, Search, Users } from 'lucide-react'
import { PersonAvatar } from '../components/ProfileLink.jsx'
import { EmptyState, ErrorState, Loading, SignInPrompt } from '../components/States.jsx'
import { useAuth } from '../auth.jsx'
import useQuery from '../lib/useQuery.js'
import { ago } from '../lib/dates.js'
import { listConversations, subscribeToInbox } from '../api/messages.js'

const preview = (c) => {
  const last = c.lastMessage
  if (!last) return c.isGroup ? 'New group · say hi 👋' : 'Say hi 👋'
  const sender = c.members.find((m) => m.profileId === last.senderId)
  const who = last.fromMe ? 'You: ' : c.isGroup ? `${sender?.name.split(' ')[0] ?? 'Someone'}: ` : ''
  return who + (last.text || 'Shared a post')
}

export default function Inbox() {
  const { user, loading: authLoading } = useAuth()
  const { data, loading, error, reload } = useQuery(user ? listConversations : null, [user?.id])
  const [q, setQ] = useState('')

  // Live: refresh when a message arrives in any of my conversations.
  useEffect(() => (user ? subscribeToInbox(reload) : undefined), [user?.id, reload])

  const query = q.trim().toLowerCase()
  const list = (data || []).filter(
    (c) => !query || c.title.toLowerCase().includes(query) || c.lastMessage?.text?.toLowerCase().includes(query) || c.booking?.packageName?.toLowerCase().includes(query),
  )

  return (
    <div>
      <header className="home-header">
        <h1 className="title-lg">Messages</h1>
        {user && (
          <Link to="/inbox/new" className="inbox-compose" aria-label="New message">
            <PenSquare size={18} aria-hidden="true" />
          </Link>
        )}
      </header>
      {authLoading ? (
        <Loading />
      ) : !user ? (
        <SignInPrompt title="Sign in to see your messages" text="Chat with vendors about bookings, pricing and style." />
      ) : (
        <>
          <div className="pad-x">
            <div className="search">
              <Search size={16} />
              <input placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {loading && !data ? (
            <Loading />
          ) : error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : !data?.length ? (
            <EmptyState
              icon={MessageCircle}
              title="No messages yet"
              text="Message anyone on photomatch, ask a vendor a question, or request a booking to start a thread."
              action={<Link className="btn sm" to="/inbox/new">New message</Link>}
            />
          ) : !list.length ? (
            <EmptyState compact icon={Search} title="No matches" text={`Nothing matches “${q.trim()}”.`} />
          ) : (
            <div className="mt-sm">
              {list.map((c) => {
                const [first] = c.members
                return (
                  <Link key={c.id} to={`/inbox/${c.id}`} className={`convo ${c.unread ? 'unread' : ''}`}>
                    <div className="convo-avatar">
                      {first && <PersonAvatar id={first.id} src={first.avatar} name={first.name} username={first.username} className="avatar" />}
                      {c.isGroup && c.members.length > 1 && <span className="group-count">+{c.members.length}</span>}
                    </div>
                    <div className="grow ellipsis">
                      <div className="row gap-xs">
                        <b className="ellipsis">{c.title}</b>
                        {c.kind === 'booking' && <span className="tag"><Briefcase size={10} /> Booking</span>}
                        {c.kind === 'inquiry' && <span className="tag">Inquiry</span>}
                        {c.kind === 'group' && <span className="tag"><Users size={10} /> Group</span>}
                        {c.kind === 'event' && <span className="tag"><CalendarDays size={10} /> Event</span>}
                      </div>
                      <div className={`small ellipsis convo-preview ${c.unread ? 'unread' : 'muted'}`}>{preview(c)}</div>
                    </div>
                    <div className="convo-meta">
                      <div className="muted tiny">{ago(c.lastMessage?.at || c.lastMessageAt)}</div>
                      {c.unread && <span className="unread-dot" aria-label="Unread" />}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
