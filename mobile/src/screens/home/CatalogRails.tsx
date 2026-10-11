// Catalog rails on Home, mirroring the web's components/home/Browse.jsx:
//   VerticalRail  every vendor type as a tinted icon, two rows scrolling sideways
//                 (row 1 = first half of the catalog, row 2 = the rest) -> /services/[vertical]
//   OccasionRail  "Plan by occasion" cards -> /occasions/[slug]
// Data is the static shared catalog (verticals/catalog.js), so these render instantly.
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, View } from 'react-native'

import { OCCASIONS, VERTICALS } from '@shared/verticals/catalog.js'
import { SectionHeader, Text, VerticalIcon } from '@/components'
import { makeStyles } from '@/theme'
import type { Vertical } from '@/types'

const half = Math.ceil(VERTICALS.length / 2)
const COLUMNS: Vertical[][] = VERTICALS.slice(0, half).map((v: Vertical, i: number) => [v, VERTICALS[half + i]].filter(Boolean))

// counts: Map(vertical slug -> providers) once loaded (used for the accessible label).
export function VerticalRail({ counts }: { counts?: Map<string, number> | null }) {
  const s = useStyles()
  const router = useRouter()
  return (
    <>
      <SectionHeader title="Browse services" sub="Everything for your event, in one place" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.rail, s.railTight]}>
        {COLUMNS.map((col) => (
          <View key={col[0].slug} style={s.column}>
            {col.map((v) => {
              const n = counts?.get(v.slug) || 0
              return (
                <Pressable
                  key={v.slug}
                  onPress={() => router.push(`/services/${v.slug}`)}
                  style={({ pressed }) => [s.item, pressed && s.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${v.name}${counts ? (n ? `, ${n} available` : ', coming soon') : ''}`}
                >
                  <VerticalIcon name={v.icon} tint={v.tint} size={22} bubble bubbleSize={52} />
                  {/* Fixed-width grid cells: past 1.3x, "Photography" would break mid-word. */}
                  <Text variant="tiny" weight="600" center numberOfLines={2} style={s.label} maxFontSizeMultiplier={1.3}>{v.name}</Text>
                </Pressable>
              )
            })}
          </View>
        ))}
      </ScrollView>
    </>
  )
}

export function OccasionRail() {
  const s = useStyles()
  const router = useRouter()
  return (
    <>
      <SectionHeader title="Plan by occasion" sub="A checklist of who you’ll need" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {OCCASIONS.map((o: { slug: string; name: string; icon: string; tint: string; needs: string[] }) => (
          <Pressable
            key={o.slug}
            onPress={() => router.push(`/occasions/${o.slug}`)}
            style={({ pressed }) => [s.occasion, { backgroundColor: `${o.tint}14` }, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${o.name}, ${o.needs.length} vendor types`}
          >
            <VerticalIcon name={o.icon} tint={o.tint} size={18} bubble bubbleSize={40} />
            <Text variant="small" weight="700" numberOfLines={1}>{o.name}</Text>
            <Text variant="tiny" muted>{o.needs.length} vendor types</Text>
          </Pressable>
        ))}
      </ScrollView>
    </>
  )
}

const useStyles = makeStyles((t) => ({
  rail: { paddingHorizontal: t.space.lg, gap: 12 },
  railTight: { gap: 4 },
  column: { gap: 12 },
  // 80 wide fits the longest one-word name ("Transportation") without breaking it mid-word;
  // the label always reserves two lines so both rows of icons stay aligned column to column.
  item: { width: 80, alignItems: 'center', gap: 6 },
  label: { lineHeight: 14, minHeight: 28 },
  occasion: { width: 132, gap: 4, padding: 12, borderRadius: t.radius.lg },
  pressed: { opacity: 0.7 },
}))
