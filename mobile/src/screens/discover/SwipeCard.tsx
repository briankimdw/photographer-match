// One card of the swipe deck (the web SwipeDeck's .swipe-card), on gesture-handler +
// reanimated: drag right = like, left = pass, up = shortlist; past THRESHOLD it flies out.
// Taps are routed by where they land: the left / right 30% flip photos, the middle opens
// the details sheet, the thumbs-down corner opens "Not into this", the name opens the profile.
// Remount it per card (key={card.id}) so every card starts from the center.
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { ChevronLeft, ChevronRight, Compass, Sparkles, Star, ThumbsDown } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated'

import { money, startingPrice } from '@shared/lib/format.js'
import { Avatar, IdVerified, InA11yGroup, Photo, ProBadge, Text, ratingLabel } from '@/components'
import { useFocusOnShow } from '@/lib/a11y'
import { makeStyles } from '@/theme'
import type { DeckCard, SwipeAction } from './types'

export const THRESHOLD = 90
const FLY_MS = 260

export type TapZone = 'prev' | 'next' | 'details' | 'correct' | 'profile'

type Props = {
  card: DeckCard
  shot: number
  showHint: boolean
  match: number | null
  exit: SwipeAction | null // a button asked this card to leave
  disabled?: boolean
  onTap: (zone: TapZone) => void
  onSwipeStart: (action: SwipeAction) => void // a drag passed the threshold (the card is leaving)
  onSwiped: (action: SwipeAction) => void // the card has left the screen
  progress?: SharedValue<number> // 0..1 drag progress, for the card behind
  /** Screen readers have no drag: the same choices as actions (VoiceOver: swipe up / down, double-tap). */
  onAction?: (action: SwipeAction) => void
  /** Move the screen-reader cursor here when it mounts (after a swipe, the next card). */
  focusOnMount?: boolean
}

// Swipe-free equivalents of every gesture on the card (VoiceOver "Actions" rotor, TalkBack actions menu).
const A11Y_ACTIONS = [
  { name: 'activate', label: 'Details' },
  { name: 'like', label: 'Like' },
  { name: 'pass', label: 'Pass' },
  { name: 'save', label: 'Shortlist' },
  { name: 'next', label: 'Next photo' },
  { name: 'prev', label: 'Previous photo' },
  { name: 'profile', label: 'Open profile' },
  { name: 'correct', label: 'Not into this' },
]

