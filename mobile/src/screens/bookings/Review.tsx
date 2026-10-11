// Leave / read the reviews for a booking: native version of frontend/src/screens/Review.jsx.
// Reviews are double-blind: neither side sees the other's until both post or 14 days pass.
import { callName } from '@shared/lib/format.js'
import { bookingError, getBooking, submitReview } from '@shared/api/bookings.js'
import { sessionNoun } from '@shared/verticals/index.js'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CalendarX, EyeOff, Star } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Avatar, Button, EmptyState, ErrorState, Loading, Screen, SignInPrompt, Stars, Text, TextField } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'
import type { Booking } from './NeedsAction'
import { Note } from './parts'

export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, loading: authLoading } = useAuth()
  const q = useQuery<Booking | null>(user ? () => getBooking(id) : null, [id, user?.id])
  const router = useRouter()
  const b = q.data

  if (authLoading || (q.loading && !b)) return <Screen title="Review" back><Loading /></Screen>
  if (!user) return <Screen title="Review" back><SignInPrompt title="Sign in to leave a review" /></Screen>
  if (q.error) return <Screen title="Review" back><ErrorState error={q.error} onRetry={q.reload} /></Screen>
  if (!b) {
    return (
      <Screen title="Review" back>
        <EmptyState icon={CalendarX} title="Booking not found" action={<Button title="Your bookings" size="sm" onPress={() => router.replace('/bookings')} />} />
      </Screen>
    )
  }
  return <ReviewView b={b} reload={q.reload} />
}

// Tappable 1–5 stars (big touch targets).
function StarInput({ value, onChange, size = 36 }: { value: number; onChange: (n: number) => void; size?: number }) {
  const { c } = useTheme()
  return (
    // One "adjustable" element for screen readers: swipe up / down to change the rating.
    <View
      style={{ flexDirection: 'row', gap: 4 }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Rating"
      accessibilityValue={{ min: 0, max: 5, now: value, text: value ? `${value} of 5 stars` : 'Not rated yet' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onChange(Math.min(5, value + 1))
        if (e.nativeEvent.actionName === 'decrement') onChange(Math.max(1, value - 1))
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={4} accessible={false} importantForAccessibility="no">
          <Star size={size} color={n <= value ? c.star : c.faint} fill={n <= value ? c.star : 'none'} />
        </Pressable>
      ))}
    </View>
  )
}

function ReviewView({ b, reload }: { b: Booking; reload: () => void }) {
  const s = useStyles()
  const router = useRouter()
  const { toast } = useStore()
  const isClient = b.role === 'client'
  const other = isClient ? b.provider : b.client
  const first = (other as any).shortName || callName(other.name || '') || (isClient ? 'your vendor' : 'your client')
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // Back to the booking already in the stack (opened from it) instead of stacking a second copy.
  const backToBooking = () => router.dismissTo({ pathname: '/bookings/[id]', params: { id: b.id } })

  const submit = async () => {
    setBusy(true)
    try {
      const review: any = await submitReview(b.id, rating, text.trim() as any)
      toast(review?.revealed_at ? 'Review posted. Both reviews are now visible.' : 'Review saved. It stays hidden until both of you review.')
      reload()
    } catch (err) {
      toast(bookingError(err))
      setBusy(false)
    }
  }

  const header = (
    <>
      <Avatar uri={other.avatar} name={other.name ?? ''} size="xl" />
      <Text variant="small" muted center>{b.packageName} · {b.date}</Text>
    </>
  )

  if (b.myReview) {
    return (
      <Screen title="Reviews" back>
        <View style={s.center}>
          {header}
          <Text variant="h3" center style={s.mt}>Your review of {first}</Text>
          <Stars value={b.myReview.rating} size={24} />
          {!!b.myReview.body && <Text variant="small" center>“{b.myReview.body}”</Text>}
          {b.theirReview ? (
            <View style={[s.reveal, s.mt]}>
              <Text variant="h4" center>{first}’s review of you</Text>
              <Stars value={b.theirReview.rating} size={20} />
              {!!b.theirReview.body && <Text variant="small" center>“{b.theirReview.body}”</Text>}
            </View>
          ) : (
            <Note icon={EyeOff} style={s.mt}>
              Your review is hidden until {first} reviews you too, or 14 days pass. Then both appear at once.
            </Note>
          )}
          <Button title="Back to booking" variant="ghost" block onPress={backToBooking} style={s.mt} />
        </View>
      </Screen>
    )
  }

  if (b.status !== 'completed' || !b.reviewWindowOpen) {
    return (
      <Screen title="Leave a review" back>
        <EmptyState
          icon={EyeOff}
          title={b.status === 'completed' ? 'Reviews are closed' : `Reviews open after the ${sessionNoun(b.vertical)}`}
          text={b.status === 'completed' ? 'Reviews can be left for 14 days after a booking completes.' : 'You can review once the delivery is accepted and the booking is completed.'}
          action={<Button title="Back to booking" size="sm" onPress={backToBooking} />}
        />
      </Screen>
    )
  }

  return (
    <Screen title="Leave a review" back>
      <View style={s.center}>
        <Avatar uri={other.avatar} name={other.name ?? ''} size="xl" />
        <Text variant="h3" center>{isClient ? `How was your ${sessionNoun(b.vertical)} with ${first}?` : `How was working with ${first}?`}</Text>
        <Text variant="small" muted center>{b.packageName} · {b.date}</Text>
        <View style={s.mt}>
          <StarInput value={rating} onChange={setRating} />
        </View>
        <TextField
          value={text}
          onChangeText={setText}
          multiline
          placeholder={isClient ? 'Share details about your experience' : 'How was this client to work with?'}
          style={s.textarea}
          containerStyle={[s.mt, s.stretch]}
        />
        <Note icon={EyeOff} style={[s.mt, s.stretch]}>
          Reviews are double-blind. Neither of you sees the other’s review until you’ve both posted, or 14 days pass.
        </Note>
        <Button title={busy ? 'Posting…' : 'Submit review'} variant="accent" block disabled={!rating || busy} onPress={submit} style={s.mtLg} />
      </View>
    </Screen>
  )
}

const useStyles = makeStyles((t) => ({
  center: { padding: t.space.lg, alignItems: 'center', gap: 6 },
  mt: { marginTop: 16 },
  mtLg: { marginTop: 24 },
  stretch: { alignSelf: 'stretch' },
  reveal: { alignSelf: 'stretch', alignItems: 'center', gap: 6, padding: 14, borderRadius: t.radius.lg, backgroundColor: t.c.soft },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
}))
