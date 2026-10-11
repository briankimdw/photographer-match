// A section title with an optional subtitle and "See all" link (the web's .section-head).
import { ChevronRight } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { makeStyles, useTheme } from '@/theme'
import { Text } from './Text'

export function SectionHeader({ title, sub, onSeeAll, seeAllLabel = 'See all' }: { title: string; sub?: string; onSeeAll?: () => void; seeAllLabel?: string }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={s.head}>
      <View style={s.grow}>
        <Text variant="h4" style={{ fontSize: 16 }} accessibilityRole="header">{title}</Text>
        {!!sub && <Text variant="tiny" muted>{sub}</Text>}
      </View>
      {onSeeAll && (
        <Pressable onPress={onSeeAll} hitSlop={{ top: 13, bottom: 13, left: 10, right: 10 }} style={s.link} accessibilityRole="link" accessibilityLabel={`${seeAllLabel}: ${title}`}>
          <Text variant="small" muted maxFontSizeMultiplier={1.6}>{seeAllLabel}</Text>
          <ChevronRight size={14} color={c.muted} />
        </Pressable>
      )}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, paddingHorizontal: t.space.lg, paddingBottom: 10, paddingTop: 22 },
  grow: { flex: 1 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2 },
}))
