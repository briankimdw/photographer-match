// Step 1 of posting (native port of the web's components/upload/PhotoPicker.jsx):
// pick photos with expo-image-picker (multi-select, in tap order), put them in
// order (arrows / "Make cover", since there's no drag on the thumbnails), remove.
// Before/after mode has two slots you can replace or swap.
import * as ImagePicker from 'expo-image-picker'
import { AlertCircle, ArrowLeftRight, ChevronLeft, ChevronRight, ImagePlus, Plus, Star, Trash2, X } from 'lucide-react-native'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'

import { Button, Chip, ChipRow, Photo, Text } from '@/components'
import { MAX_FILE_BYTES, MAX_PHOTOS, formatBytes, type PickedPhoto } from '@/shims/images'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'
import type { PhotoItem, PhotoItems } from './usePhotoItems'

export type PickMode = 'photos' | 'before_after'

// Open the photo library. limit: how many can still be added (multi-select when > 1).
async function pickFromLibrary(limit: number): Promise<PickedPhoto[] | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: Math.max(1, limit),
    orderedSelection: true,
    exif: true, // camera settings; GPS is never read from it
    quality: 1,
  })
  if (result.canceled) return null
  return result.assets as PickedPhoto[]
}

// copy: the vertical's postConfig() (headline and ideas for the empty state).
export default function PhotoPicker({ mode, photos, copy }: { mode: PickMode; photos: PhotoItems; copy?: { headline: string; prompts: string[] } | null }) {
  const s = useStyles()
  const { c } = useTheme()
  const { toast } = useStore()
  const { items, rejected, notice, add, dismissRejected } = photos
  const max = mode === 'before_after' ? 2 : MAX_PHOTOS

  const open = async (at?: number) => {
    try {
      const room = at != null ? 1 : Math.max(1, max - items.length)
      const assets = await pickFromLibrary(room)
      if (assets) add(assets, { max, at })
    } catch (e: any) {
      console.warn(e)
      toast(e?.message || 'Couldn’t open your photos.')
    }
  }

  return (
    <View>
      {(!!notice || rejected.length > 0) && (
        <View style={s.alerts}>
          {!!notice && <View style={s.notice}><Text variant="small">{notice}</Text></View>}
          {rejected.map((r) => (
            <View key={r.id} style={s.rejected} accessibilityRole="alert">
              <AlertCircle size={16} color={c.danger} />
              <View style={s.grow}>
                <Text variant="small" weight="600" numberOfLines={1}>{r.name}</Text>
                <Text variant="tiny">{r.reason}</Text>
              </View>
              <Pressable onPress={() => dismissRejected(r.id)} hitSlop={15} accessibilityRole="button" accessibilityLabel={`Dismiss ${r.name}`}><X size={14} color={c.ink} /></Pressable>
            </View>
          ))}
        </View>
      )}

      {items.length === 0 ? (
        <View style={s.drop}>
          <View style={s.dropIcon}>{mode === 'before_after' ? <ArrowLeftRight size={26} color={c.accent} /> : <ImagePlus size={26} color={c.accent} />}</View>
          <Text variant="h3" center>{mode === 'before_after' ? 'Add a before & after' : copy?.headline || 'Add photos'}</Text>
          <Text variant="small" muted center>
            {mode === 'before_after' ? 'Pick 2 photos: the before, then the after. You can swap them next.' : `One photo, or up to ${MAX_PHOTOS} from the same event.`}
          </Text>
          <Button title={mode === 'before_after' ? 'Choose 2 photos' : 'Choose photos'} variant="accent" onPress={() => open()} style={s.center} />
          <Text variant="tiny" muted center>JPEG, PNG, WebP or HEIC · up to {formatBytes(MAX_FILE_BYTES)} each</Text>
        </View>
      ) : mode === 'before_after' ? (
        <BeforeAfterSlots photos={photos} onPick={(i) => open(i)} />
      ) : (
        <PhotoGrid photos={photos} onAdd={() => open()} />
      )}
      {items.length === 0 && mode !== 'before_after' && !!copy?.prompts?.length && (
        <View style={s.ideas}>
          <Text variant="tiny" muted>Ideas</Text>
          <ChipRow>{copy.prompts.map((t) => <Chip key={t} label={t} />)}</ChipRow>
        </View>
      )}
    </View>
  )
}

