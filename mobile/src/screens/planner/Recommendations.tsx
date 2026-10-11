// One section per category the plan needs (the web's components/planner/Recommendations.jsx).
// rec.category is a vertical slug (photography, catering, venue...), each with the planner's
// ranked options. Provider display data comes from `providers` (id -> provider); options we
// can't match are skipped. A vertical with no vendors at all gets EmptyVertical, not an error.
import { fmtKm } from '@shared/api/locations.js'
import { attributeLines, nounFor, verticalConfig, verticalMeta } from '@shared/verticals/index.js'
import { useRouter } from 'expo-router'
import { CalendarCheck, CalendarX, Check, Heart, Images, MapPin, Palette, Search } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { Avatar, Button, IconButton, IdVerified, InA11yGroup, Photo, ProBadge, RatingInline, Text, VerticalIcon, providerA11yLabel } from '@/components'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'
import type { Package, Provider } from '@/types'
import { cents, shortDates, type Brief } from './brief'
import EmptyVertical from './EmptyVertical'

export type PlanOption = {
  provider_id: string
  package_id?: string | null
  package_name?: string | null
  price_cents?: number | null
  fits_budget?: boolean | null
  free_dates: string[]
  free_on_all_dates?: boolean
  distance_km?: number | null
  travels_to_event?: boolean | null
  style_match?: number | null
  reasons: string[]
}
export type PlanRec = { category: string; label?: string | null; budget_cents?: number | null; options: PlanOption[] }

export default function Recommendations({ recommendations, providers, brief }: { recommendations: PlanRec[]; providers: Map<string, Provider>; brief: Brief | null }) {
  const s = useStyles()
  const router = useRouter()
  if (!recommendations?.length) return null
  return (
    <>
      {recommendations.map((rec) => {
        const options = (rec.options || []).filter((o) => providers.has(o.provider_id))
        const vertical = rec.category
        const meta = verticalMeta(vertical)
        const anyInVertical = [...providers.values()].some((p) => p.vertical === vertical)
        const searchParams = { ...(meta.known ? { v: vertical } : {}), ...(brief?.dates?.length ? { dates: brief.dates.join(',') } : {}) }
        return (
          <View key={rec.category} style={s.section}>
            <View style={s.head}>
              <View style={s.headTitle}>
                <VerticalIcon name={meta.icon} tint={meta.tint} bubble size={13} bubbleSize={26} />
                <Text variant="h4" style={{ fontSize: 16 }} numberOfLines={1}>{rec.label || meta.name}</Text>
              </View>
              {rec.budget_cents != null && <Text variant="small" muted>up to {cents(rec.budget_cents)}</Text>}
            </View>
            {options.length === 0 && !anyInVertical && meta.known ? (
              <View style={s.card}><EmptyVertical vertical={vertical} compact /></View>
            ) : options.length === 0 ? (
              <View style={[s.card, s.none]}>
                <Text variant="body" weight="700">No {nounFor(vertical, 2)} fit every detail yet</Text>
                <Text variant="small" muted>Try other dates or a bigger budget, or browse everyone who’s free.</Text>
                <Button title={`Browse ${nounFor(vertical, 2)}`} icon={Search} variant="ghost" size="sm" style={s.mtSm} onPress={() => router.push({ pathname: '/search', params: searchParams })} />
              </View>
            ) : (
              options.map((o, i) => (
                <OptionCard key={`${o.provider_id}-${o.package_id}`} option={o} p={providers.get(o.provider_id)!} brief={brief} budgetCents={rec.budget_cents ?? null} top={i === 0} />
              ))
            )}
          </View>
        )
      })}
    </>
  )
}

