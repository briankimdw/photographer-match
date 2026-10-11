// /occasions/[slug]: native version of frontend/src/screens/Occasion.jsx.
// Hero with a "N of M covered" progress bar, the "Plan this with AI" box (the shared
// occasionPrompt() -> /plan?q=), and the checklist from buildOccasionChecklist(): one row per
// needed vertical with counts / prices, a tick ("I've got this covered", saved on this device in
// AsyncStorage under the web's key via readCovered / writeCovered) and the top vendors to compare.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowUp, Check, ChevronRight, SearchX, Sparkles, Users } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { buildOccasionChecklist, listBrowseProviders, occasionPrompt, readCovered, withArticle, writeCovered } from '@shared/api/home.js'
import { money } from '@shared/lib/format.js'
import { getOccasion, unitLabel } from '@shared/verticals/catalog.js'
import { Button, EmptyState, ErrorState, InA11yGroup, Loading, Photo, RatingInline, Screen, SectionHeader, Text, VerticalIcon, ratingLabel } from '@/components'
import useQuery from '@/hooks/useQuery'
import { makeStyles, useTheme } from '@/theme'
import type { Occasion, Provider, Vertical } from '@/types'
import { ComingSoonCard } from '../home/Browse'
import { CatalogHero, FloatBar } from './Hero'

// Example details for the "Plan this with AI" box (same as the web).
const EXAMPLES: Record<string, string> = {
  wedding: 'Napa, next June, 120 guests, about $30k',
  birthday: 'My 30th in LA, a Saturday in March, 40 people',
  graduation: 'UCLA grad photos, first week of June, under $400',
  engagement: 'A surprise proposal at sunset in Malibu',
  corporate: 'Holiday offsite in SF for 60 people, $10k',
  'baby-shower': 'Backyard shower for 25, late April',
  quinceanera: '150 guests in San Diego, next summer',
  'dinner-party': 'Dinner for 8 at home, Italian, Friday',
  bachelor: 'Bachelorette weekend in Vegas, 10 friends',
  'holiday-party': 'Office party for 80, mid-December',
}

const coveredKey = (slug: string) => `occasion-covered:${slug}` // the key readCovered / writeCovered use
// readCovered / writeCovered take a Storage-like object; these adapt AsyncStorage to them.
async function loadCovered(slug: string) {
  const raw = await AsyncStorage.getItem(coveredKey(slug)).catch(() => null)
  return readCovered({ getItem: () => raw } as any, slug) as Set<string>
}
const saveCovered = (slug: string, set: Set<string>) =>
  writeCovered({ setItem: (k: string, v: string) => { AsyncStorage.setItem(k, v).catch(() => {}) } } as any, slug, set)

type Item = { vertical: Vertical; count: number; top: Provider[]; minPrice: number | null }

export default function OccasionScreen() {
  const router = useRouter()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const o = getOccasion(String(slug))
  if (!o) {
    return (
      <Screen title="Occasions" back>
        <EmptyState icon={SearchX} title="We don’t know that occasion" text="Pick one from Home to see what you’ll need."
          action={<Button title="Go home" size="sm" onPress={() => router.replace('/')} />} />
      </Screen>
    )
  }
  return <OccasionPage key={o.slug} o={o} />
}