export function SwipeCard({ card, shot, showHint, match, exit, disabled, onTap, onSwipeStart, onSwiped, progress, onAction, focusOnMount }: Props) {
  const s = useStyles()
  // Reduce motion: the card fades out in place instead of flying off and spinning.
  const reduceMotion = useReducedMotion()
  const fade = useSharedValue(1)
  const focusRef = useFocusOnShow<View>(!!focusOnMount, 250)
  const [box, setBox] = useState({ w: 360, h: 520 })
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const leaving = useSharedValue(false)
  const p = card.provider
  const photo = card.photos[shot] ?? card.photos[0]

  // Warm the cache with the rest of the album so flipping is instant.
  useEffect(() => {
    const urls = card.photos.map((ph) => ph.src).filter(Boolean)
    if (urls.length) Image.prefetch(urls).catch(() => {})
  }, [card.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const flyTo = (action: SwipeAction, w: number, h: number) => {
    'worklet'
    leaving.value = true
    const done = (finished?: boolean) => {
      'worklet'
      if (finished) runOnJS(onSwiped)(action)
    }
    if (reduceMotion) {
      fade.value = withTiming(0, { duration: 140 }, done)
    } else if (action === 'save') {
      ty.value = withTiming(-h * 1.4, { duration: FLY_MS }, done)
    } else {
      ty.value = withTiming(ty.value + 40, { duration: FLY_MS })
      tx.value = withTiming((action === 'like' ? 1 : -1) * w * 1.4, { duration: FLY_MS }, done)
    }
  }

  // Buttons (like / pass / shortlist) fly the card out the same way.
  useEffect(() => {
    if (exit && !leaving.value) flyTo(exit, box.w, box.h)
  }, [exit]) // eslint-disable-line react-hooks/exhaustive-deps

  const { w, h } = box
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(6)
    .onUpdate((e) => {
      if (leaving.value) return
      tx.value = e.translationX
      ty.value = e.translationY
      if (progress) progress.value = Math.min(1, (Math.abs(e.translationX) + Math.abs(e.translationY)) / (THRESHOLD * 1.5))
    })
    .onEnd(() => {
      if (leaving.value) return
      const x = tx.value
      const y = ty.value
      const action: SwipeAction | null = x > THRESHOLD ? 'like' : x < -THRESHOLD ? 'pass' : y < -THRESHOLD ? 'save' : null
      if (action) {
        runOnJS(onSwipeStart)(action)
        flyTo(action, w, h)
      } else {
        tx.value = withSpring(0, { damping: 18, stiffness: 220 })
        ty.value = withSpring(0, { damping: 18, stiffness: 220 })
        if (progress) progress.value = withTiming(0)
      }
    })

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .maxDistance(8)
    .onEnd((e) => {
      const zone: TapZone =
        e.y < 64 && e.x > w - 64 ? 'correct'
        : e.y > h - 96 && e.x < w * 0.72 ? 'profile'
        : e.x < w * 0.3 ? 'prev'
        : e.x > w * 0.7 ? 'next'
        : 'details'
      runOnJS(onTap)(zone)
    })

  const gesture = Gesture.Race(pan, tap)

  const cardStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: reduceMotion ? '0deg' : `${tx.value / 18}deg` }],
  }))
  const likeStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [0, THRESHOLD], [0, 1], 'clamp') }))
  const passStyle = useAnimatedStyle(() => ({ opacity: interpolate(-tx.value, [0, THRESHOLD], [0, 1], 'clamp') }))
  const saveStyle = useAnimatedStyle(() => ({ opacity: interpolate(-ty.value, [0, THRESHOLD], [0, 1], 'clamp') * (Math.abs(tx.value) < THRESHOLD ? 1 : 0) }))

  const from = startingPrice(p)
  const meta = [card.category, from != null && `from ${money(from)}`].filter(Boolean).map((x) => `· ${x}`).join(' ')
  const a11yLabel = [
    `${card.title || 'Photo'} by ${p.name}`,
    card.photos.length > 1 && `photo ${shot + 1} of ${card.photos.length}`,
    card.category,
    p.idVerified && 'identity verified',
    p.pro && 'Verified Pro',
    ratingLabel(p.rating),
    from != null && `from ${money(from)}`,
    match != null && `${match}% taste match`,
    card.reason,
  ].filter(Boolean).join(', ')

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        ref={focusRef as any}
        style={[s.card, cardStyle]}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        accessible
        accessibilityRole="image"
        accessibilityLabel={a11yLabel}
        accessibilityHint="Double-tap for details. Swipe up or down for Like, Pass, Shortlist and more."
        accessibilityActions={A11Y_ACTIONS}
        onAccessibilityAction={(e) => {
          const name = e.nativeEvent.actionName
          if (name === 'activate') onTap('details')
          else if (name === 'like' || name === 'pass' || name === 'save') onAction?.(name)
          else onTap(name as TapZone)
        }}
      >
        <InA11yGroup value>
        {/* pointerEvents none: on the web target an <img> would start a native image drag (pointercancel) */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none"><Photo uri={photo?.src} style={StyleSheet.absoluteFill} /></View>

        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {card.photos.length > 1 && (
            <>
              <View style={s.bars}>
                {card.photos.map((ph, i) => <View key={ph.id} style={[s.bar, i === shot && s.barOn]} />)}
              </View>
              {shot > 0 && <View style={[s.edge, s.edgeLeft]}><ChevronLeft size={18} color="#fff" /></View>}
              <View style={[s.edge, s.edgeRight]}><ChevronRight size={18} color="#fff" /></View>
            </>
          )}
          <View style={s.top}>
            {card.reason ? (
              <View style={[s.why, card.exploration && s.whyExplore]}>
                {card.exploration ? <Compass size={13} color="#e0e7ff" /> : <Sparkles size={13} color="#111" />}
                <Text maxFontSizeMultiplier={1.4} variant="tiny" weight="600" numberOfLines={1} style={[s.whyText, card.exploration && { color: '#e0e7ff' }]}>{card.reason}</Text>
              </View>
            ) : <View />}
            <View style={s.iconBtn}><ThumbsDown size={16} color="#fff" /></View>
          </View>

          {showHint && card.photos.length > 1 && (
            <View style={s.hint}>
              <Text maxFontSizeMultiplier={1.4} variant="tiny" weight="600" style={s.white}>Tap the edges for {card.photos.length} photos · swipe to like or pass</Text>
            </View>
          )}

          <Animated.View style={[s.stamp, s.like, likeStyle]}><Text maxFontSizeMultiplier={1.4} style={[s.stampText, { color: '#22c55e' }]}>LIKE</Text></Animated.View>
          <Animated.View style={[s.stamp, s.pass, passStyle]}><Text maxFontSizeMultiplier={1.4} style={[s.stampText, { color: '#ef4444' }]}>PASS</Text></Animated.View>
          <Animated.View style={[s.stamp, s.save, saveStyle]}><Text maxFontSizeMultiplier={1.4} style={[s.stampText, { color: '#3b82f6' }]}>SHORTLIST</Text></Animated.View>

          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.78)']} style={s.foot}>
            <View style={s.footRow}>
              <View style={s.avatarRing}><Avatar uri={p.avatar} name={p.name} size={40} /></View>
              <View style={s.grow}>
                <View style={s.nameRow}>
                  <Text maxFontSizeMultiplier={1.4} variant="body" weight="700" numberOfLines={1} style={[s.white, s.shrink]}>{p.name}</Text>
                  {p.idVerified && <IdVerified />}
                  {p.pro && <ProBadge />}
                </View>
                <View style={s.nameRow}>
                  {p.rating != null ? (
                    <>
                      <Star size={11} color="#fbbf24" fill="#fbbf24" />
                      <Text maxFontSizeMultiplier={1.4} variant="tiny" weight="600" style={s.white}>{p.rating.toFixed(1)}</Text>
                    </>
                  ) : (
                    <Text maxFontSizeMultiplier={1.4} variant="tiny" style={s.white}>New</Text>
                  )}
                  <Text maxFontSizeMultiplier={1.4} variant="tiny" numberOfLines={1} style={[s.dim, s.shrink]}>{meta}</Text>
                </View>
              </View>
              {match != null && (
                <View style={s.match}>
                  <Text maxFontSizeMultiplier={1.4} weight="800" style={s.white}>{match}%</Text>
                  <Text maxFontSizeMultiplier={1.4} variant="caption" style={s.dim}>match</Text>
                </View>
              )}
            </View>
            {!!card.exif && <Text maxFontSizeMultiplier={1.4} variant="tiny" style={s.exif} numberOfLines={1}>{card.exif}</Text>}
          </LinearGradient>
        </View>
        </InA11yGroup>
      </Animated.View>
    </GestureDetector>
  )
}

