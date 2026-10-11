// While posting / posted / failed (native port of the web's components/upload/PostingStatus.jsx).
import { useRouter } from 'expo-router'
import { AlertCircle, Check, RotateCcw, Sparkles } from 'lucide-react-native'
import { ActivityIndicator, View } from 'react-native'

import { Button, Photo, Text } from '@/components'
import { makeStyles, useTheme } from '@/theme'
import type { PhotoItem } from './usePhotoItems'

export type PhotoProgress = { stage: 'preparing' | 'uploading' | 'saving' | 'done'; fraction: number }

// Overall progress, weighting each photo by how much has to be uploaded.
export function overallFraction(items: PhotoItem[], perPhoto: (PhotoProgress | undefined)[]) {
  let sum = 0
  let total = 0
  items.forEach((it, i) => {
    const w = it.size + 400_000 // the original plus roughly its public copy
    total += w
    sum += w * (perPhoto[i]?.fraction ?? 0)
  })
  return total ? sum / total : 0
}

export function Posting({ items, perPhoto, kindLabel }: { items: PhotoItem[]; perPhoto: (PhotoProgress | undefined)[]; kindLabel: string }) {
  const s = useStyles()
  const { c } = useTheme()
  const done = perPhoto.filter((p) => p?.stage === 'done').length
  const pct = Math.round(overallFraction(items, perPhoto) * 100)
  const cover = items[0]
  return (
    <View style={s.wrap} accessibilityLiveRegion="polite">
      <View style={s.cover}>{!!cover?.thumbUrl && <Photo uri={cover.thumbUrl} style={s.fill} />}</View>
      <Text variant="h3" center>Sharing your {kindLabel}…</Text>
      <Text variant="small" muted center>
        {done === items.length ? 'Finishing up…' : items.length > 1 ? `Uploading photo ${Math.min(done + 1, items.length)} of ${items.length}` : 'Uploading'} · {pct}%
      </Text>
      <View style={s.bar} accessibilityRole="progressbar" accessibilityLabel="Posting" accessibilityValue={{ min: 0, max: 100, now: pct }}>
        <View style={[s.barFill, { width: `${Math.max(2, pct)}%` }]} />
      </View>
      {items.length > 1 && (
        <View style={s.thumbs}>
          {items.map((it, i) => {
            const p = perPhoto[i]
            const state = p?.stage === 'done' ? 'done' : p ? 'active' : 'waiting'
            return (
              <View key={it.id} style={[s.thumb, state === 'waiting' && s.waiting]}>
                {!!it.thumbUrl && <Photo uri={it.thumbUrl} style={s.fill} />}
                <View style={s.thumbState}>
                  {state === 'done' ? <Check size={14} strokeWidth={3} color="#fff" /> : state === 'active' ? <ActivityIndicator size="small" color="#fff" /> : null}
                </View>
              </View>
            )
          })}
        </View>
      )}
      <Text variant="tiny" muted center>Keep this screen open until it’s done.</Text>
    </View>
  )
}

export function Posted({ cover, kindLabel, providerId, albumId, onAnother }: { cover?: string | null; kindLabel: string; providerId: string; albumId: string; onAnother: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  return (
    <View style={s.wrap}>
      <View style={[s.check, { backgroundColor: c.ok }]}><Check size={30} strokeWidth={3} color={c.onAccent} /></View>
      <Text variant="h3" center>Posted</Text>
      <Text variant="small" muted center>Your {kindLabel} is live on your profile.</Text>
      {!!cover && <Photo uri={cover} style={s.result} />}
      <View style={s.note}>
        <Sparkles size={16} color={c.ink} />
        <Text variant="small" style={s.grow}>Style tags appear shortly, once your photos have been looked at.</Text>
      </View>
      <Button title="View post" variant="accent" block onPress={() => router.replace({ pathname: '/gallery/[personId]', params: { personId: providerId, post: albumId } })} />
      <Button title="Post another" variant="ghost" block onPress={onAnother} />
      <Button title="Go to my work" variant="link" size="sm" onPress={() => router.replace('/my-work')} style={s.center} />
    </View>
  )
}

export function PostFailed({ error, onRetry, onEdit }: { error: string; onRetry: () => void; onEdit: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={s.wrap} accessibilityRole="alert">
      <View style={[s.check, { backgroundColor: c.dangerSoft }]}><AlertCircle size={30} color={c.danger} /></View>
      <Text variant="h3" center>Couldn’t post</Text>
      <Text variant="small" color="danger" center>{error}</Text>
      <Text variant="small" muted center>Nothing was published. Your photos and details are still here.</Text>
      <Button title="Try again" icon={RotateCcw} variant="accent" block onPress={onRetry} />
      <Button title="Back to editing" variant="ghost" block onPress={onEdit} />
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  wrap: { padding: t.space.xl, gap: 12, alignItems: 'center' },
  grow: { flex: 1 },
  center: { alignSelf: 'center' },
  fill: { width: '100%', height: '100%' },
  cover: { width: 140, height: 140, borderRadius: t.radius.xl, overflow: 'hidden', backgroundColor: t.c.soft, marginBottom: 8 },
  bar: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: t.c.soft, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: t.c.accent, borderRadius: 4 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  thumb: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden', backgroundColor: t.c.soft },
  waiting: { opacity: 0.45 },
  thumbState: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  check: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  result: { width: '100%', aspectRatio: 1, borderRadius: t.radius.lg },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: t.radius.md, backgroundColor: t.c.soft, alignSelf: 'stretch' },
}))
