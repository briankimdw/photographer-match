// /gallery/[personId]?post=<album id>&photo=<photo id>: native port of the web Gallery.jsx.
// personId: provider id, the owner's profile id or slug. Loads the provider and their
// albums (shared getProvider + listAlbums/toViewerAlbum) and opens the full-screen viewer.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { ImageOff, X } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { getProvider } from '@shared/api/catalog.js'
import { listAlbums, toViewerAlbum } from '@shared/api/portfolio.js'
import { callName, money, startingPrice } from '@shared/lib/format.js'
import { Button, EmptyState, ErrorState, Loading } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { makeStyles } from '@/theme'
import type { Provider } from '@/types'
import type { Album } from '../profile/AlbumGrid'
import { AlbumViewer } from './AlbumViewer'

const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v)

async function loadGallery(personId: string): Promise<{ provider: Provider; albums: Album[] } | null> {
  const provider = (await getProvider(personId)) as Provider | null
  if (!provider) return null
  const rows = await listAlbums(provider.id)
  return { provider, albums: rows.filter((a: any) => a.photos?.length).map(toViewerAlbum) }
}

// Dark, full-screen, fading in over the screen it was opened from.
export const galleryScreenOptions = { animation: 'fade', contentStyle: { backgroundColor: '#080808' } } as const

export default function Gallery() {
  const router = useRouter()
  const params = useLocalSearchParams<{ personId: string; post?: string; photo?: string }>()
  const personId = one(params.personId) || ''
  const { user } = useAuth()
  const { data, loading, error, reload } = useQuery(() => loadGallery(personId), [personId])

  if (loading) return <GalleryState><Loading /></GalleryState>
  if (error) return <GalleryState close><ErrorState error={error} onRetry={reload} /></GalleryState>
  if (!data || !data.albums.length) {
    return (
      <GalleryState close fallback={data ? `/u/${data.provider.id}` : '/'}>
        <EmptyState
          icon={ImageOff}
          title={data ? 'No albums yet' : 'Portfolio not found'}
          text={data ? `${data.provider.name} hasn’t posted any work yet.` : 'This profile doesn’t exist or is no longer listed.'}
          action={<Button title={data ? 'View profile' : 'Go home'} size="sm" onPress={() => router.replace(data ? `/u/${data.provider.id}` : '/')} />}
        />
      </GalleryState>
    )
  }

  const { provider: p, albums } = data
  const isMine = !!user && p.profileId === user.id
  const from = startingPrice(p)
  return (
    <>
      <Stack.Screen options={galleryScreenOptions} />
      <AlbumViewer
        albums={albums}
        owner={{ name: p.name, avatar: p.avatar, idVerified: p.idVerified, pro: p.pro, username: p.username, providerId: p.id }}
        book={isMine ? null : {
          label: `Book ${(p as any).shortName || callName(p.name)}`,
          line: `${from != null ? `from ${money(from)}` : 'Custom quote'} · ${p.rating != null ? `★ ${p.rating.toFixed(1)}` : 'New'}`,
          onPress: () => router.push({ pathname: '/book/[providerId]', params: { providerId: p.id } }),
          onLine: () => router.push({ pathname: '/u/[id]', params: { id: p.id, tab: p.rating != null ? 'reviews' : 'packages' } }),
        }}
        startPost={one(params.post)}
        startPhoto={one(params.photo)}
      />
    </>
  )
}

// Loading / error / empty states on the dark gallery background, with a close button.
export function GalleryState({ children, close = false, fallback = '/' }: { children: React.ReactNode; close?: boolean; fallback?: string }) {
  const s = useStyles()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View style={s.root}>
      <Stack.Screen options={galleryScreenOptions} />
      {close && (
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as any))}
          style={[s.close, { top: insets.top + 6 }]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <X size={24} color="#fff" />
        </Pressable>
      )}
      <View style={s.card}>{children}</View>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: '#080808', justifyContent: 'center', padding: 16 },
  close: { position: 'absolute', left: 8, padding: 7, zIndex: 2 },
  card: { backgroundColor: t.c.bg, borderRadius: t.radius.xl, overflow: 'hidden' },
}))
