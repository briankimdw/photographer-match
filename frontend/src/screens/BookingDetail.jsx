import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Calendar, CalendarX, Clock, CreditCard, Lock, MapPin, MessageCircle, MessagesSquare, ShieldAlert } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import PersonRow from '../components/PersonRow.jsx'
import Sheet from '../components/Sheet.jsx'
import { PolicyTable, StatusPill, StatusTimeline, money } from '../components/Booking.jsx'
import { EmptyState, ErrorState, Loading, SignInPrompt } from '../components/States.jsx'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import {
  acceptDelivery,
  bookingError,
  cancelBooking,
  getBooking,
  markDelivered,
  respondToBooking,
  respondToOffer,
} from '../api/bookings.js'
import { vendorChatForBooking } from '../api/messages.js'
import useQuery from '../lib/useQuery.js'
import { deliversMedia, nounFor, quantityFor, sessionNoun } from '../verticals/index.js'
import { today } from '../lib/dates.js'

const capitalize = (s) => s[0].toUpperCase() + s.slice(1)

const CANCELLABLE = ['requested', 'countered', 'accepted', 'confirmed']

// Refund % the client would get by cancelling now (mirrors cancel_booking in the database).
const refundPct = (b) => {
  if (b.status !== 'confirmed') return null // nothing paid before confirmation
  if (b.role === 'provider') return 100
  const days = Math.floor((b.start - Date.now()) / 86400000)
  const rule = (b.policy?.rules || []).find((r) => days >= r.min_days_before)
  return rule?.refund_pct ?? 0
}

export default function BookingDetail() {
  const { id } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { data: b, loading, error, reload } = useQuery(user ? () => getBooking(id) : null, [id, user?.id])

  if (authLoading) return <><TopBar title="Booking" /><Loading /></>
  if (!user) return <><TopBar title="Booking" /><SignInPrompt title="Sign in to see this booking" /></>
  if (loading && !b) return <><TopBar title="Booking" /><Loading /></>
  if (error) return <><TopBar title="Booking" /><ErrorState error={error} onRetry={reload} /></>
  if (!b) return <><TopBar title="Booking" /><EmptyState icon={CalendarX} title="Booking not found" text="It may have been removed, or it belongs to another account." action={<Link to="/bookings" className="btn sm">Your bookings</Link>} /></>
  return <Detail b={b} reload={reload} />
}