function OccasionPage({ o }: { o: Occasion }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const providers = useQuery<Provider[]>(() => listBrowseProviders(), [])
  const items = buildOccasionChecklist(o, providers.data || []) as Item[]
  const [covered, setCovered] = useState<Set<string>>(new Set())
  const [details, setDetails] = useState('')
  const soon = items.filter((it) => !it.count).map((it) => it.vertical)
  const done = items.filter((it) => covered.has(it.vertical.slug)).length
  const lower = o.name.toLowerCase()

  useEffect(() => {
    let live = true
    loadCovered(o.slug).then((set) => live && setCovered(set))
    return () => {
      live = false
    }
  }, [o.slug])

  const toggle = (slug: string) => {
    const next = new Set(covered)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    setCovered(next)
    saveCovered(o.slug, next)
  }
  const plan = () => router.push({ pathname: '/plan', params: { q: occasionPrompt(o, details) } })

  return (
    <SafeAreaView style={s.root} edges={[]}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <CatalogHero icon={o.icon} tint={o.tint} title={`Plan ${withArticle(lower)}`}
          text={`The ${items.length} kinds of vendors you’ll likely need, most important first. Tick them off as you go.`}>
          <View style={s.progress}>
            <View style={s.progressLabel}>
              <Text variant="tiny" weight="700">{done} of {items.length} covered</Text>
              {done === items.length && <Text variant="tiny" weight="700" color="ok">All set</Text>}
            </View>
            <View style={[s.bar, { borderColor: `${o.tint}2e` }]} accessibilityRole="progressbar" accessibilityLabel="Checklist progress" accessibilityValue={{ min: 0, max: items.length, now: done }}>
              <View style={[s.fill, { width: `${items.length ? (done / items.length) * 100 : 0}%`, backgroundColor: o.tint }]} />
            </View>
          </View>
          <Button title="Start planning with friends" icon={Users} block onPress={() => router.push({ pathname: '/events/new', params: { type: o.slug } })} style={{ marginTop: 14 }} />
        </CatalogHero>

        <View style={s.padX}>
          <View style={s.ai}>
            <View style={s.aiHead}>
              <View style={s.aiMark}><Sparkles size={18} color={c.onAccent} /></View>
              <View style={s.grow}>
                <Text variant="body" weight="700">Plan this {lower} with AI</Text>
                <Text variant="small" muted>Add where, when and your budget. Get a draft budget and vendors who are free.</Text>
              </View>
            </View>
            <View style={s.aiInput}>
              <TextInput
                value={details}
                onChangeText={setDetails}
                onSubmitEditing={plan}
                returnKeyType="send"
                placeholder={EXAMPLES[o.slug] || 'Where, when, guests, budget…'}
                placeholderTextColor={c.faint}
                style={s.input}
                accessibilityLabel={`Describe your ${lower}`}
              />
              <Pressable onPress={plan} style={s.send} accessibilityRole="button" accessibilityLabel="Plan it with AI">
                <ArrowUp size={16} color={c.onInk} strokeWidth={2.5} />
              </Pressable>
            </View>
          </View>
        </View>

        <SectionHeader title="Your checklist" sub="Tap a category to compare vendors" />
        {providers.error && <ErrorState error={providers.error} onRetry={providers.reload} />}
        {providers.loading && !providers.data ? (
          <Loading inline />
        ) : (
          <View style={s.padX}>
            {items.map((it, i) => {
              const v = it.vertical
              const on = covered.has(v.slug)
              const unit = unitLabel(v.priceUnit)
              return (
                <View key={v.slug} style={[s.item, i === items.length - 1 && s.last]}>
                  <View style={s.itemHead}>
                    <Pressable
                      onPress={() => toggle(v.slug)}
                      hitSlop={8}
                      style={s.checkHit}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }} aria-checked={on}
                      accessibilityLabel={`${v.name}: ${on ? 'covered' : 'mark as covered'}`}
                    >
                      <View style={[s.check, on && s.checkOn]}>{on && <Check size={14} strokeWidth={3} color={c.onAccent} />}</View>
                    </Pressable>
                    <Pressable
                      onPress={() => router.push(`/services/${v.slug}`)}
                      style={s.itemLink}
                      accessibilityRole="link"
                      accessibilityLabel={[v.name, on && 'covered', it.count ? `${it.count} available` : 'coming soon', it.minPrice != null && `from ${money(it.minPrice)}${unit ? ` ${unit}` : ''}`].filter(Boolean).join(', ')}
                    >
                      <VerticalIcon name={v.icon} tint={v.tint} size={17} bubble bubbleSize={36} />
                      <View style={s.grow}>
                        <Text variant="body" weight="600" muted={on} style={on ? s.struck : undefined}>{v.name}</Text>
                        <Text variant="tiny" muted numberOfLines={1}>
                          {it.count
                            ? [`${it.count} available`, it.minPrice != null && `from ${money(it.minPrice)}${unit ? ` ${unit}` : ''}`].filter(Boolean).join(' · ')
                            : v.tagline}
                        </Text>
                      </View>
                      {!it.count && <View style={s.soonTag}><Text variant="tiny" weight="700" muted>Soon</Text></View>}
                      <ChevronRight size={16} color={c.muted} />
                    </Pressable>
                  </View>
                  {it.count > 0 && !on && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.vendors} style={s.vendorRail}>
                      {it.top.map((p) => (
                        <InA11yGroup key={p.id} value>
                        <Pressable key={p.id} onPress={() => router.push(`/u/${p.id}`)} style={s.vendor} accessibilityRole="link" accessibilityLabel={`${p.name}, ${ratingLabel(p.rating)}`}>
                          <Photo uri={p.cover} vertical={p.vertical} style={s.vendorImg} />
                          <Text variant="tiny" weight="700" numberOfLines={1}>{p.name}</Text>
                          <RatingInline rating={p.rating} size={11} />
                        </Pressable>
                        </InA11yGroup>
                      ))}
                    </ScrollView>
                  )}
                </View>
              )
            })}
          </View>
        )}

        {!!providers.data && soon.length > 0 && (
          <View style={[s.padX, s.mt]}>
            <ComingSoonCard soon={soon} />
          </View>
        )}
        <Text variant="tiny" muted style={[s.padX, s.mt]}>Ticks are saved on this device. Anyone you book shows up in Bookings.</Text>
      </ScrollView>
      <FloatBar />
    </SafeAreaView>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  scroll: { paddingBottom: t.space.xxl },
  padX: { paddingHorizontal: t.space.lg },
  mt: { marginTop: t.space.lg },
  grow: { flex: 1, minWidth: 0 },
  progress: { marginTop: 14 },
  progressLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  bar: { height: 8, borderRadius: 999, backgroundColor: t.scheme === 'dark' ? t.c.soft : 'rgba(255,255,255,0.9)', overflow: 'hidden', borderWidth: 1 },
  fill: { height: '100%', borderRadius: 999 },
  ai: { padding: 14, borderRadius: t.radius.xl, backgroundColor: t.c.accentSoft, gap: 12 },
  aiHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  aiMark: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.c.accent, alignItems: 'center', justifyContent: 'center' },
  aiInput: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.c.bg, borderRadius: t.radius.md, paddingLeft: 12, paddingRight: 6, paddingVertical: 5 },
  input: { flex: 1, fontSize: 14, color: t.c.ink, paddingVertical: 6 },
  send: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.c.ink, alignItems: 'center', justifyContent: 'center' },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.c.line },
  last: { borderBottomWidth: 0 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkHit: { padding: 2 },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: t.c.line, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: t.c.ok, borderColor: t.c.ok },
  itemLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  struck: { textDecorationLine: 'line-through' },
  soonTag: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: t.c.soft },
  vendorRail: { marginHorizontal: -t.space.lg },
  vendors: { gap: 8, paddingTop: 10, paddingLeft: t.space.lg + 36, paddingRight: t.space.lg },
  vendor: { width: 112, gap: 3 },
  vendorImg: { width: 112, height: 84, borderRadius: t.radius.md },
}))
