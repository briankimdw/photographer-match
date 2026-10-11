// /my-work: native port of frontend/src/screens/MyWork.jsx. Your own posts: a grid
// to open, reorder (arrows) and manage them. /my-work?post=<album id> shows that
// post with edit / delete (ManagePost). The web opens the full-screen AlbumViewer
// from Gallery.jsx here; this is a simpler owner view of the same album.
// TODO(port): reuse the Gallery album viewer once it's ported (mobile-browse).
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowUpDown, ChevronLeft, ChevronRight, Copy, Ellipsis, ImagePlus, Plus } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { invalidate } from '@shared/api/catalog.js'
import { getMyProvider, listMyAlbums, reorderAlbums, toViewerAlbum } from '@shared/api/portfolio.js'
import { exifLine } from '@shared/lib/format.js'
import { Button, Chip, ChipRow, EmptyState, ErrorState, IconButton, Loading, Photo, Screen, SignInPrompt, Text } from '@/components'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'
import ManagePostSheets, { type ManageSheet, type ViewerAlbum } from './ManagePost'

const STATUS_LABEL: Record<string, string> = { processing: 'Processing', under_review: 'In review', hidden: 'Hidden' }

type Data = { provider: any | null; albums: ViewerAlbum[] }

export default function MyWork() {
  const router = useRouter()
  const { post } = useLocalSearchParams<{ post?: string }>()
  const { user, loading } = useAuth()
  const { myProvider } = useStore()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)
  const selectedId: string | null = myProvider?.id ?? null

  useEffect(() => {
    if (!user) return
    let live = true
    setError(null)
    ;(async () => {
      try {
        const provider = await getMyProvider(user.id, selectedId as any)
        const rows = provider ? await listMyAlbums(provider.id) : []
        if (live) setData({ provider, albums: rows.filter((a: any) => a.photos?.length).map(toViewerAlbum) })
      } catch (e: any) {
        if (live) setError(e)
      }
    })()
    return () => { live = false }
  }, [user, tick, selectedId])

  if (!loading && !user) return <Screen title="My work" back><SignInPrompt title="Sign in to see your work" /></Screen>
  if (error) return <Screen title="My work" back><ErrorState error={error} onRetry={() => setTick((t) => t + 1)} /></Screen>
  if (!data) return <Screen title="My work" back><Loading /></Screen>

  const viewing = post ? data.albums.find((a) => a.id === post) : null
  if (post && viewing) {
    return (
      <PostView
        album={viewing}
        vertical={data.provider?.vertical}
        onUpdated={(a) => setData((d) => d && { ...d, albums: d.albums.map((x) => (x.id === a.id ? a : x)) })}
        onDeleted={(id) => {
          setData((d) => d && { ...d, albums: d.albums.filter((x) => x.id !== id) })
          router.setParams({ post: undefined })
        }}
      />
    )
  }
  return <WorkGrid data={data} setData={setData} />
}