function Detail({ b, reload }) {
  const navigate = useNavigate()
  const { toast, myProvider } = useStore()
  const isClient = b.role === 'client'
  const other = isClient ? b.provider : { ...b.client, idVerified: false, pro: false }
  const first = (other.name || (isClient ? `The ${nounFor(b.vertical)}` : 'The client')).split(' ')[0]
  const [sheet, setSheet] = useState(null) // cancel | counter
  const [busy, setBusy] = useState(false)
  const [counterTotal, setCounterTotal] = useState('')
  const [counterMsg, setCounterMsg] = useState('')
  // The vendor chat of the booking's event, when there is one and I'm in it (null for bookings without an event).
  const { data: vendorChatId } = useQuery(() => vendorChatForBooking(b.id), [b.id, b.status])

  // Run a booking action, then reload the booking and report the result.
  const act = async (fn, success) => {
    setBusy(true)
    try {
      const result = await fn()
      setSheet(null)
      toast(typeof success === 'function' ? success(result) : success)
      reload()
    } catch (err) {
      toast(bookingError(err))
    } finally {
      setBusy(false)
    }
  }

  const refund = refundPct(b)
  const cancel = () =>
    act(
      () => cancelBooking(b.id),
      (r) => (b.status === 'confirmed' ? `Booking cancelled. Refund under the policy: ${r?.refund_pct ?? 0}% of the deposit.` : b.status === 'requested' ? 'Request cancelled.' : 'Booking cancelled.'),
    )
  const sendCounter = () => {
    const total = Number(counterTotal)
    if (!(total > 0)) return toast('Enter a price for the offer')
    act(() => respondToBooking(b.id, 'counter', { total, message: counterMsg.trim() || null }), `Offer of ${money(total)} sent to ${first}.`)
  }

  const shootDayReached = b.day <= today()
  const items = [b.subtotal, b.addonsTotal ?? 0, b.travelFee ?? 0]
  const itemsSum = b.subtotal == null ? null : items.reduce((s, x) => s + (x || 0), 0)
  const adjustment = b.total != null && itemsSum != null ? Math.round((b.total - itemsSum) * 100) / 100 : 0

  return (
    <div>
      <TopBar title="Booking" subtitle={`#${b.id.slice(0, 8).toUpperCase()}`} />
      <PersonRow person={other} sub={isClient ? b.packageName : `Client · ${b.packageName}`} right={<StatusPill status={b.status} />} />

      <div className="pad">
        <div className="info-card">
          <div className="inline-icon"><Calendar size={15} /> {b.date} · {b.time}{b.hours ? ` · ${b.hours}h` : ''}</div>
          <div className="inline-icon mt-xs"><MapPin size={15} /> {b.location || 'Location to be confirmed'}</div>
          {b.note && <div className="small mt-xs bk-note">“{b.note}”</div>}
        </div>

        {/* Status-specific call to action */}
        {isClient ? (
          <ClientCallout b={b} first={first} busy={busy} act={act} />
        ) : (
          <ProviderCallout b={b} first={first} busy={busy} act={act} verified={!!myProvider?.identity_verified} shootDayReached={shootDayReached} openCounter={() => setSheet('counter')} />
        )}

        <h4 className="section-title">Status</h4>
        <StatusTimeline booking={b} />

        <h4 className="section-title">Price</h4>
        <div className="summary">
          {b.total == null && b.subtotal == null ? (
            <div className="muted small">{b.offer ? `Offer on the table: ${money(b.offer.total)}` : 'Waiting for a custom quote.'}</div>
          ) : (
            <>
              {b.subtotal != null && (
                <div className="row between">
                  <span>
                    {b.packageName}
                    {b.pkg?.priceType === 'hourly' ? ` (${b.hours}h)` : b.quantity ? ` (${b.quantity} ${(quantityFor(b.pkg, b.vertical)?.label || 'guests').toLowerCase()})` : ''}
                  </span>
                  <span>{money(b.subtotal)}</span>
                </div>
              )}
              {b.addons.map((a) => (
                <div key={a.name} className="row between"><span>{a.name}</span><span>{money(a.price)}</span></div>
              ))}
              {b.travelFee > 0 && <div className="row between"><span>Travel fee</span><span>{money(b.travelFee)}</span></div>}
              {adjustment !== 0 && (
                <div className="row between"><span>Agreed price change</span><span>{adjustment > 0 ? '+' : '−'}{money(Math.abs(adjustment))}</span></div>
              )}
              <div className="row between total"><span>Total</span><span>{money(b.total)}</span></div>
              {b.offer && <div className="row between small"><span>Counter offer</span><span>{money(b.offer.total)}</span></div>}
              {b.deposit != null && (
                <div className="row between small">
                  <span>Deposit{b.pkg?.depositPct != null ? ` (${b.pkg.depositPct}%)` : ''}</span>
                  <span>{b.depositPaid ? `${money(b.deposit)} · paid` : money(b.deposit)}</span>
                </div>
              )}
              {!b.depositPaid && b.isActive && (
                <div className="muted tiny mt-xs">In-app payments are coming soon. Nothing has been charged.</div>
              )}
            </>
          )}
        </div>

        <div className="mt">
          <PolicyTable policy={b.policy} />
        </div>

        <div className="row gap-xs mt">
          {b.conversationId && (
            <button className="btn ghost grow" onClick={() => navigate(`/inbox/${b.conversationId}`)}><MessageCircle size={16} /> Message {first}</button>
          )}
          {vendorChatId && (
            <button className="btn ghost grow" onClick={() => navigate(`/inbox/${vendorChatId}`)}><MessagesSquare size={16} /> Vendor chat</button>
          )}
          {CANCELLABLE.includes(b.status) && (
            <button className="btn ghost grow danger" onClick={() => setSheet('cancel')}>{b.status === 'requested' && isClient ? 'Cancel request' : 'Cancel'}</button>
          )}
        </div>
      </div>

      <Sheet open={sheet === 'cancel'} onClose={() => setSheet(null)} title={b.status === 'requested' && isClient ? 'Cancel request?' : 'Cancel booking?'}>
        <PolicyTable policy={b.policy} />
        <div className="summary mt">
          {refund == null ? (
            <div className="small">Nothing has been paid yet, so there's nothing to refund.</div>
          ) : isClient ? (
            <div className="row between total"><span>Refund under the policy</span><span>{refund}%</span></div>
          ) : (
            <div className="small">If you cancel, {first} gets a full refund. Frequent cancellations hurt your ranking.</div>
          )}
        </div>
        <button className="btn danger-solid block mt" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
        <button className="btn ghost block mt-sm" onClick={() => setSheet(null)}>Keep booking</button>
      </Sheet>

      <Sheet open={sheet === 'counter'} onClose={() => setSheet(null)} title="Offer a different price">
        <p className="muted small">{first} has 48 hours to accept or decline. {b.total != null ? `They asked for ${money(b.total)}.` : 'This is a quote request.'}</p>
        <div className="money-input mt">
          <span>$</span>
          <input type="number" inputMode="decimal" min="1" placeholder="Total price" value={counterTotal} onChange={(e) => setCounterTotal(e.target.value)} />
        </div>
        <textarea className="input mt-sm" rows={3} placeholder="Explain the price (optional)" value={counterMsg} onChange={(e) => setCounterMsg(e.target.value)} />
        <button className="btn accent block mt" disabled={busy || !(Number(counterTotal) > 0)} onClick={sendCounter}>
          {busy ? 'Sending…' : counterTotal ? `Send offer · ${money(Number(counterTotal))}` : 'Send offer'}
        </button>
      </Sheet>
    </div>
  )
}

