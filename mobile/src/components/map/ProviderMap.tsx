// Full-height map of providers (native port of the web's components/ProviderMap.jsx),
// on react-native-maps (Apple Maps on iOS, Google Maps on Android; both work in Expo Go).
//   - round avatar pins where providers are based, ringed in their vertical's tint
//   - tap a pin: their service-radius circle + a card (View profile / Book)
//   - pan or zoom away: a "Search this area" pill; the searched box goes to onAreaChange
//   - locate (asks for location) and "show everyone" controls
// The web target can't render react-native-maps: ProviderMap.web.tsx is a list fallback.
// TODO(port): pin clustering (the web groups pins closer than 34px).
import { LocateFixed, Maximize2, MapPinOff, Search, ZoomOut } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import MapView, { Circle, Marker } from 'react-native-maps'

import { bboxCenter, distanceKm, fmtBbox, splitByArea } from '@shared/api/locations.js'
import { countLabel, nounFor } from '@shared/verticals/index.js'
import { makeStyles, useTheme } from '@/theme'
import { Avatar } from '../Avatar'
import { Button } from '../Button'
import { providerA11yLabel } from '../ProviderCard'
import { Text } from '../Text'
import { boxRegion, circleRegion, includePoint, movedFrom, pointsRegion, regionBox, type Region } from './geo'
import { MapProviderCard } from './MapProviderCard'
import type { ProviderMapProps } from './types'

const FALLBACK: Region = { latitude: 34.05, longitude: -118.25, latitudeDelta: 0.6, longitudeDelta: 0.6 } // LA