function WorkGrid({ data, setData }: { data: Data; setData: React.Dispatch<React.SetStateAction<Data | null>> }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { toast } = useStore()
  const [order, setOrder] = useState<string[] | null>(null) // album ids while reordering
  const [saving, setSaving] = useState(false)

  if (!data.provider) {
    return (
      <Screen title="My work" back>
        <EmptyState icon={ImagePlus} title="Show clients your work" text="Set up your profile and post your first work."
          action={<Button title="Get started" variant="accent" onPress={() => router.push('/upload')} />} />
      </Screen>
    )
  }

  const { albums } = data
  const byId = new Map(albums.map((a) => [a.id, a]))
  const shown = order ? (order.map((id) => byId.get(id)).filter(Boolean) as ViewerAlbum[]) : albums
  const reordering = !!order

  const move = (from: number, to: number) => {
    if (!order || to < 0 || to >= order.length || from === to) return
    const next = [...order]
    const [id] = next.splice(from, 1)
    next.splice(to, 0, id)
    setOrder(next)
  }

  const saveOrder = async () => {
    if (!order) return
    const changed = order.some((id, i) => id !== albums[i]?.id)
    if (!changed) return setOrder(null)
    setSaving(true)
    try {
      await reorderAlbums(order)
      invalidate('providers')
      setData((d) => d && { ...d, albums: order.map((id) => byId.get(id)!) })
      setOrder(null)
      toast('New order saved')
    } catch (err: any) {
      toast(err?.message || 'Couldn’t save the order. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const right = reordering ? (
    <Button title={saving ? 'Saving…' : 'Done'} variant="link" size="sm" onPress={saveOrder} disabled={saving} />
  ) : (
    <IconButton icon={Plus} label="New post" onPress={() => router.push('/upload')} />
  )

  return (
    <Screen title="My work" subtitle={albums.length ? `${albums.length} post${albums.length === 1 ? '' : 's'}` : undefined} back right={right}>
      {albums.length === 0 ? (
        <EmptyState icon={ImagePlus} title="Nothing posted yet" text="Post your first shoot. Albums, single photos and before / afters all show up here."
          action={<Button title="Post photos" variant="accent" onPress={() => router.push('/upload')} />} />
      ) : (
        <>
          <View style={s.bar}>
            <Text variant="tiny" muted style={s.grow}>{reordering ? 'Use the arrows to set the order clients see.' : 'Tap a post to view, edit or delete it.'}</Text>
            {reordering ? (
              <Button title="Cancel" variant="link" size="sm" onPress={() => setOrder(null)} disabled={saving} />
            ) : albums.length > 1 ? (
              <Button title="Reorder" icon={ArrowUpDown} variant="link" size="sm" onPress={() => setOrder(albums.map((a) => a.id))} />
            ) : null}
          </View>
          <View style={s.grid}>
            {shown.map((a, i) => {
              const inner = (
                <>
                  <Photo uri={a.cover} style={s.fill} />
                  {a.type === 'beforeafter' ? (
                    <View style={s.count}><Text variant="caption" style={s.white}>B/A</Text></View>
                  ) : a.photos.length > 1 ? (
                    <View style={s.count}><Copy size={11} color="#fff" /><Text variant="caption" style={s.white}>{a.photos.length}</Text></View>
                  ) : null}
                  {!!STATUS_LABEL[a.status] && !reordering && <View style={s.status}><Text variant="caption" style={s.white}>{STATUS_LABEL[a.status]}</Text></View>}
                  {!reordering && <View style={s.titleBar}><Text variant="tiny" weight="600" style={s.white} numberOfLines={1}>{a.title}</Text></View>}
                </>
              )
              if (!reordering) {
                return (
                  <Pressable
                    key={a.id}
                    style={s.tile}
                    onPress={() => router.setParams({ post: a.id })}
                    accessibilityRole="button"
                    accessibilityLabel={[a.title || 'Post', a.type === 'beforeafter' ? 'before and after' : a.photos.length > 1 && `${a.photos.length} photos`, STATUS_LABEL[a.status]].filter(Boolean).join(', ')}
                  >
                    {inner}
                  </Pressable>
                )
              }
              return (
                <View key={a.id} style={[s.tile, s.tileReorder]}>
                  {inner}
                  <View style={s.pos}><Text variant="caption" style={{ color: c.onInk }}>{i + 1}</Text></View>
                  <View style={s.arrows}>
                    <Pressable onPress={() => move(i, i - 1)} disabled={i === 0} hitSlop={6} style={[s.arrow, i === 0 && s.off]} accessibilityRole="button" accessibilityLabel={`Move “${a.title}” earlier, now ${i + 1} of ${shown.length}`} accessibilityState={{ disabled: i === 0 }}>
                      <ChevronLeft size={16} color={c.ink} />
                    </Pressable>
                    <Pressable onPress={() => move(i, i + 1)} disabled={i === shown.length - 1} hitSlop={6} style={[s.arrow, i === shown.length - 1 && s.off]} accessibilityRole="button" accessibilityLabel={`Move “${a.title}” later, now ${i + 1} of ${shown.length}`} accessibilityState={{ disabled: i === shown.length - 1 }}>
                      <ChevronRight size={16} color={c.ink} />
                    </Pressable>
                  </View>
                </View>
              )
            })}
          </View>
        </>
      )}
    </Screen>
  )
}

// One of my posts: its photos, details and the manage menu.
function PostView({ album: a, vertical, onUpdated, onDeleted }: { album: ViewerAlbum; vertical?: string; onUpdated: (a: ViewerAlbum) => void; onDeleted: (id: string) => void }) {
  const s = useStyles()
  const router = useRouter()
  const [sheet, setSheet] = useState<ManageSheet>(null)
  const photos = a.photos as { id: string; src: string; beforeSrc?: string; exif?: Record<string, string> }[]
  return (
    <Screen title={a.title} subtitle={[a.genre, a.date].filter(Boolean).join(' · ') || undefined} back
      right={<IconButton icon={Ellipsis} label="Manage post" onPress={() => setSheet('menu')} />}>
      {!!STATUS_LABEL[a.status] && (
        <Pressable onPress={() => router.push({ pathname: '/ai-review/[id]', params: { id: a.id } })} style={s.statusBanner} accessibilityRole="link">
          <Text variant="small" weight="700">{STATUS_LABEL[a.status]}</Text>
          <Text variant="tiny" muted> · Not public yet. Tap for details.</Text>
        </Pressable>
      )}
      {a.type === 'beforeafter' && photos[0] ? (
        <View style={s.photos}>
          <Text variant="label">Before</Text>
          <Photo uri={photos[0].beforeSrc} style={s.photo} contentFit="contain" />
          <Text variant="label">After</Text>
          <Photo uri={photos[0].src} style={s.photo} contentFit="contain" />
        </View>
      ) : (
        <View style={s.photos}>
          {photos.map((p) => (
            <View key={p.id}>
              <Photo uri={p.src} style={s.photo} contentFit="contain" />
              {!!exifLine(p.exif) && <Text variant="tiny" muted style={s.exif}>{exifLine(p.exif)}</Text>}
            </View>
          ))}
        </View>
      )}
      <View style={s.meta}>
        {!!a.caption && <Text>{a.caption}</Text>}
        {!!a.location && <Text variant="small" muted>{a.location}</Text>}
        {a.autoTags?.length > 0 && <ChipRow>{a.autoTags.map((t: string) => <Chip key={t} label={t} />)}</ChipRow>}
      </View>
      <ManagePostSheets album={a} vertical={vertical} sheet={sheet} setSheet={setSheet} onUpdated={onUpdated} onDeleted={onDeleted} />
    </Screen>
  )
}

const useStyles = makeStyles((t) => ({
  grow: { flex: 1 },
  white: { color: '#fff' },
  fill: { width: '100%', height: '100%' },
  off: { opacity: 0.3 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '33.3333%', aspectRatio: 0.8, overflow: 'hidden', backgroundColor: t.c.soft, borderWidth: 1, borderColor: t.c.bg },
  tileReorder: { opacity: 0.95 },
  count: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: t.c.overlay, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  status: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(180,83,9,0.9)', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  titleBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 6, backgroundColor: 'rgba(0,0,0,0.35)' },
  pos: { position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: t.c.ink, alignItems: 'center', justifyContent: 'center' },
  arrows: { position: 'absolute', bottom: 6, left: 6, right: 6, flexDirection: 'row', justifyContent: 'space-between' },
  arrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.c.bg, alignItems: 'center', justifyContent: 'center' },
  statusBanner: { flexDirection: 'row', alignItems: 'center', margin: t.space.lg, marginBottom: 0, padding: 12, borderRadius: t.radius.md, backgroundColor: t.c.accentSoft },
  photos: { gap: 6, paddingTop: t.space.sm },
  photo: { width: '100%', aspectRatio: 0.8, backgroundColor: t.c.soft },
  exif: { paddingHorizontal: t.space.lg, paddingTop: 2 },
  meta: { padding: t.space.lg, gap: 8 },
}))
