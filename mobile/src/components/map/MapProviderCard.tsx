// The compact card for the provider tapped on the map (the web ProviderMap's .pm-card):
// who they are, price, where they're based and how far they travel, View profile / Book.
import { useRouter } from 'expo-router'
import { X } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { fmtKm } from '@shared/api/locations.js'
import { fromPriceLabel } from '@shared/lib/format.js'
import { useFocusOnShow } from '@/lib/a11y'
import { makeStyles, useTheme, useReadableTint } from '@/theme'
import type { Provider } from '@/types'
import { Avatar } from '../Avatar'
import { IdVerified, InA11yGroup, ProBadge, RatingInline } from '../Badges'
import { Button } from '../Button'
import { providerA11yLabel } from '../ProviderCard'
import { Text } from '../Text'
import { VerticalIcon } from '../VerticalIcon'

export type MapProvider = Provider & { location: { lat: number; lng: number }; distanceKm?: number | null }

type Props = { provider: MapProvider; dates?: string; showVertical?: boolean; onClose?: () => void; floating?: boolean }

export function MapProviderCard({ provider: p, dates, showVertical, onClose, floating = true }: Props) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const price = fromPriceLabel(p)
  const inside = p.distanceKm != null && p.radiusKm != null ? p.distanceKm <= p.radiusKm : null
  const tint = p.verticalInfo?.tint || c.accent
  const params = dates ? { dates } : {}
  const openProfile = () => router.push({ pathname: '/u/[id]', params: { id: p.id, ...params } })
  const readable = useReadableTint()
  // Tapping a pin moves the screen-reader cursor to this card.
  const focusRef = useFocusOnShow(true, 500)
  const area = `${p.city ? `${p.city.split(',')[0]}, ` : ''}travels up to ${p.radiusKm ?? 0} km${p.distanceKm != null ? `, ${fmtKm(p.distanceKm)} from you` : ''}${inside != null ? `, ${inside ? 'travels to you' : 'outside their area'}` : ''}`
  return (
    <InA11yGroup value>
    <View style={[s.card, floating && s.floating]}>
      {onClose && (
        <Pressable onPress={onClose} style={s.close} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Close ${p.name}`}>
          <X size={16} color={c.muted} />
        </Pressable>
      )}
      <Pressable
        ref={focusRef}
        onPress={openProfile}
        style={s.top}
        accessibilityRole="link"
        accessibilityLabel={providerA11yLabel(p, [showVertical && !(p as any).verticalInfo?.noun && p.verticalInfo?.name])}
        accessibilityHint="Opens their profile"
      >
        <Avatar uri={p.avatar} name={p.name} size={48} />
        <View style={s.grow}>
          <View style={s.nameRow}>
            <Text variant="body" weight="700" numberOfLines={1} style={s.shrink}>{p.name}</Text>
            {p.idVerified && <IdVerified />}
            {p.pro && <ProBadge />}
          </View>
          <View style={s.meta}>
            <RatingInline rating={p.rating} count={p.rating != null ? p.reviewCount : undefined} />
            {!!price && <Text variant="tiny" weight="600">· {price}</Text>}
          </View>
          {showVertical && p.verticalInfo && (
            <View style={s.meta}>
              <VerticalIcon name={p.verticalInfo.icon} size={12} tint={p.verticalInfo.tint} />
              <Text variant="tiny" style={{ color: readable(p.verticalInfo.tint) }} weight="600">{p.verticalInfo.name}</Text>
            </View>
          )}
          {p.specialties.length > 0 && <Text variant="tiny" muted numberOfLines={1}>{p.specialties.join(' · ')}</Text>}
        </View>
      </Pressable>
      <View style={s.area} accessible accessibilityLabel={area}>
        <View style={[s.dot, { borderColor: tint, backgroundColor: `${tint}26` }]} />
        <View style={s.grow}>
          <Text variant="tiny">{p.city ? `${p.city.split(',')[0]} · ` : ''}travels up to {p.radiusKm ?? 0} km</Text>
          {p.distanceKm != null && (
            <Text variant="tiny" muted>
              {fmtKm(p.distanceKm)} from you
              {inside != null && <Text variant="tiny" weight="700" style={{ color: inside ? c.ok : c.muted }}> · {inside ? 'Travels to you' : 'Outside their area'}</Text>}
            </Text>
          )}
        </View>
      </View>
      <View style={s.actions}>
        <Button title="View profile" variant="ghost" grow onPress={openProfile} />
        <Button title="Book" accessibilityLabel={`Book ${p.name}`} variant="accent" grow onPress={() => router.push({ pathname: '/book/[providerId]', params: { providerId: p.id, ...params } })} />
      </View>
    </View>
    </InA11yGroup>
  )
}

const useStyles = makeStyles((t) => ({
  card: { backgroundColor: t.c.bg, borderRadius: t.radius.xl, padding: 14, gap: 10, borderWidth: 1, borderColor: t.c.line },
  floating: {
    position: 'absolute', left: 12, right: 12, bottom: 12,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  close: { position: 'absolute', top: 8, right: 8, padding: 6, zIndex: 2 },
  top: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingRight: 24 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  shrink: { flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  area: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.c.soft, borderRadius: t.radius.md, padding: 10 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  actions: { flexDirection: 'row', gap: 8 },
}))
