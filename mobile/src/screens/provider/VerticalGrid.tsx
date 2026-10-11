// Every vertical as a grid of icons, grouped (the web's VerticalGrid in
// components/verticals/VerticalSwitcher.jsx). For "What do you offer?".
//   value: slug; onChange(slug); live: slugs the database has (others say "Soon");
//   taken: slugs the user already has a listing for (disabled, "Listed").
import { Pressable, View } from 'react-native'

import { GROUPS, verticalsInGroup } from '@shared/verticals/index.js'
import { Text, VerticalIcon } from '@/components'
import { makeStyles, useTheme } from '@/theme'

type Props = { value: string | null; onChange: (slug: string) => void; live: Set<string> | null; taken?: Set<string> }

export default function VerticalGrid({ value, onChange, live, taken }: Props) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={s.groups}>
      {GROUPS.map((g) => (
        <View key={g.slug}>
          <Text variant="label" style={s.groupName}>{g.name}</Text>
          <View style={s.grid}>
            {verticalsInGroup(g.slug).map((v) => {
              const soon = !!live && !live.has(v.slug)
              const mine = !!taken?.has(v.slug)
              const on = value === v.slug
              return (
                <Pressable
                  key={v.slug}
                  disabled={mine}
                  onPress={() => onChange(v.slug)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: mine }} aria-checked={on}
                  accessibilityLabel={`${v.name}${mine ? ', already listed' : soon ? ', coming soon' : ''}`}
                  style={({ pressed }) => [s.item, on && { borderColor: v.tint, backgroundColor: `${v.tint}14` }, (mine || soon) && s.dim, pressed && { opacity: 0.7 }]}
                >
                  <VerticalIcon name={v.icon} tint={v.tint} size={20} bubble bubbleSize={40} />
                  <Text variant="tiny" weight="600" center numberOfLines={2}>{v.name}</Text>
                  {mine ? <Text variant="caption" muted>Listed</Text> : soon ? <Text variant="caption" style={{ color: c.warn }}>Soon</Text> : null}
                </Pressable>
              )
            })}
          </View>
        </View>
      ))}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  groups: { gap: t.space.lg },
  groupName: { marginBottom: t.space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: {
    width: '31.5%', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 4,
    borderWidth: 1.5, borderColor: t.c.line, borderRadius: t.radius.lg, backgroundColor: t.c.card,
  },
  dim: { opacity: 0.55 },
}))
