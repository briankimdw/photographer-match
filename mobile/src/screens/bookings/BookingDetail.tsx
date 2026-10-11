// One booking: native version of frontend/src/screens/BookingDetail.jsx.
// Who / when / where, the status-specific call to action (client or vendor side:
// respond to a request, counter offer, accept an offer, pay-deposit placeholder, mark
// delivered / done, accept delivery), the status timeline, price and cancellation.
// Wording follows the vertical: photo / video vendors "deliver", everyone else "marks it done".
import {
  acceptDelivery, bookingError, cancelBooking, getBooking, markDelivered, respondToBooking, respondToOffer,
} from '@shared/api/bookings.js'
import { today } from '@shared/lib/dates.js'
import { callName, money } from '@shared/lib/format.js'
import { deliversMedia, nounFor, quantityFor, sessionNoun } from '@shared/verticals/index.js'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Calendar, CalendarX, Clock, CreditCard, Lock, MapPin, MessageCircle, ShieldAlert } from 'lucide-react-native'
import { useState } from 'react'
import { TextInput, View } from 'react-native'

import { Button, EmptyState, ErrorState, Loading, Screen, Sheet, SignInPrompt, Text, TextField } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'
import type { Booking } from './NeedsAction'
import { Callout, PersonRow, PolicyTable, Row, StatusPill, StatusTimeline, Summary, TotalRow, useRefocus } from './parts'

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)
const CANCELLABLE = ['requested', 'countered', 'accepted', 'confirmed']

// Refund % the client would get by cancelling now (mirrors cancel_booking in the database).
const refundPct = (b: Booking) => {
  if (b.status !== 'confirmed') return null
  if (b.role === 'provider') return 100
  const days = Math.floor((+b.start - Date.now()) / 86400000)
  const rule = ((b.policy?.rules || []) as { min_days_before: number; refund_pct: number }[]).find((r) => days >= r.min_days_before)
  return rule?.refund_pct ?? 0
}

type Act = (fn: () => Promise<unknown>, success: string | ((r: any) => string)) => Promise<void>

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, loading: authLoading } = useAuth()
  const q = useQuery<Booking | null>(user ? () => getBooking(id) : null, [id, user?.id])
  useRefocus(q.reload)
  const router = useRouter()
  const b = q.data

  if (authLoading || (q.loading && !b)) return <Screen title="Booking" back><Loading /></Screen>
  if (!user) return <Screen title="Booking" back><SignInPrompt title="Sign in to see this booking" /></Screen>
  if (q.error) return <Screen title="Booking" back><ErrorState error={q.error} onRetry={q.reload} /></Screen>
  if (!b) {
    return (
      <Screen title="Booking" back>
        <EmptyState
          icon={CalendarX}
          title="Booking not found"
          text="It may have been removed, or it belongs to another account."
          action={<Button title="Your bookings" size="sm" onPress={() => router.replace('/bookings')} />}
        />
      </Screen>
    )
  }
  return <Detail b={b} reload={q.reload} />
}

