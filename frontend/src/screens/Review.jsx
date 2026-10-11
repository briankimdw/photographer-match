import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarX, EyeOff } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import Stars from '../components/Stars.jsx'
import { PersonAvatar } from '../components/ProfileLink.jsx'
import { EmptyState, ErrorState, Loading, SignInPrompt } from '../components/States.jsx'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { bookingError, getBooking, submitReview } from '../api/bookings.js'
import useQuery from '../lib/useQuery.js'
import { sessionNoun } from '../verticals/index.js'

export default function Review() {
  const { id } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { data: b, loading, error, reload } = useQuery(user ? () => getBooking(id) : null, [id, user?.id])

  if (authLoading) return <><TopBar title="Review" /><Loading /></>
  if (!user) return <><TopBar title="Review" /><SignInPrompt title="Sign in to leave a review" /></>
  if (loading && !b) return <><TopBar title="Review" /><Loading /></>
  if (error) return <><TopBar title="Review" /><ErrorState error={error} onRetry={reload} /></>
  if (!b) return <><TopBar title="Review" /><EmptyState icon={CalendarX} title="Booking not found" action={<Link to="/bookings" className="btn sm">Your bookings</Link>} /></>
  return <ReviewView b={b} reload={reload} />
}

function ReviewView({ b, reload }) {
  const { toast } = useStore()
  const isClient = b.role === 'client'
  const other = isClient ? b.provider : b.client
  const first = other.shortName || (other.name || '').split(' ')[0] || (isClient ? 'your vendor' : 'your client')
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const review = await submitReview(b.id, rating, text.trim())
      toast(review?.revealed_at ? 'Review posted. Both reviews are now visible.' : 'Review saved. It stays hidden until both of you review.')
      reload()
    } catch (err) {
      toast(bookingError(err))
      setBusy(false)
    }
  }

  const header = (
    <>
      <PersonAvatar id={other.id} src={other.avatar} name={other.name} username={other.username} className="avatar xl" />
      <div className="muted small">{b.packageName} · {b.date}</div>
    </>
  )

  // Already reviewed: show it, and theirs once revealed.
  if (b.myReview) {
    return (
      <div>
        <TopBar title="Reviews" />
        <div className="pad center-col">
          {header}
          <h2 className="h3">Your review of {first}</h2>
          <Stars value={b.myReview.rating} size={24} />
          {b.myReview.body && <p className="small">“{b.myReview.body}”</p>}
          {b.theirReview ? (
            <div className="review-reveal mt">
              <h3 className="section-title h4">{first}'s review of you</h3>
              <Stars value={b.theirReview.rating} size={20} />
              {b.theirReview.body && <p className="small">“{b.theirReview.body}”</p>}
            </div>
          ) : (
            <div className="note mt">
              <EyeOff size={16} />
              Your review is hidden until {first} reviews you too, or 14 days pass. Then both appear at once.
            </div>
          )}
          <Link to={`/bookings/${b.id}`} className="btn ghost block mt">Back to booking</Link>
        </div>
      </div>
    )
  }

  if (b.status !== 'completed' || !b.reviewWindowOpen) {
    return (
      <div>
        <TopBar title="Leave a review" />
        <EmptyState
          icon={EyeOff}
          title={b.status === 'completed' ? 'Reviews are closed' : `Reviews open after the ${sessionNoun(b.vertical)}`}
          text={b.status === 'completed' ? 'Reviews can be left for 14 days after a booking completes.' : 'You can review once the delivery is accepted and the booking is completed.'}
          action={<Link to={`/bookings/${b.id}`} className="btn sm">Back to booking</Link>}
        />
      </div>
    )
  }

  return (
    <div>
      <TopBar title="Leave a review" />
      <div className="pad center-col">
        <PersonAvatar id={other.id} src={other.avatar} name={other.name} username={other.username} className="avatar xl" />
        <h2 className="h3" id="review-q">{isClient ? `How was your ${sessionNoun(b.vertical)} with ${first}?` : `How was working with ${first}?`}</h2>
        <div className="muted small">{b.packageName} · {b.date}</div>
        <div className="mt">
          <Stars value={rating} size={36} onChange={setRating} label={`Your rating for ${first}, out of 5`} />
        </div>
        <label htmlFor="review-text" className="sr-only">Your review</label>
        <textarea
          id="review-text"
          className="input mt"
          rows={5}
          placeholder={isClient ? 'Share details about your experience' : 'How was this client to work with?'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="note mt">
          <EyeOff size={16} aria-hidden="true" />
          Reviews are double-blind. Neither of you sees the other's review until you've both posted, or 14 days pass.
        </div>
        <button className="btn accent block mt-lg" disabled={!rating || busy} onClick={submit}>{busy ? 'Posting…' : 'Submit review'}</button>
      </div>
    </div>
  )
}
