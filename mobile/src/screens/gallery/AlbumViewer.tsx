// Full-screen viewer for a provider's portfolio, one album (shoot) at a time: the native
// port of the web Gallery.jsx AlbumViewer. Swipe up/down between albums (vertical paging),
// left/right through an album's photos (horizontal paging). Pinch to zoom in on a photo
// (it springs back when you let go, Instagram-style); press and hold to hide the overlays.
// Close with the X, Back, or by pulling down past the first album (iOS bounce).
// TODO(port): persistent zoom + pan and double-tap zoom, before/after slider (shows the
// "after" photo), owner edit/delete (ManagePost), collections picker (Save uses the default
// collection), report/block sheet.
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { Bookmark, Heart, Info, MapPin, Send, Sparkles, X, Camera, Aperture, CircleDot, Calendar, Gauge, Ruler, Timer, Zap } from 'lucide-react-native'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  FlatList, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken,
} from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Avatar, Button, Chip, ChipRow, IdVerified, InA11yGroup, Photo, ProBadge, Sheet, Text } from '@/components'
import { ShareSheet } from '@/components/share/ShareSheet'
import { announce, useReduceMotion } from '@/lib/a11y'
import { useStore } from '@/state/store'
import { makeStyles } from '@/theme'
import type { Album } from '../profile/AlbumGrid'
import { CreditChips } from '../provider/upload/Credits'

type ViewerPhoto = { id: string; seed?: string; src: string; exif?: Record<string, any> | null }
const photoKey = (p: ViewerPhoto) => p.id ?? p.seed
const shortExif = (e?: Record<string, any> | null) => [e?.focal, e?.aperture, e?.shutter, e?.iso && `ISO ${e.iso}`].filter(Boolean).join('  ·  ')
const EXIF_ROWS = [
  { key: 'body', label: 'Body', Icon: Camera },
  { key: 'lens', label: 'Lens', Icon: CircleDot },
  { key: 'focal', label: 'Focal length', Icon: Ruler },
  { key: 'aperture', label: 'Aperture', Icon: Aperture },
  { key: 'shutter', label: 'Shutter', Icon: Timer },
  { key: 'iso', label: 'ISO', Icon: Gauge },
  { key: 'flash', label: 'Flash', Icon: Zap },
  { key: 'date', label: 'Taken', Icon: Calendar },
] as const

export type ViewerOwner = { name: string; avatar?: string | null; idVerified?: boolean; pro?: boolean; username?: string | null; providerId: string }
export type ViewerBook = { label: string; line: string; onPress: () => void; onLine?: () => void } | null

type Props = { albums: Album[]; owner: ViewerOwner; book: ViewerBook; startPost?: string | null; startPhoto?: string | null }

