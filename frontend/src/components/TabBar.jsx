import { NavLink, useLocation } from 'react-router-dom'
import { Home, Layers, CalendarCheck, MessageCircle, User } from 'lucide-react'
import { useAuth } from '../auth.jsx'
import useQuery from '../lib/useQuery.js'
import { useEffect } from 'react'
import { subscribeToInbox, unreadCount } from '../api/messages.js'

const tabs = [
  { to: '/', label: 'Home', Icon: Home },
  { to: '/discover', label: 'Discover', Icon: Layers },
  { to: '/bookings', label: 'Bookings', Icon: CalendarCheck },
  { to: '/inbox', label: 'Inbox', Icon: MessageCircle },
  { to: '/me', label: 'Me', Icon: User },
]

export default function TabBar() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  // Re-checked when the tab bar mounts (e.g. back from a chat) and on tab switches.
  const { data: unread, reload } = useQuery(user ? unreadCount : null, [user?.id, pathname])
  // ...and live, when a message arrives anywhere.
  useEffect(() => (user ? subscribeToInbox(reload) : undefined), [user?.id, reload])

  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} end className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          <span className="tab-icon">
            <Icon size={22} aria-hidden="true" />
            {to === '/inbox' && unread > 0 && <span className="tab-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
          </span>
          <span>{label}</span>
          {to === '/inbox' && unread > 0 && <span className="sr-only">, {unread} unread</span>}
        </NavLink>
      ))}
    </nav>
  )
}