function Hero({ item, label }: { item: PhotoItem; label: string | null }) {
  const s = useStyles()
  const { c } = useTheme()
  const ratio = item.width && item.height ? Math.max(0.6, Math.min(1.6, item.width / item.height)) : 0.8
  return (
    <View style={[s.hero, { aspectRatio: ratio }]}>
      {item.status === 'loading' ? (
        <View style={s.heroLoading}><ActivityIndicator color={c.muted} /></View>
      ) : (
        <Photo uri={item.asset.uri} style={s.fill} contentFit="cover" />
      )}
      {!!label && <View style={s.heroBadge}><Text variant="tiny" weight="700" style={s.white}>{label}</Text></View>}
      {item.lowRes && <View style={s.heroWarn}><Text variant="tiny" weight="600" style={s.white}>Low resolution · may look soft</Text></View>}
    </View>
  )
}

function ProcessedLine({ item }: { item: PhotoItem }) {
  if (item.status === 'loading') return <Text variant="tiny" muted>Reading photo…</Text>
  if (!item.processed) return <Text variant="tiny" muted>Preparing the version clients will see…</Text>
  const { width, height, size } = item.processed
  return <Text variant="tiny" muted>Clients see {width} × {height} · {formatBytes(size)} · location data removed</Text>
}

function Tool({ icon: Icon, label, onPress, disabled, danger, wide, fill }: {
  icon: typeof Star; label: string; onPress: () => void; disabled?: boolean; danger?: boolean; wide?: string; fill?: boolean
}) {
  const s = useStyles()
  const { c } = useTheme()
  const color = danger ? c.danger : c.ink
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={({ pressed }) => [s.tool, disabled && s.off, pressed && { opacity: 0.6 }]}>
      <Icon size={16} color={color} fill={fill ? color : 'none'} />
      {!!wide && <Text variant="small" weight="600" style={{ color }}>{wide}</Text>}
    </Pressable>
  )
}