function OptionCard({ option: o, p, brief, budgetCents, top }: { option: PlanOption; p: Provider; brief: Brief | null; budgetCents: number | null; top: boolean }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { shortlist, toggleShortlist } = useStore()
  const saved = shortlist.has(p.id)
  const briefDates = brief?.dates || []
  const bookDates = o.free_dates.length ? o.free_dates : briefDates
  const pkg = p.packages.find((x: Package) => x.id === o.package_id)
  const packageName = o.package_name || pkg?.name
  const over = o.fits_budget === false && o.price_cents != null && budgetCents != null && o.price_cents > budgetCents ? cents(o.price_cents - budgetCents) : null
  const styleMatch = o.style_match == null ? null : Math.round(o.style_match <= 1 ? o.style_match * 100 : o.style_match)
  const covers = (p.covers as string[]).slice(0, 3)
  const config = verticalConfig(p.vertical)
  const pkgLine = pkg ? [pkg.hours && `${pkg.hours} hours`, ...attributeLines(config.packageFields, pkg.attributes, config.packageKeys)].filter(Boolean).join(' · ') : ''

  const book = () =>
    router.push({
      pathname: '/book/[providerId]',
      params: { providerId: p.id, ...(o.package_id ? { pkg: o.package_id } : {}), ...(bookDates.length ? { dates: bookDates.join(',') } : {}) },
    })
  const gallery = () => router.push({ pathname: '/gallery/[personId]', params: { personId: p.id } })
  const profile = () => router.push({ pathname: '/u/[id]', params: { id: p.id } })

  return (
    <View style={[s.option, top && s.optionTop]}>
      {covers.length > 0 && (
        <Pressable onPress={gallery} style={s.covers} accessibilityRole="link" accessibilityLabel={`See ${p.name}'s work`}>
          {covers.map((src, i) => (
            <Photo key={src} uri={src} style={{ flex: i === 0 ? 2 : 1, height: '100%' }} />
          ))}
          {top && <View style={s.topPick}><Text style={s.topPickText}>Top pick</Text></View>}
        </Pressable>
      )}
      <View style={s.body}>
        <View style={s.rowCenter}>
          <InA11yGroup value>
          <Pressable onPress={profile} style={[s.rowCenter, s.grow]} accessibilityRole="link" accessibilityLabel={providerA11yLabel(p)}>
            <Avatar uri={p.avatar} name={p.name} size="md" />
            <View style={s.grow}>
              <View style={s.nameRow}>
                <Text variant="body" weight="600" numberOfLines={1} style={s.shrink}>{p.name}</Text>
                {p.idVerified && <IdVerified />}
                {p.pro && <ProBadge />}
              </View>
              <View style={s.nameRow}>
                <RatingInline rating={p.rating} count={p.rating != null ? p.reviewCount : undefined} size={11} />
                {!!p.city && <Text variant="tiny" muted numberOfLines={1} style={s.shrink}>· {p.city.split(',')[0]}</Text>}
              </View>
            </View>
          </Pressable>
          </InA11yGroup>
          {!covers.length && top && <View style={[s.topPick, s.topPickInline]}><Text style={s.topPickText}>Top pick</Text></View>}
          <IconButton
            icon={Heart}
            filled={saved}
            color={saved ? c.accent : c.ink}
            size={20}
            label={saved ? 'Remove from shortlist' : 'Save to shortlist'}
            onPress={() => toggleShortlist(p.id)}
          />
        </View>

        <View style={s.pkg}>
          <View style={s.grow}>
            <Text variant="small" weight="700">{packageName || 'Package'}</Text>
            {!!pkgLine && <Text variant="tiny" muted>{pkgLine}</Text>}
          </View>
          <View style={s.right}>
            <Text variant="body" weight="700">{o.price_cents != null ? cents(o.price_cents) : 'Quote'}</Text>
            {o.fits_budget === true && <Text style={[s.fit, { color: c.ok }]}>Fits your budget</Text>}
            {o.fits_budget === false && <Text style={[s.fit, { color: c.warn }]}>{over ? `Over by ${over}` : 'Over budget'}</Text>}
          </View>
        </View>

        <View style={s.facts}>
          {briefDates.length > 0 &&
            (o.free_on_all_dates ? (
              <Fact icon={<CalendarCheck size={14} color={c.ok} />} text={`Free on ${briefDates.length > 1 ? 'all your dates' : 'your date'}`} />
            ) : o.free_dates.length ? (
              <Fact icon={<CalendarCheck size={14} color={c.ok} />} text={`Free ${shortDates(o.free_dates)}`} />
            ) : (
              <Fact icon={<CalendarX size={14} color={c.warn} />} text="Not free on your dates" />
            ))}
          {o.distance_km != null && (
            <Fact
              icon={<MapPin size={14} color={c.muted} />}
              text={
                <Text variant="small">
                  {fmtKm(o.distance_km)} away
                  {o.travels_to_event === true && <Text variant="small" style={{ color: c.ok }}> · travels to you</Text>}
                  {o.travels_to_event === false && <Text variant="small" muted> · outside their area</Text>}
                </Text>
              }
            />
          )}
          {styleMatch != null && <Fact icon={<Palette size={14} color={c.muted} />} text={`${styleMatch}% style match`} />}
        </View>

        {o.reasons.length > 0 && (
          <View style={[s.facts, s.reasons]}>
            {o.reasons.slice(0, 4).map((r) => (
              <Fact key={r} icon={<Check size={13} color={c.ok} />} text={r} muted />
            ))}
          </View>
        )}

        <View style={s.actions}>
          <Button title="Request booking" variant="accent" size="sm" grow onPress={book} />
          {covers.length > 0 && <Button title="Work" icon={Images} variant="ghost" size="sm" onPress={gallery} />}
          <Button title="Profile" variant="ghost" size="sm" onPress={profile} />
        </View>
      </View>
    </View>
  )
}

function Fact({ icon, text, muted }: { icon: ReactNode; text: ReactNode; muted?: boolean }) {
  const s = useStyles()
  return (
    <View style={s.fact}>
      <View style={s.factIcon}>{icon}</View>
      {typeof text === 'string' ? <Text variant="small" style={[s.shrink, muted && s.reasonText]}>{text}</Text> : <View style={s.shrink}>{text}</View>}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  section: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  card: { borderWidth: 1, borderColor: t.c.line, borderRadius: 16, padding: 14, backgroundColor: t.c.card },
  none: { alignItems: 'flex-start', gap: 2 },
  mtSm: { marginTop: 8 },
  option: { borderWidth: 1, borderColor: t.c.line, borderRadius: 18, overflow: 'hidden', backgroundColor: t.c.card },
  optionTop: {
    borderColor: t.scheme === 'dark' ? '#3f3f46' : '#d9d9d9',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 11, shadowOffset: { width: 0, height: 6 }, elevation: 2,
  },
  covers: { flexDirection: 'row', gap: 2, height: 112, backgroundColor: t.c.soft },
  topPick: { position: 'absolute', left: 10, top: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(17,17,17,0.78)' },
  topPickInline: { position: 'relative', left: 0, top: 0, backgroundColor: t.c.ink },
  topPickText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  body: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 10 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pkg: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: t.c.soft },
  right: { alignItems: 'flex-end' },
  fit: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  facts: { gap: 5 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  factIcon: { marginTop: 2 },
  reasons: { paddingTop: 8, borderTopWidth: 1, borderTopColor: t.c.line },
  reasonText: { color: t.scheme === 'dark' ? t.c.muted : '#444' },
  actions: { flexDirection: 'row', gap: 6 },
}))
