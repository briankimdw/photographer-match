// The swipe deck's "which kind of work" switch (the web's components/discover/VerticalPicker.jsx):
// a tinted chip that opens a sheet listing the visual verticals; ones without providers
// yet are shown under "Coming soon" and can't be picked.
import { Check, ChevronDown } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { Loading, Sheet, Text, VerticalIcon } from '@/components'
import { makeStyles, useReadableTint, useTheme } from '@/theme'
import type { Vertical } from '@/types'

export type PickableVertical = Vertical & { count: number }

export function VerticalPickerChip({ vertical, onPress }: { vertical: Vertical; onPress: () => void }) {
  const s = useStyles()
  const readable = useReadableTint()
  const ink = readable(vertical.tint, 5) // 5:1 against the page, so 4.5:1+ on the 10% tinted chip
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, { borderColor: `${vertical.tint}4d`, backgroundColor: `${vertical.tint}1a` }]}
      accessibilityRole="button"
      accessibilityLabel={`Showing ${vertical.name}`}
      accessibilityHint="Choose another kind of work"
    >
      <VerticalIcon name={vertical.icon} size={14} color={ink} />
      <Text variant="small" weight="600" style={{ color: ink }} maxFontSizeMultiplier={1.6}>{vertical.name}</Text>
      <ChevronDown size={14} color={ink} />
    </Pressable>
  )
}

type SheetProps = { open: boolean; onClose: () => void; verticals: PickableVertical[]; loading: boolean; value: string; onPick: (slug: string) => void }

export function VerticalPickerSheet({ open, onClose, verticals, loading, value, onPick }: SheetProps) {
  const s = useStyles()
  const { c } = useTheme()
  const live = verticals.filter((v) => v.count > 0)
  const soon = verticals.filter((v) => !v.count)
  return (
    <Sheet open={open} onClose={onClose} title="Swipe through">
      {loading ? (
        <Loading inline />
      ) : (
        <>
          <View accessibilityRole="list">
            {live.map((v) => {
              const on = v.slug === value
              return (
                <Pressable key={v.slug} onPress={() => onPick(v.slug)} style={[s.row, on && s.rowOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <VerticalIcon name={v.icon} tint={v.tint} size={18} bubble bubbleSize={40} />
                  <View style={s.grow}>
                    <Text variant="body" weight="700">{v.name}</Text>
                    <Text variant="tiny" muted>{v.count} {v.count === 1 ? v.noun : v.plural.toLowerCase()}</Text>
                  </View>
                  {on && <Check size={18} color={c.ink} />}
                </Pressable>
              )
            })}
          </View>
          {soon.length > 0 && (
            <>
              <Text variant="label" style={s.label}>Coming soon</Text>
              <View style={s.soonGrid}>
                {soon.map((v) => (
                  <View key={v.slug} style={s.soonItem} accessibilityState={{ disabled: true }}>
                    <View style={s.faded}><VerticalIcon name={v.icon} tint={v.tint} size={14} bubble bubbleSize={30} /></View>
                    <Text variant="small" muted numberOfLines={1} style={s.grow}>{v.name}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </Sheet>
  )
}

const useStyles = makeStyles((t) => ({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, minHeight: 34, borderRadius: 999, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: t.radius.lg, minHeight: 56 },
  rowOn: { backgroundColor: t.c.soft },
  grow: { flex: 1, minWidth: 0 },
  label: { marginTop: 16, marginBottom: 8 },
  soonGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  soonItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  faded: { opacity: 0.7 },
}))
