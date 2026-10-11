import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarX, CheckCircle2, Images, MessageCircle, Timer } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import { EmptyState, ErrorState, Loading, SignInPrompt } from '../components/States.jsx'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { acceptDelivery, bookingError, getBooking } from '../api/bookings.js'
import useQuery from '../lib/useQuery.js'
import { fmtBooking } from '../lib/dates.js'

// There's no in-app gallery storage for deliveries yet: photographers share
// their gallery link in the booking chat. This screen shows the real delivery
// status and lets the client accept it.
export default function Delivery() {
  const { id } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { data: b, loading, error, reload } = useQuery(user ? () => getBooking(id) : null, [id, user?.id])

  if (authLoading) return <><TopBar title="Delivery" /><Loading /></>
  if (!user) return <><TopBar title="Delivery" /><SignInPrompt title="Sign in to see this delivery" /></>
  if (loading && !b) return <><TopBar title="Delivery" /><Loading /></>
  if (error) return <><TopBar title="Delivery" /><ErrorState error={error} onRetry={reload} /></>
  if (!b) return <><TopBar title="Delivery" /><EmptyState icon={CalendarX} title="Booking not found" action={<Link to="/bookings" className="btn sm">Your bookings</Link>} /></>
  return <DeliveryView b={b} reload={reload} />
}

function DeliveryView({ b, reload }) {
  const navigate = useNavigate()
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const isClient = b.role === 'client'
  const other = isClient ? b.provider : b.client
  const first = other.shortName || (other.name || '').split(' ')[0] || (isClient ? 'Your vendor' : 'The client')
  const days = b.deliveryExpiresDays

  const accept = async () => {
    setBusy(true)
    try {
      await acceptDelivery(b.id)
      toast('Delivery accepted. You can leave a review now.')
      reload()
    } catch (err) {
      toast(bookingError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <TopBar title={isClient ? 'Your photos' : 'Delivery'} subtitle={`${b.packageName} · ${isClient ? `by ${b.provider.name}` : `for ${b.client.name}`}`} />
      <div className="pad-x">
        {b.status === 'delivered' && (
          <div className={`callout ${days != null && days <= 2 ? 'danger' : 'accent'}`}>
            <div className="inline-icon"><Timer size={15} /> <b>Delivered{b.deliveredAt ? ` ${fmtBooking(new Date(b.deliveredAt))}` : ''}</b></div>
            <div className="muted small">
              {isClient
                ? `Check your photos, then accept the delivery.${days != null ? ` It's accepted automatically in ${days} day${days === 1 ? '' : 's'}.` : ''}`
                : `Waiting for ${first} to accept.${days != null ? ` It's accepted automatically in ${days} day${days === 1 ? '' : 's'}.` : ''}`}
            </div>
            {isClient && (
              <button className="btn accent block mt-sm" disabled={busy} onClick={accept}>
                {busy ? 'Accepting…' : 'Accept delivery'}
              </button>
            )}
          </div>
        )}
        {b.status === 'completed' && (
          <div className="callout">
            <div className="inline-icon"><CheckCircle2 size={15} /> <b>Delivery accepted</b></div>
            {b.completedAt && <div className="muted small">Completed {fmtBooking(new Date(b.completedAt))}.</div>}
            {b.reviewWindowOpen && !b.myReview && (
              <Link to={`/bookings/${b.id}/review`} className="btn block mt-sm">Review {first}</Link>
            )}
          </div>
        )}
        {!['delivered', 'completed'].includes(b.status) && (
          <div className="callout">
            <b>Not delivered yet</b>
            <div className="muted small">
              {isClient ? `${first} will mark the booking delivered once your photos are ready.` : 'Mark the booking delivered from the booking page once the photos are shared.'}
            </div>
          </div>
        )}
      </div>

      <EmptyState
        icon={Images}
        title="Gallery link in chat"
        text={
          isClient
            ? `${first} shares your full gallery through a link in your booking chat. In-app galleries with downloads are coming soon.`
            : `Share the gallery link with ${first} in your booking chat. In-app gallery uploads are coming soon.`
        }
        action={
          b.conversationId && (
            <button className="btn sm" onClick={() => navigate(`/inbox/${b.conversationId}`)}>
              <MessageCircle size={14} /> Open chat with {first}
            </button>
          )
        }
      />
      <div className="pad-x">
        <Link to={`/bookings/${b.id}`} className="btn ghost block">Booking details</Link>
      </div>
    </div>
  )
}
