// Instagram-style profile photo viewer (the web's components/AvatarViewer.jsx).
//   <ViewableAvatar uri={person.avatar} name={person.name} username={handle} />   tap to open
//   <AvatarViewer person={{ uri, name, username, to? }} onClose={...} />           controlled
// The photo grows in from small; close by tapping, swiping down, the X or Back.
// `to`: a profile route to offer ("View profile"); leave it out on the person's own page.
import { useRouter, type Href } from 'expo-router'
import { X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Modal, Pressable, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { useReduceMotion, IMAGE_BUTTON_ROLE } from '@/lib/a11y'
import { makeStyles } from '@/theme'
import { Avatar } from './Avatar'
import { Photo } from './Photo'
import { Text } from './Text'

export type AvatarPerson = { uri?: string | null; name?: string; username?: string | null; to?: Href | null }

const DISMISS = 90 // px of downward drag that closes it

export function AvatarViewer({ person, onClose }: { person: AvatarPerson | null; onClose: () => void }) {
  const s = useStyles()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const size = Math.min(width - 48, 340)
  const open = !!person?.uri && !person.uri.startsWith('data:image/svg')
  const progress = useSharedValue(0) // 0 hidden -> 1 shown
  const dy = useSharedValue(0)
  const [shown, setShown] = useState<AvatarPerson | null>(null)
  const reduceMotion = useReduceMotion() // no zoom: a quick fade (the opacity still animates)

  useEffect(() => {
    if (open) {
      setShown(person)
      dy.value = 0
      progress.value = withTiming(1, { duration: reduceMotion ? 120 : 220, easing: Easing.out(Easing.cubic) })
    }
  }, [open, person]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    progress.value = withTiming(0, { duration: reduceMotion ? 100 : 180 }, (done) => {
      if (done) runOnJS(onClose)()
    })
  }

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      dy.value = e.translationY > 0 ? e.translationY : e.translationY * 0.2
    })
    .onEnd(() => {
      if (dy.value > DISMISS) runOnJS(dismiss)()
      else dy.value = withTiming(0, { duration: 200 })
    })
  const tap = Gesture.Tap().onEnd(() => runOnJS(dismiss)())
  const gesture = Gesture.Exclusive(pan, tap)

  const backdrop = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - Math.min(Math.max(dy.value, 0), 300) / 380),
  }))
  const stage = useAnimatedStyle(() => {
    const pull = Math.min(Math.max(dy.value, 0), 300)
    return {
      opacity: progress.value,
      transform: [
        { translateY: dy.value },
        { scale: (reduceMotion ? 1 : interpolate(progress.value, [0, 1], [0.35, 1])) * (1 - pull / 1400) },
      ],
    }
  })

  const p = shown
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <GestureHandlerRootView style={s.root} onAccessibilityEscape={dismiss}>
        <Animated.View style={[s.backdrop, backdrop]} importantForAccessibility="no" />
        <GestureDetector gesture={gesture}>
          <View style={s.root}>
            <Animated.View style={[s.stage, stage]}>
              <Photo uri={p?.uri} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityLabel={p?.name ? `${p.name}’s profile photo` : 'Profile photo'} />
              {!!p?.name && <Text variant="h3" style={s.light}>{p.name}</Text>}
              {!!p?.username && <Text variant="small" style={s.handle}>@{p.username}</Text>}
              {!!p?.to && (
                <Pressable
                  onPress={() => {
                    onClose()
                    router.push(p.to as Href)
                  }}
                  style={s.visit}
                  accessibilityRole="link"
                  accessibilityLabel={p?.name ? `View ${p.name}’s profile` : 'View profile'}
                >
                  <Text variant="small" weight="600" style={s.white}>View profile</Text>
                </Pressable>
              )}
            </Animated.View>
          </View>
        </GestureDetector>
        <Pressable onPress={dismiss} style={s.close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close photo">
          <X size={22} color="#fff" />
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  )
}

// A big avatar that opens the viewer when tapped (no photo: just the initials, not tappable).
export function ViewableAvatar({ uri, name, username, size = 'xl', ring, to }: {
  uri?: string | null; name?: string; username?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' | number; ring?: boolean; to?: Href | null
}) {
  const [open, setOpen] = useState(false)
  const real = !!uri && !uri.startsWith('data:image/svg')
  const avatar = <Avatar uri={uri} name={name} size={size} ring={ring} />
  if (!real) return avatar
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole={IMAGE_BUTTON_ROLE} accessibilityLabel={name ? `View ${name}’s profile photo` : 'View profile photo'}>
        {avatar}
      </Pressable>
      <AvatarViewer person={open ? { uri, name, username, to } : null} onClose={() => setOpen(false)} />
    </>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,8,8,0.94)' },
  stage: { alignItems: 'center', gap: 4 },
  light: { color: '#fff', marginTop: 14 },
  white: { color: '#fff' },
  handle: { color: 'rgba(255,255,255,0.7)' },
  visit: { marginTop: 14, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  close: { position: 'absolute', top: 48, right: 16, padding: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
}))
