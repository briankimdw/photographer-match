// A booking's delivery: native version of frontend/src/screens/Delivery.jsx.
// There's no in-app gallery storage for deliveries yet (vendors share a gallery link in
// the booking chat), so this shows the real delivery status and lets the client accept it.
import { callName } from '@shared/lib/format.js'
import { acceptDelivery, bookingError, getBooking } from '@shared/api/bookings.js'
import { fmtBooking } from '@shared/lib/dates.js'
import { deliversMedia } from '@shared/verticals/index.js'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CalendarX, CheckCircle2, Images, MessageCircle, Timer } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import { Button, EmptyState, ErrorState, Loading, Screen, SignInPrompt, Text } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'
import type { Booking } from './NeedsAction'
import { Callout, useRefocus } from './parts'

export default function Delivery() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, loading: authLoading } = useAuth()
  const q = useQuery<Booking | null>(user ? () => getBooking(id) : null, [id, user?.id])
  useRefocus(q.reload)
  const router = useRouter()
  const b = q.data

  if (authLoading || (q.loading && !b)) return <Screen title="Delivery" back><Loading /></Screen>
  if (!user) return <Screen title="Delivery" back><SignInPrompt title="Sign in to see this delivery" /></Screen>
  if (q.error) return <Screen title="Delivery" back><ErrorState error={q.error} onRetry={q.reload} /></Screen>
  if (!b) {
    return (
      <Screen title="Delivery" back>
        <EmptyState icon={CalendarX} title="Booking not found" action={<Button title="Your bookings" size="sm" onPress={() => router.replace('/bookings')} />} />
      </Screen>
    )
  }
  return <DeliveryView b={b} reload={q.reload} />
}

function DeliveryView({ b, reload }: { b: Booking; reload: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  const isClient = b.role === 'client'
  const other = isClient ? b.provider : b.client
  const first = (other as any).shortName || callName(other.name || '') || (isClient ? 'Your vendor' : 'The client')
  const days = b.deliveryExpiresDays
  const media = b.vertical === 'videography' ? 'video' : 'photos'
  const autoText = days != null ? ` It’s accepted automatically in ${days} day${days === 1 ? '' : 's'}.` : ''

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

  const openChat = () => router.push({ pathname: '/inbox/[id]', params: { id: b.conversationId! } })

  return (
    <Screen
      title={isClient ? (deliversMedia(b.vertical) ? `Your ${media}` : 'Delivery') : 'Delivery'}
      subtitle={`${b.packageName} · ${isClient ? `by ${b.provider.name}` : `for ${b.client.name}`}`}
      back
    >
      <View style={s.pad}>
        {b.status === 'delivered' && (
          <Callout
            tone={days != null && days <= 2 ? 'danger' : 'accent'}
            title={
              <View style={s.inline}>
                <Timer size={15} color={c.ink} />
                <Text variant="body" weight="700">Delivered{b.deliveredAt ? ` ${fmtBooking(new Date(b.deliveredAt))}` : ''}</Text>
              </View>
            }
            text={isClient ? `Check your ${media}, then accept the delivery.${autoText}` : `Waiting for ${first} to accept.${autoText}`}
          >
            {isClient && <Button title={busy ? 'Accepting…' : 'Accept delivery'} variant="accent" block disabled={busy} onPress={accept} style={s.mtSm} />}
          </Callout>
        )}
        {b.status === 'completed' && (
          <Callout
            title={
              <View style={s.inline}>
                <CheckCircle2 size={15} color={c.ink} />
                <Text variant="body" weight="700">Delivery accepted</Text>
              </View>
            }
            text={b.completedAt ? `Completed ${fmtBooking(new Date(b.completedAt))}.` : undefined}
          >
            {b.reviewWindowOpen && !b.myReview && (
              <Button title={`Review ${first}`} block style={s.mtSm} onPress={() => router.push({ pathname: '/bookings/[id]/review', params: { id: b.id } })} />
            )}
          </Callout>
        )}
        {!['delivered', 'completed'].includes(b.status) && (
          <Callout
            title="Not delivered yet"
            text={isClient ? `${first} will mark the booking delivered once your ${media} ${media === 'video' ? 'is' : 'are'} ready.` : `Mark the booking delivered from the booking page once the ${media} ${media === 'video' ? 'is' : 'are'} shared.`}
          />
        )}
      </View>

      <EmptyState
        icon={Images}
        title="Gallery link in chat"
        text={
          isClient
            ? `${first} shares your full gallery through a link in your booking chat. In-app galleries with downloads are coming soon.`
            : `Share the gallery link with ${first} in your booking chat. In-app gallery uploads are coming soon.`
        }
        action={b.conversationId ? <Button title={`Open chat with ${first}`} icon={MessageCircle} size="sm" onPress={openChat} /> : undefined}
      />
      <View style={s.padX}>
        <Button title="Booking details" variant="ghost" block onPress={() => router.dismissTo({ pathname: '/bookings/[id]', params: { id: b.id } })} />
      </View>
    </Screen>
  )
}

const useStyles = makeStyles((t) => ({
  pad: { paddingHorizontal: t.space.lg, paddingTop: 4 },
  padX: { paddingHorizontal: t.space.lg },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mtSm: { marginTop: 8 },
}))