export function AlbumViewer({ albums, owner, book, startPost, startPhoto }: Props) {
  const s = useStyles()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width: winW, height: winH } = useWindowDimensions()
  const [size, setSize] = useState({ w: winW, h: winH })
  const { liked, toggleLike, saved, toggleSave } = useStore()

  const startIndex = useMemo(() => {
    const byPost = albums.findIndex((a) => a.id === startPost)
    const byPhoto = albums.findIndex((a) => a.photos.some((p: ViewerPhoto) => photoKey(p) === startPhoto))
    return Math.max(0, byPost >= 0 ? byPost : byPhoto)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(startIndex)
  const [photoOf, setPhotoOf] = useState<Record<string, number>>(() => {
    for (const a of albums) {
      const j = a.photos.findIndex((p: ViewerPhoto) => photoKey(p) === startPhoto)
      if (j > 0) return { [a.id]: j }
    }
    return {}
  })
  const [info, setInfo] = useState(false)
  const [holding, setHolding] = useState(false)
  const [hintSeen, setHintSeen] = useState(false)

  const album = albums[Math.min(index, albums.length - 1)]
  const photoIndex = photoOf[album.id] ?? 0
  const photo: ViewerPhoto = album.photos[photoIndex] ?? album.photos[0]
  const pid = photoKey(photo)!

  const close = () => (router.canGoBack() ? router.back() : router.replace(`/u/${owner.providerId}`))

  // Screen readers can't page with a swipe: the photo offers "Next post" / "Previous post"
  // actions, which scroll the list here.
  const reduceMotion = useReduceMotion()
  const goPost = (delta: number) => {
    const to = index + delta
    if (to < 0 || to >= albums.length) return announce(delta > 0 ? 'This is the last post' : 'This is the first post')
    listRef.current?.scrollToIndex({ index: to, animated: !reduceMotion })
    setIndex(to)
    announce(`Post ${to + 1} of ${albums.length}${albums[to].title ? `, ${albums[to].title}` : ''}`)
  }
  const goPostRef = useRef(goPost)
  goPostRef.current = goPost

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable)
    if (first?.index != null) {
      setIndex(first.index)
      if (first.index !== startIndex) setHintSeen(true)
    }
  }).current
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current

  const onEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (e.nativeEvent.contentOffset.y < -90) close() // pulled down past the first album (iOS bounce)
  }

  const [sharing, setSharing] = useState(false)
  const share = () => setSharing(true)

  const renderAlbum = useCallback(
    ({ item: a }: { item: Album }) => (
      <AlbumPage
        album={a}
        width={size.w}
        height={size.h}
        start={photoOf[a.id] ?? 0}
        onPhoto={(j) => {
          setPhotoOf((m) => (m[a.id] === j ? m : { ...m, [a.id]: j }))
          if (j > 0) setHintSeen(true)
        }}
        onHold={setHolding}
        onPost={(d) => goPostRef.current(d)}
        reduceMotion={reduceMotion}
      />
    ),
    [size.w, size.h, reduceMotion], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // The pages are sized from the window until the viewer measures itself. If the real
  // size differs (e.g. Android system bars), the list's offset (index * old height) no
  // longer lines up with a page: snap back to the current album at the new size.
  const listRef = useRef<FlatList<Album>>(null)
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    if (Math.abs(width - size.w) > 1 || Math.abs(height - size.h) > 1) {
      setSize({ w: width, h: height })
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: index * height, animated: false }))
    }
  }

  const isLiked = liked.has(pid)
  const isSaved = saved.has(pid)
  const exif = shortExif(photo.exif)
  const exifRows = EXIF_ROWS.filter((r) => photo.exif?.[r.key])

  return (
    <View style={s.root} onLayout={onLayout}>
      <FlatList
        ref={listRef}
        data={albums}
        keyExtractor={(a) => a.id}
        renderItem={renderAlbum}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: size.h, offset: size.h * i, index: i })}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        onScrollEndDrag={onEndDrag}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        extraData={size}
      />

      {!holding && (
        <>
          <View style={[s.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
            <Pressable onPress={close} style={s.iconBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <X size={24} color="#fff" />
            </Pressable>
            {album.photos.length > 1 && (
              <View style={s.count} accessible accessibilityLabel={`Photo ${photoIndex + 1} of ${album.photos.length}`}>
                <Text variant="tiny" weight="700" style={s.white} maxFontSizeMultiplier={1.4}>{photoIndex + 1} / {album.photos.length}</Text>
              </View>
            )}
          </View>

          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.72)']} style={[s.bottom, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
            {album.photos.length > 1 && (
              <View style={s.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {album.photos.map((p: ViewerPhoto, j: number) => <View key={photoKey(p)} style={[s.dot, j === photoIndex && s.dotOn]} />)}
              </View>
            )}
            <View style={s.titleRow}>
              <View style={s.grow}>
                {!!album.title && <Text variant="h3" style={s.white} numberOfLines={2}>{album.title}</Text>}
                <Text variant="tiny" style={s.dim} numberOfLines={2}>
                  Post {index + 1} of {albums.length}{album.occasion ? ` · ${album.occasion.name}` : ''}{album.location ? ` · ${album.location}` : ''}{album.date ? ` · ${album.date}` : ''}
                </Text>
              </View>
              <View style={s.icons}>
                <Pressable
                  onPress={() => toggleLike({ id: pid, albumId: album.id, providerId: album.providerId ?? owner.providerId })}
                  style={s.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Like"
                  accessibilityState={{ selected: isLiked }}
                >
                  <Heart size={22} color={isLiked ? '#ff5a5f' : '#fff'} fill={isLiked ? '#ff5a5f' : 'none'} />
                </Pressable>
                <Pressable onPress={() => toggleSave(pid)} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ selected: isSaved }}>
                  <Bookmark size={22} color="#fff" fill={isSaved ? '#fff' : 'none'} />
                </Pressable>
                <Pressable onPress={share} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Share">
                  <Send size={21} color="#fff" />
                </Pressable>
                <Pressable onPress={() => setInfo(true)} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Album details">
                  <Info size={22} color="#fff" />
                </Pressable>
              </View>
            </View>
            <InA11yGroup value>
            <Pressable
              onPress={() => router.push(`/u/${owner.providerId}`)}
              style={s.who}
              accessibilityRole="link"
              accessibilityLabel={[owner.name, owner.idVerified && 'identity verified', owner.pro && 'Verified Pro'].filter(Boolean).join(', ')}
              accessibilityHint="Opens their profile"
            >
              <Avatar uri={owner.avatar} name={owner.name} size={28} />
              <Text variant="small" weight="700" style={s.white}>{owner.name}</Text>
              {owner.idVerified && <IdVerified />}
              {owner.pro && <ProBadge />}
            </Pressable>
            </InA11yGroup>
            {album.credits?.length > 0 && <CreditChips credits={album.credits} dark onOpen={(id) => router.push(`/u/${id}`)} />}
            {!!exif && <Text variant="tiny" style={s.exif}>{exif}</Text>}
            {book && (
              <View style={s.book}>
                <Pressable onPress={book.onLine} disabled={!book.onLine} style={s.grow} accessibilityRole={book.onLine ? 'link' : 'text'}>
                  <Text variant="small" style={s.white}>{book.line}</Text>
                </Pressable>
                <Button title={book.label} size="sm" variant="accent" onPress={book.onPress} />
              </View>
            )}
          </LinearGradient>

          {!hintSeen && (
            <View style={s.hint} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Text variant="tiny" weight="600" center style={s.white}>
                {album.photos.length > 1 ? 'Swipe ← for more of this shoot · ' : ''}↑ next album{'\n'}Pinch to zoom · hold to see just the photo
              </Text>
            </View>
          )}
        </>
      )}

      <Sheet open={info} onClose={() => setInfo(false)} title={album.title || 'Album'}>
        {!!album.caption && <Text variant="small">{album.caption}</Text>}
        {!!(album.location || album.date) && (
          <View style={s.metaRow}>
            <MapPin size={13} color="#6b6b6b" />
            <Text variant="small" muted>{[album.location, album.date].filter(Boolean).join(' · ')}</Text>
          </View>
        )}
        {album.credits?.length > 0 && (
          <>
            <Text variant="h4" style={s.section}>Credits</Text>
            <CreditChips credits={album.credits} onOpen={(id) => { setInfo(false); router.push(`/u/${id}`) }} />
          </>
        )}
        {exifRows.length > 0 && (
          <>
            <Text variant="h4" style={s.section}>Gear & settings{album.photos.length > 1 ? ` · photo ${photoIndex + 1}` : ''}</Text>
            <View style={s.exifGrid}>
              {exifRows.map(({ key, label, Icon }) => (
                <View key={key} style={[s.exifCell, (key === 'body' || key === 'lens') && s.exifWide]}>
                  <Icon size={15} color="#6b6b6b" />
                  <View style={s.grow}>
                    <Text variant="tiny" muted>{label}</Text>
                    <Text variant="small" weight="600">{String(photo.exif?.[key])}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
        {(!!album.genre || !!album.occasion || album.autoTags?.length > 0) && (
          <>
            <Text variant="h4" style={s.section}>Tags</Text>
            <ChipRow>
              {!!album.genre && (
                <Chip label={album.genre} solid onPress={() => { setInfo(false); router.push({ pathname: '/search', params: { cat: album.genre } }) }} />
              )}
              {!!album.occasion && (
                <Chip label={album.occasion.name} onPress={() => { setInfo(false); router.push(`/occasions/${album.occasion!.slug}` as any) }} />
              )}
              {(album.autoTags || []).map((t: string) => <Chip key={t} label={t} icon={Sparkles} />)}
            </ChipRow>
          </>
        )}
      </Sheet>
      {sharing && (
        <ShareSheet
          item={{ kind: 'post', id: album.id, providerId: album.providerId ?? owner.providerId, title: album.title, subtitle: owner.name, image: album.cover ?? photo?.src }}
          onClose={() => setSharing(false)}
        />
      )}
    </View>
  )
}

// One album: its photos side by side (horizontal paging).
function AlbumPage({ album, width, height, start, onPhoto, onHold, onPost, reduceMotion }: {
  album: Album; width: number; height: number; start: number; onPhoto: (j: number) => void; onHold: (on: boolean) => void
  onPost: (delta: number) => void; reduceMotion: boolean
}) {
  const s = useStyles()
  const listRef = useRef<FlatList<ViewerPhoto>>(null)
  const current = useRef(start)
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const j = Math.round(e.nativeEvent.contentOffset.x / width)
    if (j >= 0 && j < album.photos.length) {
      current.current = j
      onPhoto(j)
    }
  }
  // Screen readers: each photo is one element with Next / Previous photo and post actions
  // (VoiceOver: swipe up or down, then double-tap; TalkBack: the actions menu).
  const n = album.photos.length
  const goPhoto = (delta: number) => {
    const j = current.current + delta
    if (j < 0 || j >= n) return announce(n === 1 ? 'This post has one photo' : delta > 0 ? 'Last photo' : 'First photo')
    listRef.current?.scrollToIndex({ index: j, animated: !reduceMotion })
    current.current = j
    onPhoto(j)
    announce(`Photo ${j + 1} of ${n}`)
  }
  const a11y = (i: number) => ({
    accessible: true,
    accessibilityRole: 'image' as const,
    accessibilityLabel: `${album.title || 'Photo'}${n > 1 ? `, photo ${i + 1} of ${n}` : ''}`,
    accessibilityHint: 'Swipe up or down for the next or previous photo or post',
    accessibilityActions: [
      ...(n > 1 ? [{ name: 'nextPhoto', label: 'Next photo' }, { name: 'prevPhoto', label: 'Previous photo' }] : []),
      { name: 'nextPost', label: 'Next post' },
      { name: 'prevPost', label: 'Previous post' },
    ],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      const a = e.nativeEvent.actionName
      if (a === 'nextPhoto') goPhoto(1)
      else if (a === 'prevPhoto') goPhoto(-1)
      else if (a === 'nextPost') onPost(1)
      else if (a === 'prevPost') onPost(-1)
    },
  })
  return (
    <View style={{ width, height }}>
      <FlatList
        ref={listRef}
        data={album.photos as ViewerPhoto[]}
        keyExtractor={(p) => photoKey(p)!}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={Math.min(start, album.photos.length - 1)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={onScroll}
        onScrollEndDrag={onScroll}
        windowSize={3}
        initialNumToRender={1}
        renderItem={({ item, index: i }) => <ZoomablePhoto uri={item.src} width={width} height={height} onHold={onHold} a11y={a11y(i)} />}
        style={s.flex}
      />
    </View>
  )
}

// Pinch to zoom in (springs back on release); press and hold hides the overlays.
function ZoomablePhoto({ uri, width, height, onHold, a11y }: { uri: string; width: number; height: number; onHold: (on: boolean) => void; a11y?: object }) {
  const scale = useSharedValue(1)
  const fx = useSharedValue(0)
  const fy = useSharedValue(0)
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      fx.value = e.focalX - width / 2
      fy.value = e.focalY - height / 2
    })
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, e.scale))
    })
    .onEnd(() => {
      scale.value = withSpring(1, { damping: 18, stiffness: 200 })
    })
  const hold = Gesture.LongPress()
    .minDuration(220)
    .maxDistance(10)
    .onStart(() => runOnJS(onHold)(true))
    .onFinalize(() => runOnJS(onHold)(false))
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: fx.value }, { translateY: fy.value },
      { scale: scale.value },
      { translateX: -fx.value }, { translateY: -fy.value },
    ],
  }))
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, hold)}>
      <Animated.View style={[{ width, height, justifyContent: 'center' }, style]} {...a11y}>
        <Photo uri={uri} style={[StyleSheet.absoluteFill, { backgroundColor: "transparent" }]} contentFit="contain" />
      </Animated.View>
    </GestureDetector>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: '#080808' },
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  white: { color: '#fff' },
  dim: { color: 'rgba(255,255,255,0.72)' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  iconBtn: { padding: 7, borderRadius: 999 },
  count: { backgroundColor: 'rgba(0,0,0,0.45)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, marginRight: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 48, gap: 6 },
  dots: { flexDirection: 'row', gap: 5, alignSelf: 'center', marginBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#fff' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icons: { flexDirection: 'row', alignItems: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 2 },
  exif: { color: 'rgba(255,255,255,0.75)', fontFamily: 'monospace' },
  book: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.25)' },
  hint: { position: 'absolute', top: '42%', alignSelf: 'center', backgroundColor: 'rgba(17,17,17,0.75)', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  section: { marginTop: 20, marginBottom: 8 },
  exifGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  exifCell: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  exifWide: { width: '100%' },
}))
