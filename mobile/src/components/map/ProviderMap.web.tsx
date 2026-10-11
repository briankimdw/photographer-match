// Web-target fallback for ProviderMap: react-native-maps has no web support, so the
// browser preview shows the providers that would be pinned, as a list with where
// they're based and how far they travel. Tap one for the same card as the map.
import { MapPin } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { fmtKm } from '@shared/api/locations.js'
import { nounFor } from '@shared/verticals/index.js'
import { makeStyles, useTheme } from '@/theme'
import { Avatar } from '../Avatar'
import { providerA11yLabel } from '../ProviderCard'
import { Text } from '../Text'
import { MapProviderCard } from './MapProviderCard'
import type { ProviderMapProps } from './types'

export default function ProviderMap({ providers, focusId, dates, vertical = null, onSelect, style }: ProviderMapProps) {
  const s = useStyles()
  const { c } = useTheme()
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null)
  const selected = providers.find((p) => p.id === selectedId) || null
  const pick = (id: string | null) => {
    setSelectedId(id)
    onSelect?.(id)
  }
  return (
    <View style={[s.wrap, style]}>
      <View style={s.notice}>
        <MapPin size={16} color={c.muted} />
        <Text variant="small" muted style={s.grow}>The map opens in the iOS and Android app. Here’s where these {nounFor(vertical, 2)} are based.</Text>
      </View>
      <ScrollView contentContainerStyle={s.list}>
        {providers.map((p) => (
          <Pressable key={p.id} onPress={() => pick(p.id === selectedId ? null : p.id)} style={[s.row, p.id === selectedId && s.on]} accessibilityRole="button" accessibilityLabel={providerA11yLabel(p)} accessibilityState={{ selected: p.id === selectedId }}>
            <View style={[s.ring, { borderColor: p.verticalInfo?.tint || c.ink }]}>
              <Avatar uri={p.avatar} name={p.name} size={34} />
            </View>
            <View style={s.grow}>
              <Text variant="small" weight="600" numberOfLines={1}>{p.name}</Text>
              <Text variant="tiny" muted numberOfLines={1}>
                {p.city ? `${p.city.split(',')[0]} · ` : ''}travels up to {p.radiusKm ?? 0} km{p.distanceKm != null ? ` · ${fmtKm(p.distanceKm)} away` : ''}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      {selected && <MapProviderCard key={selected.id} provider={selected} dates={dates} showVertical={!vertical} onClose={() => pick(null)} />}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  wrap: { flex: 1, minHeight: 320, backgroundColor: t.c.soft },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: t.c.line },
  list: { padding: 12, gap: 8, paddingBottom: 240 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: t.radius.lg, backgroundColor: t.c.bg },
  on: { borderWidth: 1, borderColor: t.c.ink },
  ring: { borderWidth: 2, borderRadius: 999, padding: 1 },
  grow: { flex: 1, minWidth: 0 },
}))
