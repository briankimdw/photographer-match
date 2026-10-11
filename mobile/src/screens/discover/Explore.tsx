// Discover -> "Explore": a Pinterest-style two-column masonry of real portfolio photos
// across every vertical (native port of frontend/src/components/discover/Explore.jsx).
// Chips filter by vertical and service (kept in the route params ?v= / ?s=); tap a photo
// to open it in its album, tap the name to open the vendor. Pages in 24 at a time as you scroll.
// Data + shaping: the shared api/home.js (listExplorePhotos, buildExploreTiles, exploreFilters, masonry).
import { useRouter } from 'expo-router'
import { ImageOff, Search as SearchIcon } from 'lucide-react-native'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { buildExploreTiles, exploreFilters, listBrowseProviders, listExplorePhotos, masonry } from '@shared/api/home.js'
import { invalidate } from '@shared/api/catalog.js'
import { Avatar, Button, Chip, EmptyState, ErrorState, Photo, Text, iconByName } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { IMAGE_BUTTON_ROLE } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'
import type { Provider, Vertical } from '@/types'
import { DiscoverHeader, PillButton } from './DiscoverHeader'

const PAGE = 24
const GAP = 8
const SIDE = 12

type Tile = { id: string; src: string; ratio: number; albumId: string; title?: string; provider: Provider }

export function Explore({ tabs, vertical, service }: { tabs: ReactNode; vertical: string | null; service: string | null }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const { width } = useWindowDimensions()
  const scroller = useRef<ScrollView>(null)

  const photos = useQuery<any[]>(() => listExplorePhotos({ limit: 200 }), [])
  const providers = useQuery<Provider[]>(() => listBrowseProviders(), [user?.id])
  const ready = !!photos.data && !!providers.data
  const error = photos.error || providers.error
  const filters = ready
    ? (exploreFilters({ photos: photos.data, providers: providers.data, vertical } as any) as { verticals: Vertical[]; services: { slug: string; name: string }[] })
    : { verticals: [] as Vertical[], services: [] as { slug: string; name: string }[] }
  const tiles: Tile[] = ready ? (buildExploreTiles({ photos: photos.data, providers: providers.data, vertical, service } as any) as Tile[]) : []

  const [shown, setShown] = useState(PAGE)
  useEffect(() => {
    setShown(PAGE)
    scroller.current?.scrollTo({ y: 0, animated: false })
  }, [vertical, service])
  const more = tiles.length > shown
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    if (more && contentOffset.y + layoutMeasurement.height > contentSize.height - 600) setShown((n) => n + PAGE)
  }

  const setFilter = (key: 'v' | 's', value: string | null) =>
    router.setParams((key === 'v' ? { v: value ?? undefined, s: undefined } : { s: value ?? undefined }) as any)
  const refresh = () => {
    invalidate('home:explore')
    photos.reload()
    providers.reload()
  }

  const colWidth = Math.floor((Math.min(width, 700) - SIDE * 2 - GAP) / 2)
  const columns = masonry(tiles.slice(0, shown), 2) as Tile[][]
  const showVerticalChips = filters.verticals.length > 1

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <DiscoverHeader tabs={tabs} right={<PillButton icon={SearchIcon} label="Search" onPress={() => router.push('/search')} />} />

      <ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={200}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={c.muted} colors={[c.ink]} progressBackgroundColor={c.card} />}
        contentContainerStyle={s.content}
      >
        {(showVerticalChips || filters.services.length > 0) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} accessibilityLabel="Filter photos">
            <Chip label="All" toggle on={!vertical && !service} onPress={() => setFilter('v', null)} />
            {showVerticalChips && filters.verticals.map((v) => (
              <Chip
                key={v.slug}
                label={v.name}
                icon={iconByName(v.icon)}
                iconTint={v.tint}
                toggle
                on={vertical === v.slug}
                onPress={() => setFilter('v', vertical === v.slug ? null : v.slug)}
              />
            ))}
            {showVerticalChips && filters.services.length > 0 && <View style={s.divider} />}
            {filters.services.map((x) => (
              <Chip key={x.slug} label={x.name} toggle on={service === x.slug} onPress={() => setFilter('s', service === x.slug ? null : x.slug)} />
            ))}
          </ScrollView>
        )}

        {error && <ErrorState error={error} onRetry={refresh} />}
        {!ready && !error && <GridSkeleton width={colWidth} />}
        {ready && tiles.length === 0 && (
          <EmptyState
            icon={ImageOff}
            title="No photos here yet"
            text="New work shows up as soon as vendors post it."
            action={(vertical || service) ? <Button title="See everything" variant="ghost" size="sm" onPress={() => setFilter('v', null)} /> : undefined}
          />
        )}

        {tiles.length > 0 && (
          <View style={s.masonry}>
            {columns.map((col, i) => (
              <View key={i} style={[s.col, { width: colWidth }]}>
                {col.map((t) => (
                  <ExploreTile
                    key={t.id}
                    t={t}
                    width={colWidth}
                    onOpen={() => router.push({ pathname: '/gallery/[personId]', params: { personId: t.provider.id, post: t.albumId, photo: t.id } })}
                    onOpenProvider={() => router.push(`/u/${t.provider.id}`)}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
        {ready && tiles.length > 0 && !more && <Text variant="tiny" muted center style={s.end}>You’re all caught up</Text>}
      </ScrollView>
    </SafeAreaView>
  )
}

function ExploreTile({ t, width, onOpen, onOpenProvider }: { t: Tile; width: number; onOpen: () => void; onOpenProvider: () => void }) {
  const s = useStyles()
  const p = t.provider
  return (
    <View>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [s.tileImg, pressed && s.pressed]}
        accessibilityRole={IMAGE_BUTTON_ROLE}
        accessibilityLabel={`${t.title || 'Photo'} by ${p.name}`}
      >
        <Photo uri={t.src} style={{ width, height: Math.round(width * t.ratio) }} />
      </Pressable>
      <Pressable onPress={onOpenProvider} style={s.cap} accessibilityRole="link" accessibilityLabel={p.name}>
        <Avatar uri={p.avatar} name={p.name} size={22} />
        <Text variant="tiny" weight="600" numberOfLines={1} style={s.grow}>{p.name}</Text>
      </Pressable>
    </View>
  )
}

// Grey masonry blocks while photos load.
function GridSkeleton({ width }: { width: number }) {
  const s = useStyles()
  const heights = [[220, 160, 240], [170, 230, 190]]
  return (
    <View style={s.masonry} accessibilityElementsHidden>
      {heights.map((col, i) => (
        <View key={i} style={[s.col, { width }]}>
          {col.map((h, j) => <View key={j} style={[s.skel, { height: h }]} />)}
        </View>
      ))}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  content: { paddingBottom: t.space.xxl },
  chips: { flexDirection: 'row', gap: 6, paddingHorizontal: t.space.lg, paddingTop: 2, paddingBottom: 10, alignItems: 'center' },
  divider: { width: 1, alignSelf: 'stretch', marginVertical: 4, marginHorizontal: 2, backgroundColor: t.c.line },
  masonry: { flexDirection: 'row', gap: GAP, paddingHorizontal: SIDE, alignItems: 'flex-start' },
  col: { gap: 12 },
  tileImg: { borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.c.soft },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  cap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 2 },
  grow: { flex: 1, minWidth: 0 },
  skel: { borderRadius: t.radius.lg, backgroundColor: t.c.soft },
  end: { paddingTop: 20, paddingBottom: 8 },
}))