function Detail({ b, reload }: { b: Booking; reload: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { toast, myProvider } = useStore()
  const isClient = b.role === 'client'
  const other = isClient ? b.provider : { ...b.client, idVerified: false, pro: false }
  const first = (other as any).shortName || (other.name ? callName(other.name) : isClient ? `The ${nounFor(b.vertical)}` : 'The client')
  const [sheet, setSheet] = useState<'cancel' | 'counter' | null>(null)
  const [busy, setBusy] = useState(false)
  const [counterTotal, setCounterTotal] = useState('')
  const [counterMsg, setCounterMsg] = useState('')

  // Run a booking action, then reload the booking and report the result.
  const act: Act = async (fn, success) => {
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
  const counterNum = Number(counterTotal.replace(/[^\d.]/g, ''))
  const sendCounter = () => {
    if (!(counterNum > 0)) return toast('Enter a price for the offer')
    act(() => respondToBooking(b.id, 'counter', { total: counterNum, message: counterMsg.trim() || null } as any), `Offer of ${money(counterNum)} sent to ${first}.`)
  }

  const shootDayReached = b.day <= today()
  const itemsSum = b.subtotal == null ? null : [b.subtotal, b.addonsTotal ?? 0, b.travelFee ?? 0].reduce((sum, x) => sum + (x || 0), 0)
  const adjustment = b.total != null && itemsSum != null ? Math.round((b.total - itemsSum) * 100) / 100 : 0
  const qtyLabel = (quantityFor(b.pkg, b.vertical)?.label || 'guests').toLowerCase()
  const cancelTitle = b.status === 'requested' && isClient ? 'Cancel request' : 'Cancel'

  return (
    <Screen title="Booking" subtitle={`#${b.id.slice(0, 8).toUpperCase()}`} back>
      <PersonRow person={other} sub={isClient ? b.packageName : `Client · ${b.packageName}`} right={<StatusPill status={b.status} />} />

      <View style={s.pad}>
        <View style={s.info}>
          <View style={s.inline}>
            <Calendar size={15} color={c.ink} />
            <Text variant="small" style={s.shrink}>{b.date} · {b.time}{b.hours ? ` · ${b.hours}h` : ''}</Text>
          </View>
          <View style={[s.inline, s.mtXs]}>
            <MapPin size={15} color={c.ink} />
            <Text variant="small" style={s.shrink}>{b.location || 'Location to be confirmed'}</Text>
          </View>
          {!!b.note && <Text variant="small" muted style={s.mtXs}>“{b.note}”</Text>}
        </View>

        {isClient ? (
          <ClientCallout b={b} first={first} busy={busy} act={act} />
        ) : (
          <ProviderCallout b={b} first={first} busy={busy} act={act} verified={!!myProvider?.identity_verified} shootDayReached={shootDayReached} openCounter={() => setSheet('counter')} />
        )}

        <Text variant="h4" style={s.sectionTitle}>Status</Text>
        <StatusTimeline booking={b} />

        <Text variant="h4" style={s.sectionTitle}>Price</Text>
        <Summary>
          {b.total == null && b.subtotal == null ? (
            <Text variant="small" muted>{b.offer ? `Offer on the table: ${money(b.offer.total)}` : 'Waiting for a custom quote.'}</Text>
          ) : (
            <>
              {b.subtotal != null && (
                <Row
                  label={`${b.packageName}${b.pkg?.priceType === 'hourly' ? ` (${b.hours}h)` : b.quantity ? ` (${b.quantity} ${qtyLabel})` : ''}`}
                  value={money(b.subtotal)}
                />
              )}
              {(b.addons as { name: string; price: number | null }[]).map((a) => <Row key={a.name} label={a.name} value={money(a.price)} />)}
              {b.travelFee > 0 && <Row label="Travel fee" value={money(b.travelFee)} />}
              {adjustment !== 0 && <Row label="Agreed price change" value={`${adjustment > 0 ? '+' : '−'}${money(Math.abs(adjustment))}`} />}
              <TotalRow label="Total" value={money(b.total)} />
              {b.offer && <Row label="Counter offer" value={money(b.offer.total)} />}
              {b.deposit != null && (
                <Row
                  label={`Deposit${b.pkg?.depositPct != null ? ` (${b.pkg.depositPct}%)` : ''}`}
                  value={b.depositPaid ? `${money(b.deposit)} · paid` : money(b.deposit)}
                />
              )}
              {!b.depositPaid && b.isActive && (
                <Text variant="tiny" muted style={s.mtXs}>In-app payments are coming soon. Nothing has been charged.</Text>
              )}
            </>
          )}
        </Summary>

        <View style={s.mt}>
          <PolicyTable policy={b.policy} />
        </View>

        <View style={[s.actions, s.mt]}>
          {!!b.conversationId && (
            <Button title={`Message ${first}`} icon={MessageCircle} variant="ghost" grow onPress={() => router.push({ pathname: '/inbox/[id]', params: { id: b.conversationId! } })} />
          )}
          {CANCELLABLE.includes(b.status) && <Button title={cancelTitle} variant="danger" grow onPress={() => setSheet('cancel')} />}
        </View>
      </View>

      <Sheet open={sheet === 'cancel'} onClose={() => setSheet(null)} title={b.status === 'requested' && isClient ? 'Cancel request?' : 'Cancel booking?'}>
        <PolicyTable policy={b.policy} />
        <Summary style={s.mt}>
          {refund == null ? (
            <Text variant="small">Nothing has been paid yet, so there’s nothing to refund.</Text>
          ) : isClient ? (
            <Row label="Refund under the policy" value={`${refund}%`} bold />
          ) : (
            <Text variant="small">If you cancel, {first} gets a full refund. Frequent cancellations hurt your ranking.</Text>
          )}
        </Summary>
        <Button title={busy ? 'Cancelling…' : 'Cancel booking'} block disabled={busy} onPress={cancel} style={[s.mt, { backgroundColor: c.danger }]} />
        <Button title="Keep booking" variant="ghost" block onPress={() => setSheet(null)} style={s.mtSm} />
      </Sheet>

      <Sheet open={sheet === 'counter'} onClose={() => setSheet(null)} title="Offer a different price">
        <Text variant="small" muted>
          {first} has 48 hours to accept or decline. {b.total != null ? `They asked for ${money(b.total)}.` : 'This is a quote request.'}
        </Text>
        <View style={[s.moneyInput, s.mt]}>
          <Text style={s.moneyText}>$</Text>
          <TextInput
            value={counterTotal}
            onChangeText={setCounterTotal}
            keyboardType="decimal-pad"
            placeholder="Total price"
            placeholderTextColor={c.faint}
            style={[s.moneyText, s.grow]}
            accessibilityLabel="Total price"
          />
        </View>
        <TextField
          value={counterMsg}
          onChangeText={setCounterMsg}
          placeholder="Explain the price (optional)"
          multiline
          style={s.textarea}
          containerStyle={s.mtSm}
        />
        <Button
          title={busy ? 'Sending…' : counterNum > 0 ? `Send offer · ${money(counterNum)}` : 'Send offer'}
          variant="accent"
          block
          disabled={busy || !(counterNum > 0)}
          onPress={sendCounter}
          style={s.mt}
        />
      </Sheet>
    </Screen>
  )
}

type CalloutProps = { b: Booking; first: string; busy: boolean; act: Act }

function ClientCallout({ b, first, busy, act }: CalloutProps) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  switch (b.status) {
    case 'requested':
      return (
        <Callout
          title={`Waiting for ${first} to respond`}
          text={`${b.expiresIn ? `The request expires in ${b.expiresIn}.` : 'The request expires 48 hours after it was sent.'} Your date is held until then.`}
        />
      )
    case 'countered':
      return (
        <Callout title={`${first} offered a different price: ${money(b.offer?.total ?? b.counterTotal)}`}>
          {!!b.offer?.message && <Text variant="small">“{b.offer.message}”</Text>}
          {!!b.expiresIn && <Text variant="small" muted>The offer expires in {b.expiresIn}.</Text>}
          {b.offer ? (
            <View style={[s.actions, s.mtSm]}>
              <Button title="Accept offer" size="sm" disabled={busy} onPress={() => act(() => respondToOffer(b.offer!.id, true), `Offer accepted. ${first} is holding your date.`)} />
              <Button title="Decline" size="sm" variant="ghost" disabled={busy} onPress={() => act(() => respondToOffer(b.offer!.id, false), 'Offer declined.')} />
            </View>
          ) : (
            <Text variant="small" muted>This offer is no longer open.</Text>
          )}
        </Callout>
      )
    case 'accepted':
      return (
        <Callout
          tone="accent"
          title={`${first} accepted!`}
          text={`A ${money(b.deposit)} deposit confirms the booking. In-app payments are coming soon; nothing has been charged. Message ${first} to sort out the details.`}
        >
          <Button title="Pay deposit · coming soon" icon={CreditCard} variant="accent" block disabled style={s.mtSm} />
        </Callout>
      )
    case 'confirmed':
      return (
        <Callout
          title={<View style={s.inline}><Lock size={14} color={c.ink} /><Text variant="body" weight="700">You’re booked</Text></View>}
          text={`${first}’s calendar is locked for this date.`}
        />
      )
    case 'in_progress':
      return deliversMedia(b.vertical) ? (
        <Callout title="Shoot day!" text={`${first} will mark the booking delivered once your ${b.vertical === 'videography' ? 'video is' : 'photos are'} ready.`} />
      ) : (
        <Callout title={`It’s ${sessionNoun(b.vertical)} day!`} text={`${first} will mark the booking done afterwards, and you’ll be asked to confirm.`} />
      )
    case 'delivered': {
      const media = deliversMedia(b.vertical)
      const days = b.deliveryExpiresDays
      return (
        <Callout
          tone="accent"
          title={media ? `Your ${b.vertical === 'videography' ? 'video is' : 'photos are'} ready` : `${first} marked this done`}
          text={`${media ? 'Accept the delivery once you have everything.' : 'Confirm everything went as planned.'}${days != null ? ` It’s accepted automatically in ${days} day${days === 1 ? '' : 's'}.` : ''}`}
        >
          {media && (
            <Button title="View delivery" variant="accent" block style={s.mtSm} onPress={() => router.push({ pathname: '/bookings/[id]/delivery', params: { id: b.id } })} />
          )}
          <Button
            title={media ? 'Accept delivery' : 'Confirm it’s done'}
            block
            variant={media ? 'ghost' : 'accent'}
            disabled={busy}
            style={s.mtSm}
            onPress={() => act(() => acceptDelivery(b.id), media ? 'Delivery accepted. You can leave a review now.' : 'Confirmed. You can leave a review now.')}
          />
          <Button title="Report a problem · coming soon" icon={ShieldAlert} size="sm" block variant="link" disabled style={s.mtXs} accessibilityLabel="Report a problem: disputes aren't available yet" />
        </Callout>
      )
    }
    case 'completed':
      return <CompletedCallout b={b} first={first} />
    case 'disputed':
      return <Callout tone="danger" title="Dispute open" text="Our team is reviewing this booking." />
    case 'declined':
      return <Callout title="This request was declined" text={`Try another date or ${nounFor(b.vertical)}.`} />
    case 'expired':
      return <Callout title="This request expired" text={`${first} didn’t respond in time.`} />
    case 'cancelled_by_client':
      return <Callout title="You cancelled this booking" />
    case 'cancelled_by_provider':
      return <Callout title={`${first} cancelled this booking`} text="Any deposit paid is refunded in full." />
    case 'refunded':
      return <Callout title="Refunded" />
    default:
      return null
  }
}

function ProviderCallout({ b, first, busy, act, verified, shootDayReached, openCounter }: CalloutProps & { verified: boolean; shootDayReached: boolean; openCounter: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const media = deliversMedia(b.vertical)
  const noun = sessionNoun(b.vertical)
  switch (b.status) {
    case 'requested':
      return (
        <Callout
          tone="accent"
          title={`New request from ${first}`}
          text={`${b.total == null ? 'This is a quote request: send a price.' : `They asked for ${money(b.total)}.`}${b.expiresIn ? ` Respond within ${b.expiresIn}.` : ''}`}
        >
          {!verified && b.total != null && <Text variant="small" muted>You need a verified ID to accept paid bookings.</Text>}
          <View style={[s.actions, s.wrap, s.mtSm]}>
            {b.total != null && (
              <Button title="Accept" size="sm" disabled={busy} onPress={() => act(() => respondToBooking(b.id, 'accept'), `Accepted. ${first} will be asked to pay the deposit.`)} />
            )}
            <Button title={b.total == null ? 'Send a price' : 'Offer another price'} size="sm" variant="ghost" disabled={busy} onPress={openCounter} />
            <Button title="Decline" size="sm" variant="danger" disabled={busy} onPress={() => act(() => respondToBooking(b.id, 'decline'), 'Request declined.')} />
          </View>
        </Callout>
      )
    case 'countered':
      return (
        <Callout title={`You offered ${money(b.offer?.total ?? b.counterTotal)}`}>
          {!!b.offer?.message && <Text variant="small">“{b.offer.message}”</Text>}
          <Text variant="small" muted>Waiting for {first} to accept or decline{b.expiresIn ? ` (expires in ${b.expiresIn})` : ''}.</Text>
        </Callout>
      )
    case 'accepted':
      return <Callout title={`Waiting for ${first}’s deposit`} text="In-app payments are coming soon, so deposits can’t be paid here yet. Nothing has been charged." />
    case 'confirmed':
    case 'in_progress': {
      const ready = shootDayReached || b.status === 'in_progress'
      return (
        <Callout
          title={
            <View style={s.inline}>
              {b.status === 'confirmed' ? <Lock size={14} color={c.ink} /> : <Clock size={14} color={c.ink} />}
              <Text variant="body" weight="700">{b.status === 'confirmed' ? 'Booked' : `${capitalize(noun)} in progress`}</Text>
            </View>
          }
          text={
            ready
              ? media
                ? `Share the gallery with ${first} in chat, then mark the booking delivered.`
                : `Once the ${noun} is done, mark the booking done. ${first} confirms it.`
              : 'Your calendar is locked for this date.'
          }
        >
          {ready && (
            <Button
              title={media ? 'Mark as delivered' : 'Mark as done'}
              variant="accent"
              block
              disabled={busy}
              style={s.mtSm}
              onPress={() => act(() => markDelivered(b.id), `Marked ${media ? 'delivered' : 'done'}. ${first} has 7 days to confirm.`)}
            />
          )}
        </Callout>
      )
    }
    case 'delivered': {
      const days = b.deliveryExpiresDays
      return (
        <Callout
          title={media ? 'Delivered' : 'Marked done'}
          text={`Waiting for ${first} to accept.${days != null ? ` It’s accepted automatically in ${days} day${days === 1 ? '' : 's'}.` : ''}`}
        />
      )
    }
    case 'completed':
      return <CompletedCallout b={b} first={first} />
    case 'disputed':
      return <Callout tone="danger" title="Dispute open" text="Our team is reviewing this booking." />
    case 'declined':
      return <Callout title="Declined" />
    case 'expired':
      return <Callout title="This request expired" text="It wasn’t answered within 48 hours." />
    case 'cancelled_by_client':
      return <Callout title={`${first} cancelled this booking`} />
    case 'cancelled_by_provider':
      return <Callout title="You cancelled this booking" />
    default:
      return null
  }
}

function CompletedCallout({ b, first }: { b: Booking; first: string }) {
  const s = useStyles()
  const router = useRouter()
  const toReview = () => router.push({ pathname: '/bookings/[id]/review', params: { id: b.id } })
  return (
    <Callout title="Completed">
      {b.myReview ? (
        <View style={s.mtXs}>
          <Text variant="small">
            {b.theirReview ? 'Both reviews are now visible.' : `Your review stays hidden until ${first} reviews you or 14 days pass.`}
          </Text>
          <Button title="See reviews" variant="link" size="sm" onPress={toReview} />
        </View>
      ) : b.reviewWindowOpen ? (
        <Button title={`Review ${first}`} block style={s.mtSm} onPress={toReview} />
      ) : (
        <Text variant="small" muted>The review window has closed.</Text>
      )}
    </Callout>
  )
}

const useStyles = makeStyles((t) => ({
  pad: { padding: t.space.lg },
  info: { borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg, padding: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  grow: { flex: 1 },
  mtXs: { marginTop: 4 },
  mtSm: { marginTop: 8 },
  mt: { marginTop: 16 },
  sectionTitle: { marginTop: 24, marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 8 },
  wrap: { flexWrap: 'wrap' },
  moneyInput: { flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: 1, borderBottomColor: t.c.line, paddingBottom: 6 },
  moneyText: { fontSize: 22, fontWeight: '700', color: t.c.ink, paddingVertical: 4 },
  textarea: { minHeight: 72, textAlignVertical: 'top' },
}))