export default function ProviderMap({
  providers, userLocation, onLocate, focusId, dates, fitUser = false, onSelect, area = null, onAreaChange, vertical = null, style,
}: ProviderMapProps) {
  const s = useStyles()
  const { c, scheme } = useTheme()
  const mapRef = useRef<MapView>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => (providers.some((p) => p.id === focusId) ? focusId! : null))
  const [touched, setTouched] = useState(!!focusId)
  const [locating, setLocating] = useState(false)
  const [moved, setMoved] = useState(false)
  const [dismissed, setDismissed] = useState('')
  const selected = providers.find((p) => p.id === selectedId) || null
  const reference = useRef<Region | null>(null) // the view the current results belong to
  const auto = useRef<null | { search?: boolean; rebase?: boolean; until: number }>(null) // a move we started

  const { inside, travels } = useMemo(() => splitByArea(providers, area), [providers, area])
  const inArea = useMemo(() => (area ? new Set([...inside, ...travels].map((p: { id: string }) => p.id)) : null), [area, inside, travels])
  const framePoints = () => [...providers.map((p) => p.location), fitUser ? userLocation : null]

  const initialRegion = useMemo<Region>(() => {
    const focus = providers.find((p) => p.id === focusId)
    if (focus) return circleRegion(focus.location, focus.radiusKm ?? 0)
    return area ? boxRegion(area) : pointsRegion(framePoints()) || FALLBACK
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const current = useRef<Region>(initialRegion) // where the map is now
  useEffect(() => {
    reference.current = initialRegion
  }, [initialRegion])

  const reported = useRef(selectedId)
  useEffect(() => {
    if (reported.current === selectedId) return
    reported.current = selectedId
    onSelect?.(selectedId)
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const animate = (region: Region, kind: { search?: boolean; rebase?: boolean } = {}, ms = 600) => {
    auto.current = { ...kind, until: Date.now() + ms + 900 }
    mapRef.current?.animateToRegion(region, ms)
  }

  const searchRegion = (region: Region) => {
    const box = regionBox(region)
    reference.current = region
    setMoved(false)
    onAreaChange?.(box)
  }

  const settled = useRef(false)
  const onRegionChangeComplete = (region: Region) => {
    current.current = region
    // The first report is the map fitting initialRegion to its own aspect ratio (both
    // platforms do this on load): that's the starting view, not the user moving away.
    if (!settled.current) {
      settled.current = true
      if (!auto.current) {
        reference.current = region
        return
      }
    }
    const a = auto.current && Date.now() < auto.current.until ? auto.current : null
    auto.current = null
    if (a?.search) return searchRegion(region)
    if (a?.rebase) {
      reference.current = region
      setMoved(false)
      return
    }
    if (a) return // framing a selection doesn't count as moving away
    setMoved(movedFrom(reference.current, region))
  }

  const select = (id: string | null) => {
    setSelectedId(id)
    if (id) setTouched(true)
    const p = providers.find((x) => x.id === id)
    if (p) {
      // Frame their whole service area above the card (shifted up a little).
      const r = circleRegion(p.location, p.radiusKm ?? 0, 1.5)
      animate({ ...r, latitude: r.latitude - r.latitudeDelta * 0.18 })
    }
  }

  const fitAll = () => {
    const r = pointsRegion(framePoints())
    if (r) animate(r, { rebase: true })
  }
  const showAll = () => {
    setSelectedId(null)
    if (area) onAreaChange?.(null)
    else fitAll()
  }

  // Filters changed: refit to the results (unless an area is searched or the open card is still in them).
  const idsKey = providers.map((p) => p.id).join(',')
  const fittedIds = useRef(idsKey)
  useEffect(() => {
    if (fittedIds.current === idsKey) return
    fittedIds.current = idsKey
    if (selected && providers.some((p) => p.id === selected.id)) return
    if (selected) setSelectedId(null)
    if (!area) fitAll()
  }, [idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // The area was cleared (chip, show all): back to everyone.
  const areaKey = area ? fmtBbox(area) : ''
  const lastArea = useRef(areaKey)
  useEffect(() => {
    if (lastArea.current === areaKey) return
    const wasSet = !!lastArea.current
    lastArea.current = areaKey
    if (!areaKey && wasSet) fitAll()
  }, [areaKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomOut = () => {
    if (!area) return
    const center = bboxCenter(area)
    const nearest = [...providers].sort((a, b) => (distanceKm(center, a.location) ?? 0) - (distanceKm(center, b.location) ?? 0))[0]
    if (nearest) animate(includePoint(boxRegion(area), nearest.location), { search: true }, 700)
  }
  const showTravellers = () => {
    if (!area) return
    let r = boxRegion(area)
    for (const p of travels) r = includePoint(r, p.location, 1.1)
    setDismissed(areaKey)
    animate(r, {}, 700)
  }
  const areaEmpty = !!area && !moved && !selected && inside.length === 0 && dismissed !== areaKey

  const locate = async () => {
    if (locating) return
    setLocating(true)
    const me = await onLocate?.().catch(() => null)
    setLocating(false)
    if (!me) return
    setSelectedId(null)
    const near = providers.filter((p) => p.distanceKm != null && p.distanceKm <= Math.max(p.radiusKm ?? 0, 25)).map((p) => p.location)
    animate(near.length ? pointsRegion([me, ...near])! : circleRegion(me, 15), {}, 700)
  }

  return (
    <View style={[s.wrap, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        // Screen readers: the pins are reachable one by one, and the List tab has the same results.
        accessibilityLabel={`Map of ${countLabel(providers.length, vertical)}. Switch to the list for the same results.`}
        userInterfaceStyle={scheme}
        initialRegion={initialRegion}
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={(e) => {
          if (e.nativeEvent.action !== 'marker-press') setSelectedId(null)
        }}
        showsPointsOfInterests={false}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        moveOnMarkerPress={false}
      >
        {selected?.radiusKm != null && (
          <Circle
            center={{ latitude: selected.location.lat, longitude: selected.location.lng }}
            radius={selected.radiusKm * 1000}
            strokeColor={selected.verticalInfo?.tint || c.accent}
            fillColor={`${selected.verticalInfo?.tint || c.accent}1f`}
            strokeWidth={1.5}
          />
        )}
        {userLocation && (
          <Marker coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={1}>
            <View style={s.meHalo}><View style={s.me} /></View>
          </Marker>
        )}
        {providers.map((p) => (
          <Pin
            key={p.id}
            p={p}
            selected={p.id === selectedId}
            dim={!!inArea && !inArea.has(p.id)}
            onPress={() => select(p.id)}
          />
        ))}
      </MapView>

      {moved && !selected && (
        <Pressable onPress={() => searchRegion(current.current)} style={s.areaBtn} accessibilityRole="button" accessibilityLabel="Search this area" accessibilityHint="Finds who is based in the part of the map you're looking at">
          <Search size={15} color={c.ink} strokeWidth={2.4} />
          <Text variant="small" weight="700">Search this area</Text>
        </Pressable>
      )}

      {areaEmpty && (
        <View style={s.emptyWrap} pointerEvents="box-none">
          <View style={s.emptyCard}>
            <MapPinOff size={22} color={c.muted} />
            {travels.length ? (
              <>
                <Text variant="h4" center>Nobody’s based here yet</Text>
                <Text variant="small" muted center>{countLabel(travels.length, vertical)} travel{travels.length === 1 ? 's' : ''} to this area.</Text>
                <Button title="Show on map" size="sm" onPress={showTravellers} style={s.center} />
              </>
            ) : (
              <>
                <Text variant="h4" center>No {nounFor(vertical, 2)} here yet</Text>
                <Text variant="small" muted center>Zoom out or search a different area.</Text>
                <Button title="Zoom out" icon={ZoomOut} size="sm" onPress={zoomOut} style={s.center} />
              </>
            )}
          </View>
        </View>
      )}

      {!touched && !selected && !areaEmpty && (
        <View style={s.hint} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text variant="tiny" weight="600" style={{ color: '#fff' }}>Tap a {nounFor(vertical)} to see how far they travel</Text>
        </View>
      )}

      <View style={s.controls}>
        <Pressable onPress={locate} style={s.ctl} disabled={locating} accessibilityRole="button" accessibilityLabel={`Show ${nounFor(vertical, 2)} near me`}>
          {locating ? <ActivityIndicator size="small" color={c.ink} /> : <LocateFixed size={19} color={userLocation ? c.id : c.ink} />}
        </Pressable>
        <Pressable onPress={showAll} style={s.ctl} accessibilityRole="button" accessibilityLabel={`Show all ${nounFor(vertical, 2)}`}>
          <Maximize2 size={17} color={c.ink} />
        </Pressable>
      </View>

      {selected && <MapProviderCard key={selected.id} provider={selected} dates={dates} showVertical={!vertical} onClose={() => setSelectedId(null)} />}
    </View>
  )
}

// One avatar pin. Custom marker views are snapshotted on Android, so keep tracking
// changes briefly (until the avatar image has loaded), then stop for performance.
function Pin({ p, selected, dim, onPress }: { p: ProviderMapProps['providers'][number]; selected: boolean; dim: boolean; onPress: () => void }) {
  const { c } = useTheme()
  const [track, setTrack] = useState(true)
  useEffect(() => {
    setTrack(true)
    const t = setTimeout(() => setTrack(false), 1500)
    return () => clearTimeout(t)
  }, [selected, dim, p.avatar])
  const size = selected ? 48 : 40
  const tint = p.verticalInfo?.tint || c.ink
  return (
    <Marker
      coordinate={{ latitude: p.location.lat, longitude: p.location.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={(e) => {
        e.stopPropagation?.()
        onPress()
      }}
      tracksViewChanges={track}
      zIndex={selected ? 1000 : dim ? 0 : 10}
      accessibilityLabel={providerA11yLabel(p, [selected && 'selected', dim && !selected && 'outside the searched area'])}
      accessibilityRole="button"
    >
      <View style={{ opacity: dim && !selected ? 0.45 : 1, padding: 2 }}>
        <View style={{ borderRadius: 999, borderWidth: 3, borderColor: selected ? c.ink : tint, backgroundColor: '#fff' }}>
          <Avatar uri={p.avatar} name={p.name} size={size - 6} />
        </View>
      </View>
    </Marker>
  )
}

const useStyles = makeStyles((t) => ({
  wrap: { flex: 1, minHeight: 320, overflow: 'hidden', backgroundColor: t.c.soft },
  areaBtn: {
    position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.c.bg, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  emptyWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyCard: {
    backgroundColor: t.c.bg, borderRadius: t.radius.xl, padding: 18, alignItems: 'center', gap: 6, maxWidth: 300,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  center: { alignSelf: 'center', marginTop: 6 },
  hint: { position: 'absolute', bottom: 16, alignSelf: 'center', backgroundColor: 'rgba(17,17,17,0.78)', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999 },
  controls: { position: 'absolute', right: 12, top: 12, gap: 8 },
  ctl: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: t.c.bg, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  meHalo: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(37,99,235,0.22)', alignItems: 'center', justifyContent: 'center' },
  me: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#2563eb', borderWidth: 2, borderColor: '#fff' },
}))