function ClientCallout({ b, first, busy, act }) {
  switch (b.status) {
    case 'requested':
      return (
        <div className="callout">
          <b>Waiting for {first} to respond</b>
          <div className="muted small">{b.expiresIn ? `The request expires in ${b.expiresIn}.` : 'The request expires 48 hours after it was sent.'} Your date is held until then.</div>
        </div>
      )
    case 'countered':
      return (
        <div className="callout">
          <b>{first} offered a different price: {money(b.offer?.total ?? b.counterTotal)}</b>
          {b.offer?.message && <div className="small">“{b.offer.message}”</div>}
          {b.expiresIn && <div className="muted small">The offer expires in {b.expiresIn}.</div>}
          {b.offer ? (
            <div className="row gap-xs mt-sm">
              <button className="btn sm" disabled={busy} onClick={() => act(() => respondToOffer(b.offer.id, true), `Offer accepted. ${first} is holding your date.`)}>Accept offer</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => act(() => respondToOffer(b.offer.id, false), 'Offer declined.')}>Decline</button>
            </div>
          ) : (
            <div className="muted small">This offer is no longer open.</div>
          )}
        </div>
      )
    case 'accepted':
      return (
        <div className="callout accent">
          <b>{first} accepted!</b>
          <div className="muted small">
            A {money(b.deposit)} deposit confirms the booking. In-app payments are coming soon; nothing has been charged. Message {first} to sort out the details.
          </div>
          <button className="btn accent block mt-sm" disabled>
            <CreditCard size={16} /> Pay deposit · coming soon
          </button>
        </div>
      )
    case 'confirmed':
      return (
        <div className="callout">
          <b className="inline-icon"><Lock size={14} /> You're booked</b>
          <div className="muted small">{first}'s calendar is locked for this date.</div>
        </div>
      )
    case 'in_progress':
      return deliversMedia(b.vertical) ? (
        <div className="callout"><b>Shoot day!</b><div className="muted small">{first} will mark the booking delivered once your {b.vertical === 'videography' ? 'video is' : 'photos are'} ready.</div></div>
      ) : (
        <div className="callout"><b>It’s {sessionNoun(b.vertical)} day!</b><div className="muted small">{first} will mark the booking done afterwards, and you’ll be asked to confirm.</div></div>
      )
    case 'delivered': {
      const media = deliversMedia(b.vertical)
      return (
        <div className="callout accent">
          <b>{media ? `Your ${b.vertical === 'videography' ? 'video is' : 'photos are'} ready` : `${first} marked this done`}</b>
          <div className="muted small">
            {media ? 'Accept the delivery once you have everything.' : 'Confirm everything went as planned.'}
            {b.deliveryExpiresDays != null && ` It's accepted automatically in ${b.deliveryExpiresDays} day${b.deliveryExpiresDays === 1 ? '' : 's'}.`}
          </div>
          {media && <Link to={`/bookings/${b.id}/delivery`} className="btn accent block mt-sm">View delivery</Link>}
          <div className="row gap-xs mt-sm">
            <button className={`btn sm grow ${media ? 'ghost' : 'accent'}`} disabled={busy} onClick={() => act(() => acceptDelivery(b.id), media ? 'Delivery accepted. You can leave a review now.' : 'Confirmed. You can leave a review now.')}>
              {media ? 'Accept delivery' : 'Confirm it’s done'}
            </button>
            <button className="btn ghost sm grow danger" disabled title="Disputes aren't available yet">
              <ShieldAlert size={14} /> Report a problem · soon
            </button>
          </div>
        </div>
      )
    }
    case 'completed':
      return <CompletedCallout b={b} first={first} />
    case 'disputed':
      return (
        <div className="callout danger">
          <b>Dispute open</b>
          <div className="muted small">Our team is reviewing this booking.</div>
        </div>
      )
    case 'declined':
      return <div className="callout"><b>This request was declined</b><div className="muted small">Try another date or {nounFor(b.vertical)}.</div></div>
    case 'expired':
      return <div className="callout"><b>This request expired</b><div className="muted small">{first} didn't respond in time.</div></div>
    case 'cancelled_by_client':
      return <div className="callout"><b>You cancelled this booking</b></div>
    case 'cancelled_by_provider':
      return <div className="callout"><b>{first} cancelled this booking</b><div className="muted small">Any deposit paid is refunded in full.</div></div>
    case 'refunded':
      return <div className="callout"><b>Refunded</b></div>
    default:
      return null
  }
}