function PhotoGrid({ photos, onAdd }: { photos: PhotoItems; onAdd: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const { items, remove, move } = photos
  const [selId, setSelId] = useState<string | null>(null)
  const selIndex = Math.max(0, items.findIndex((i) => i.id === selId))
  const sel = items[selIndex]
  const last = items.length - 1
  if (!sel) return null

  const removeSel = () => {
    const next = items[selIndex + 1] || items[selIndex - 1]
    remove(sel.id)
    setSelId(next?.id ?? null)
  }

  return (
    <View>
      <Hero item={sel} label={items.length === 1 ? null : selIndex === 0 ? 'Cover' : `${selIndex + 1} of ${items.length}`} />
      <View style={s.tools}>
        {items.length > 1 && (
          <>
            <Tool icon={ChevronLeft} label="Move earlier" onPress={() => move(selIndex, selIndex - 1)} disabled={selIndex === 0} />
            <Tool icon={ChevronRight} label="Move later" onPress={() => move(selIndex, selIndex + 1)} disabled={selIndex === last} />
            <Tool icon={Star} label={selIndex === 0 ? 'Cover photo' : 'Make cover'} wide={selIndex === 0 ? 'Cover photo' : 'Make cover'}
              fill={selIndex === 0} onPress={() => move(selIndex, 0)} disabled={selIndex === 0} />
          </>
        )}
        <View style={s.grow} />
        <Tool icon={Trash2} label="Remove this photo" wide="Remove" danger onPress={removeSel} />
      </View>
      <ProcessedLine item={sel} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
        {items.map((it, i) => (
          <Pressable
            key={it.id}
            onPress={() => setSelId(it.id)}
            style={[s.thumb, it.id === sel.id && s.thumbOn]}
            accessibilityRole="button"
            accessibilityLabel={`Photo ${i + 1} of ${items.length}${i === 0 ? ', cover' : ''}${it.lowRes ? ', low resolution' : ''}`}
            accessibilityState={{ selected: it.id === sel.id }}
          >
            {it.thumbUrl ? <Photo uri={it.thumbUrl} style={s.fill} /> : <View style={[s.fill, s.thumbLoading]} />}
            {items.length > 1 && (
              <View style={s.num}>
                {i === 0 ? <Star size={9} color="#fff" fill="#fff" /> : <Text variant="caption" style={s.white}>{i + 1}</Text>}
              </View>
            )}
            {it.lowRes && <View style={s.warnDot} />}
          </Pressable>
        ))}
        {items.length < MAX_PHOTOS && (
          <Pressable onPress={onAdd} style={[s.thumb, s.addThumb]} accessibilityRole="button" accessibilityLabel="Add more photos">
            <Plus size={20} color={c.ink} />
          </Pressable>
        )}
      </ScrollView>
      <Text variant="tiny" muted>
        {items.length === 1 ? 'Single photo · add more to make an album' : `Album · ${items.length} of ${MAX_PHOTOS} photos · tap one, then use the arrows to reorder`}
      </Text>
    </View>
  )
}

function BeforeAfterSlots({ photos, onPick }: { photos: PhotoItems; onPick: (i: number) => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const { items, remove, swapFirstTwo } = photos
  const [before, after] = items
  const extra = items.length - 2

  const slot = (it: PhotoItem | undefined, i: number, label: string) => (
    <View style={s.slot}>
      <Text variant="label" style={s.slotLabel}>{label}</Text>
      {it ? (
        <View>
          <Pressable onPress={() => onPick(i)} style={s.slotImg} accessibilityRole="button" accessibilityLabel={`Replace the ${label.toLowerCase()} photo`}>
            {it.status === 'loading' ? <ActivityIndicator color={c.muted} /> : <Photo uri={it.asset.uri} style={s.fill} />}
          </Pressable>
          <Pressable onPress={() => remove(it.id)} style={s.slotRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove the ${label.toLowerCase()} photo`}>
            <X size={14} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => onPick(i)} style={[s.slotImg, s.slotEmpty]} accessibilityRole="button" accessibilityLabel={`Add the ${label.toLowerCase()} photo`}>
          <Plus size={20} color={c.ink} />
          <Text variant="small">Add {label.toLowerCase()}</Text>
        </Pressable>
      )}
    </View>
  )

  return (
    <View>
      <View style={s.slots}>
        {slot(before, 0, 'Before')}
        <Pressable onPress={swapFirstTwo} disabled={!after} style={[s.swap, !after && s.off]} accessibilityRole="button" accessibilityLabel="Swap before and after">
          <ArrowLeftRight size={16} color={c.ink} />
        </Pressable>
        {slot(after, 1, 'After')}
      </View>
      {extra > 0 && <View style={[s.notice, s.mtSm]}><Text variant="small">Before / after uses the first 2 photos. Switch to Photos to post all {items.length}.</Text></View>}
      <Text variant="tiny" muted style={s.mtSm}>Tap a photo to replace it. Use ⇆ to swap them.</Text>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  grow: { flex: 1, minWidth: 0 },
  center: { alignSelf: 'center' },
  ideas: { gap: 6, marginTop: 14 },
  mtSm: { marginTop: t.space.sm },
  white: { color: '#fff' },
  fill: { width: '100%', height: '100%' },
  off: { opacity: 0.35 },
  alerts: { gap: 6, marginBottom: t.space.md },
  notice: { padding: 10, borderRadius: t.radius.md, backgroundColor: t.c.soft },
  rejected: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: t.radius.md, backgroundColor: t.c.dangerSoft },
  drop: {
    alignItems: 'center', gap: 10, paddingVertical: 36, paddingHorizontal: 20, borderRadius: t.radius.xl,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.c.line,
  },
  dropIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: t.c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  hero: { width: '100%', borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.c.soft },
  heroLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: t.c.overlay, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  heroWarn: { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(180,83,9,0.9)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: t.space.sm, marginBottom: 4 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 36, borderRadius: 18, backgroundColor: t.c.soft },
  strip: { gap: 6, paddingVertical: t.space.sm },
  thumb: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: t.c.accent },
  thumbLoading: { backgroundColor: t.c.soft },
  addThumb: { backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
  num: { position: 'absolute', top: 3, left: 3, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: t.c.overlay, alignItems: 'center', justifyContent: 'center' },
  warnDot: { position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: t.c.warn },
  slots: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slot: { flex: 1 },
  slotLabel: { marginBottom: 4 },
  slotImg: { width: '100%', aspectRatio: 0.8, borderRadius: t.radius.lg, overflow: 'hidden', backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
  slotEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.c.line, gap: 4 },
  slotRemove: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: t.c.overlay, alignItems: 'center', justifyContent: 'center' },
  swap: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
}))