// The next card, peeking out behind the top one; it grows as the top card is dragged.
export function BehindCard({ card, progress }: { card: DeckCard; progress: SharedValue<number> }) {
  const s = useStyles()
  const style = useAnimatedStyle(() => ({
    opacity: 0.8 + progress.value * 0.2,
    transform: [{ scale: 0.95 + progress.value * 0.05 }, { translateY: 10 - progress.value * 10 }],
  }))
  return (
    <Animated.View style={[s.card, s.behind, style]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Photo uri={card.photos[0]?.src} style={StyleSheet.absoluteFill} />
    </Animated.View>
  )
}

const useStyles = makeStyles((t) => ({
  card: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, overflow: 'hidden', backgroundColor: t.c.soft,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5,
  },
  behind: { shadowOpacity: 0, elevation: 0 },
  bars: { position: 'absolute', top: 8, left: 10, right: 10, flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.4)' },
  barOn: { backgroundColor: '#fff' },
  edge: { position: 'absolute', top: '50%', marginTop: -15, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  edgeLeft: { left: 8 },
  edgeRight: { right: 8 },
  top: { position: 'absolute', top: 18, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  why: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.92)', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, flexShrink: 1 },
  whyExplore: { backgroundColor: '#1e1b4b' },
  whyText: { color: '#111', flexShrink: 1 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  hint: { position: 'absolute', bottom: 120, alignSelf: 'center', maxWidth: '86%', backgroundColor: 'rgba(17,17,17,0.75)', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999 },
  stamp: { position: 'absolute', top: 76, borderWidth: 4, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 10 },
  stampText: { fontSize: 28, fontWeight: '900', letterSpacing: 1.5 },
  like: { left: 22, borderColor: '#22c55e', transform: [{ rotate: '-14deg' }] },
  pass: { right: 22, borderColor: '#ef4444', transform: [{ rotate: '14deg' }] },
  save: { top: undefined, bottom: 130, alignSelf: 'center', borderColor: '#3b82f6' },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 56, paddingHorizontal: 14, paddingBottom: 14 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarRing: { borderWidth: 2, borderColor: '#fff', borderRadius: 999 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  shrink: { flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  white: { color: '#fff' },
  dim: { color: 'rgba(255,255,255,0.8)' },
  match: { alignItems: 'center' },
  exif: { color: 'rgba(255,255,255,0.75)', marginTop: 8, fontFamily: 'monospace', fontSize: 11 },
}))