function ProviderCallout({ b, first, busy, act, verified, shootDayReached, openCounter }) {
  switch (b.status) {
    case 'requested':
      return (
        <div className="callout accent">
          <b>New request from {first}</b>
          <div className="muted small">
            {b.total == null ? 'This is a quote request: send a price.' : `They asked for ${money(b.total)}.`}
            {b.expiresIn && ` Respond within ${b.expiresIn}.`}
          </div>
          {!verified && b.total != null && <div className="muted small">You need a verified ID to accept paid bookings.</div>}
          <div className="row gap-xs mt-sm wrap">
            {b.total != null && (
              <button className="btn sm" disabled={busy} onClick={() => act(() => respondToBooking(b.id, 'accept'), `Accepted. ${first} will be asked to pay the deposit.`)}>
                Accept
              </button>
            )}
            <button className="btn ghost sm" disabled={busy} onClick={openCounter}>{b.total == null ? 'Send a price' : 'Offer another price'}</button>
            <button className="btn ghost sm danger" disabled={busy} onClick={() => act(() => respondToBooking(b.id, 'decline'), 'Request declined.')}>Decline</button>
          </div>
        </div>
      )
    case 'countered':
      return (
        <div className="callout">
          <b>You offered {money(b.offer?.total ?? b.counterTotal)}</b>
          {b.offer?.message && <div className="small">“{b.offer.message}”</div>}
          <div className="muted small">Waiting for {first} to accept or decline{b.expiresIn ? ` (expires in ${b.expiresIn})` : ''}.</div>
        </div>
      )
    case 'accepted':
      return (
        <div className="callout">
          <b>Waiting for {first}'s deposit</b>
          <div className="muted small">In-app payments are coming soon, so deposits can't be paid here yet. Nothing has been charged.</div>
        </div>
      )
    case 'confirmed':
    case 'in_progress':
      return (
        <div className="callout">
          <b className="inline-icon">{b.status === 'confirmed' ? <><Lock size={14} /> Booked</> : <><Clock size={14} /> {capitalize(sessionNoun(b.vertical))} in progress</>}</b>
          <div className="muted small">
            {shootDayReached || b.status === 'in_progress'
              ? deliversMedia(b.vertical)
                ? `Share the gallery with ${first} in chat, then mark the booking delivered.`
                : `Once the ${sessionNoun(b.vertical)} is done, mark the booking done. ${first} confirms it.`
              : `Your calendar is locked for this date.`}
          </div>
          {(shootDayReached || b.status === 'in_progress') && (
            <button className="btn accent block mt-sm" disabled={busy} onClick={() => act(() => markDelivered(b.id), `Marked ${deliversMedia(b.vertical) ? 'delivered' : 'done'}. ${first} has 7 days to confirm.`)}>
              {deliversMedia(b.vertical) ? 'Mark as delivered' : 'Mark as done'}
            </button>
          )}
        </div>
      )
    case 'delivered':
      return (
        <div className="callout">
          <b>{deliversMedia(b.vertical) ? 'Delivered' : 'Marked done'}</b>
          <div className="muted small">
            Waiting for {first} to accept.
            {b.deliveryExpiresDays != null && ` It's accepted automatically in ${b.deliveryExpiresDays} day${b.deliveryExpiresDays === 1 ? '' : 's'}.`}
          </div>
        </div>
      )
    case 'completed':
      return <CompletedCallout b={b} first={first} />
    case 'disputed':
      return <div className="callout danger"><b>Dispute open</b><div className="muted small">Our team is reviewing this booking.</div></div>
    case 'declined':
      return <div className="callout"><b>Declined</b></div>
    case 'expired':
      return <div className="callout"><b>This request expired</b><div className="muted small">It wasn't answered within 48 hours.</div></div>
    case 'cancelled_by_client':
      return <div className="callout"><b>{first} cancelled this booking</b></div>
    case 'cancelled_by_provider':
      return <div className="callout"><b>You cancelled this booking</b></div>
    default:
      return null
  }
}

function CompletedCallout({ b, first }) {
  return (
    <div className="callout">
      <b>Completed</b>
      {b.myReview ? (
        <div className="small mt-xs">
          {b.theirReview ? 'Both reviews are now visible.' : `Your review stays hidden until ${first} reviews you or 14 days pass.`}{' '}
          <Link to={`/bookings/${b.id}/review`} className="link-btn small">See reviews</Link>
        </div>
      ) : b.reviewWindowOpen ? (
        <Link to={`/bookings/${b.id}/review`} className="btn block mt-sm">Review {first}</Link>
      ) : (
        <div className="muted small">The review window has closed.</div>
      )}
    </div>
  )
}
