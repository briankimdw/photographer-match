// /u/[id]: native port of frontend/src/screens/Profile.jsx. `id` may be a provider
// id, a profile id, a provider slug or a username (the shared getPerson handles all).
// Ported: header (cover, tap-to-view avatar, badges, vertical tag, city -> map, rating ->
// reviews, followers sheet, bio, specialties), follow / shortlist / message / book, "your
// dates" card + two-week availability strip (one freeDays call), "About" vertical fields,
// and the tabs per vertical (Portfolio, Packages + service-area map + cancellation policy,
// Gear, Reviews with the review detail sheet).
// TODO(port): report / block menu (ModerationSheet), scroll to the tabs when the rating is tapped.
import { callName } from '@shared/lib/format.js'
import * as Linking from 'expo-linking'
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router'
import {
  CalendarCheck, CalendarX, Camera, CircleDot, Heart, Images, MapPin, MessageCircle, Package as PackageIcon, Plus, Send, Star, UserX,
} from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Share, View } from 'react-native'

import { freeDays, getPerson, getProvider } from '@shared/api/catalog.js'
import { messageError, startDirectMessage, startInquiry } from '@shared/api/messages.js'
import { listAlbums, listTaggedAlbums, toViewerAlbum } from '@shared/api/portfolio.js'
import { fmtChip, fmtMonth, fromKey, parseDates, toKey } from '@shared/lib/dates.js'
import { verticalConfig } from '@shared/verticals/index.js'
import { VERTICALS } from '@shared/verticals/catalog.js'
import {
  AvailabilityStrip, Button, Chip, ChipRow, EmptyState, SectionHeader, ErrorState, IconButton, IdVerified, Loading, Photo, ProBadge, Screen, Segmented, Stars, Text,
  VerticalIcon, ViewableAvatar, stripDates,
} from '@/components'
import { MapPreview } from '@/components/map'
import { ShareSheet } from '@/components/share/ShareSheet'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, useReadableTint, useTheme } from '@/theme'
import type { Person, Provider, Vertical } from '@/types'
import { AlbumGrid, type Album } from './AlbumGrid'
import { AttributeList } from './AttributeList'
import { FollowersSheet } from './FollowersSheet'
import { PackageList } from './PackageList'
import { ReviewList } from './ReviewList'
import { AddToEventButton } from '@/screens/events/AddToEvent'

const TABS = ['portfolio', 'packages', 'gear', 'reviews'] as const
type Tab = (typeof TABS)[number]
const TAB_LABELS: Record<Tab, string> = { portfolio: 'Portfolio', packages: 'Packages', gear: 'Gear', reviews: 'Reviews' }

// getPerson, but a username that belongs to a provider opens their listing.
async function loadPerson(id: string): Promise<Person | null> {
  const person = await getPerson(id)
  if (person?.kind === 'person') return ((await getProvider(person.id)) as Person) || person
  return person
}

const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v)

export default function Profile() {
  const s = useStyles()
  const { c } = useTheme()
  const readable = useReadableTint()
  const router = useRouter()
  const pathname = usePathname()
  const params = useLocalSearchParams<{ id: string; tab?: string; dates?: string }>()
  const id = one(params.id) || ''
  const startTab = one(params.tab) as Tab | undefined
  const datesParam = one(params.dates) || ''
  const { user } = useAuth()
  const { following, toggleFollow, shortlist, toggleShortlist, toast } = useStore()
  const [tab, setTab] = useState<Tab | null>(startTab && TABS.includes(startTab) ? startTab : null) // null = first tab for this profile
  const [contacting, setContacting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [followersOpen, setFollowersOpen] = useState(false)

  const { data: person, loading, error, reload } = useQuery<Person | null>(() => loadPerson(id), [id])
  const provider = person?.kind === 'provider' ? (person as Provider) : null
  // Visual verticals lead with their portfolio; others (DJs, planners...) with packages and reviews.
  const visual = provider ? provider.verticalInfo?.visual !== false : true
  const tabs: Tab[] = !provider
    ? []
    : [
        ...(visual ? (['portfolio'] as Tab[]) : []),
        'packages',
        ...(['photography', 'videography'].includes(provider.vertical) || provider.gear.bodies.length || provider.gear.lenses.length ? (['gear'] as Tab[]) : []),
        'reviews',
        ...(!visual && provider.albumCount > 0 ? (['portfolio'] as Tab[]) : []),
      ]
  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0]
  const config = verticalConfig(provider?.vertical)
  const aboutFields = config.providerFields.filter((f: { key: string }) => f.key !== 'specialties')

  const albums = useQuery<Album[]>(
    provider && (visual || provider.albumCount > 0)
      ? () => listAlbums(provider.id).then((rows: any[]) => rows.filter((a) => a.photos?.length).map(toViewerAlbum))
      : null,
    [provider?.id],
  )

  // Other vendors' posts that credit this one; [] (section hidden) until album_credits exists.
  const tagged = useQuery<(Album & { by: { id: string; name: string } })[]>(provider ? () => listTaggedAlbums(provider.id) : null, [provider?.id])

  // Dates carried over from a date search, plus the strip's two weeks: one availability lookup.
  const dates: string[] = parseDates(datesParam)
  const stripKeys = useMemo(() => stripDates().map(toKey), [])
  const free = useQuery<Set<string>>(provider ? () => freeDays(provider.id, [...new Set([...stripKeys, ...dates])]) : null, [provider?.id, datesParam])
  const freeDates = free.data ? dates.filter((k) => free.data!.has(k)) : []
  const datesQuery = freeDates.length ? { dates: freeDates.join(',') } : {}

  if (loading) return <Screen back><Loading /></Screen>
  if (error) return <Screen back><ErrorState error={error} onRetry={reload} /></Screen>
  if (!person) {
    return (
      <Screen back>
        <EmptyState icon={UserX} title="Profile not found" text="This account doesn’t exist or is no longer available."
          action={<Button title="Go home" size="sm" onPress={() => router.replace('/')} />} />
      </Screen>
    )
  }

  const isMine = !!user && person.profileId === user.id
  const handle = person.username || provider?.slug
  // "Maya" for people and vendors under their own name; the whole business name otherwise.
  const firstName = provider ? (provider as any).shortName || callName(provider.name) : (person.name || '').split(' ')[0]
  // A specialty that is a catalog service ("Wedding") filters by it; anything else is a text search.
  const categoryFor = (name: string) => {
    const pool = [...VERTICALS.filter((v: Vertical) => v.slug === provider?.vertical), ...VERTICALS]
    return pool.flatMap((v: Vertical) => v.services).find((sv) => sv.name.toLowerCase() === name.toLowerCase())?.slug
  }
  const openMap = provider?.location
    ? () => router.push({ pathname: '/search', params: { view: 'map', v: provider.vertical, focus: provider.id } })
    : undefined

  const contact = async () => {
    if (!user) return router.push({ pathname: '/sign-in', params: { next: pathname } })
    if (contacting) return
    setContacting(true)
    try {
      // Providers get an inquiry thread (tied to their listing); anyone else a direct message.
      const conversationId = provider ? await startInquiry(provider.id) : await startDirectMessage(person.profileId)
      router.push(`/inbox/${conversationId}`)
    } catch (e) {
      console.warn(e)
      toast(messageError(e))
    } finally {
      setContacting(false)
    }
  }
  const share = () => {
    // Vendors: the in-app "Send to" sheet (cards in chat). People: the system share sheet.
    if (provider) return setSharing(true)
    const path = `/u/${person.username || person.id}`
    Share.share({ message: `Check out ${handle ? `@${handle}` : person.name} on Event Organizer: ${Linking.createURL(path)}` }).catch(() => {})
  }

  return (
    <Screen
      title={handle ? `@${handle}` : person.name}
      back
      right={
        <>
          {provider && !isMine && (
            <IconButton
              icon={Heart}
              filled={shortlist.has(provider.id)}
              color={shortlist.has(provider.id) ? c.accent : c.ink}
              label="Shortlist"
              selected={shortlist.has(provider.id)}
              onPress={() => toggleShortlist(provider.id)}
            />
          )}
          <IconButton icon={Send} label="Share" onPress={share} />
        </>
      }
    >
      {provider?.cover ? <Photo uri={provider.cover} style={s.cover} /> : null}
      <View style={[s.head, provider?.cover ? s.headOverCover : null]}>
        <ViewableAvatar uri={person.avatar} name={person.name} username={handle} size="xl" ring={!!provider?.cover} />
        <View style={s.nameRow}>
          <Text variant="h2" center>{person.name}</Text>
          {provider?.idVerified && <IdVerified label />}
          {provider?.pro && <ProBadge />}
        </View>
        <View style={s.inline}>
          {provider?.verticalInfo && (
            <Pressable
              onPress={() => router.push({ pathname: '/search', params: { v: provider.vertical } })}
              style={[s.vtag, { backgroundColor: `${provider.verticalInfo.tint}1a` }]}
              accessibilityRole="link"
              accessibilityLabel={`More ${provider.verticalInfo.plural}`}
            >
              <VerticalIcon name={provider.verticalInfo.icon} size={12} color={provider.verticalInfo.tint} />
              <Text variant="tiny" weight="700" style={{ color: readable(provider.verticalInfo.tint, 5) }}>{provider.verticalInfo.name}</Text>
            </Pressable>
          )}
          {!!person.city && (
            <Pressable onPress={openMap} disabled={!openMap} style={s.inline} accessibilityRole={openMap ? 'link' : undefined}
              accessibilityLabel={openMap ? `${person.city}: see ${firstName} on the map` : person.city}>
              <MapPin size={13} color={c.muted} />
              <Text variant="small" muted style={openMap ? s.underline : undefined}>{person.city}</Text>
            </Pressable>
          )}
        </View>
        {provider && (
          <View style={s.inline}>
            {provider.rating != null ? (
              <Pressable onPress={() => setTab('reviews')} style={s.inline} accessibilityRole="button"
                accessibilityLabel={`Rated ${provider.rating.toFixed(1)} from ${provider.reviewCount} reviews. Show reviews`}>
                <Stars value={provider.rating} />
                <Text variant="small" weight="700">{provider.rating.toFixed(1)}</Text>
                <Text variant="small" muted>({provider.reviewCount} review{provider.reviewCount === 1 ? '' : 's'})</Text>
              </Pressable>
            ) : (
              <Chip label="New" />
            )}
            <Text variant="small" muted>·</Text>
            {provider.followers > 0 ? (
              <Pressable onPress={() => setFollowersOpen(true)} hitSlop={{ top: 12, bottom: 12 }} accessibilityRole="button" accessibilityLabel={`${provider.followers} follower${provider.followers === 1 ? '' : 's'}`} accessibilityHint="Shows who follows them">
                <Text variant="small" muted>
                  <Text variant="small" weight="700">{provider.followers}</Text> follower{provider.followers === 1 ? '' : 's'}
                </Text>
              </Pressable>
            ) : (
              <Text variant="small" muted>No followers yet</Text>
            )}
          </View>
        )}
        {!provider && person.kind === 'person' && (person as any).clientRating != null && (
          <View style={s.inline}>
            <Stars value={(person as any).clientRating} />
            <Text variant="small" weight="700">{(person as any).clientRating.toFixed(1)}</Text>
            <Text variant="small" muted>as a client ({(person as any).clientReviews})</Text>
          </View>
        )}
        {!provider && !!person.createdAt && <Text variant="tiny" muted>Joined {fmtMonth(new Date(person.createdAt))}</Text>}
        {!!person.bio && <Text variant="body" center style={s.bio}>{person.bio}</Text>}
        {provider && provider.specialties.length > 0 && (
          <ChipRow style={s.centerChips}>
            {provider.specialties.map((sp: string) => {
              const slug = categoryFor(sp)
              return (
                <Chip key={sp} label={sp} onPress={() => router.push({ pathname: '/search', params: slug ? { v: provider.vertical, cat: slug } : { v: provider.vertical, q: sp } })} />
              )
            })}
          </ChipRow>
        )}

        {provider && !isMine && (
          <View style={s.actions}>
            <View style={s.row}>
              <Button title={following.has(provider.id) ? 'Following' : 'Follow'} variant={following.has(provider.id) ? 'ghost' : 'primary'} grow onPress={() => toggleFollow(provider.id)} />
              <Button title={contacting ? 'Opening…' : 'Ask a question'} icon={MessageCircle} variant="ghost" grow disabled={contacting} onPress={contact} />
            </View>
            <View style={s.row}>
              <AddToEventButton provider={provider} variant="button" />
              <Button
                title={`Book ${firstName}`}
                variant="accent"
                grow
                onPress={() => router.push({ pathname: '/book/[providerId]', params: { providerId: provider.id, ...datesQuery } })}
              />
            </View>
          </View>
        )}
        {!provider && !isMine && (
          <View style={s.actions}>
            <Button title={contacting ? 'Opening…' : `Message ${firstName}`} icon={MessageCircle} block disabled={contacting} onPress={contact} />
          </View>
        )}
        {provider && isMine && (
          <View style={[s.row, s.actions]}>
            <Button title="Post photos" icon={Plus} grow onPress={() => router.push('/upload')} />
            {provider.albumCount > 0
              ? <Button title="My work" icon={Images} variant="ghost" grow onPress={() => router.push('/my-work')} />
              : <Button title="Packages" icon={PackageIcon} variant="ghost" grow onPress={() => router.push('/me')} />}
          </View>
        )}
      </View>

      {provider && dates.length > 0 && (
        <View style={s.padX}>
          <View style={s.infoCard}>
            <Text variant="small" weight="700">Your dates</Text>
            <ChipRow style={s.mtSm}>
              {dates.map((k) => {
                const isFree = freeDates.includes(k)
                const tint = !free.data ? c.ink : isFree ? c.ok : c.danger
                return (
                  <Chip key={k} icon={isFree ? CalendarCheck : CalendarX} tint={tint}
                    label={`${fmtChip(fromKey(k))}${free.data ? ` · ${isFree ? 'Free' : 'Booked'}` : ''}`} />
                )
              })}
            </ChipRow>
          </View>
        </View>
      )}

      {provider && (
        <View style={s.padX}>
          <View style={s.infoCard}>
            <View style={[s.between, { alignItems: 'flex-start' }]}>
              <Text variant="small" numberOfLines={1} style={{ flexShrink: 0 }}><Text variant="small" weight="700">Availability</Text> · next 2 weeks</Text>
              <Text variant="tiny" muted numberOfLines={2} style={[s.shrink, { textAlign: 'right' }]}>{provider.serviceArea}</Text>
            </View>
            <View style={s.mtSm}>
              <AvailabilityStrip free={free.data} pending={!free.data} />
            </View>
          </View>
        </View>
      )}

      {provider && aboutFields.length > 0 && (
        <AboutCard firstName={firstName} fields={aboutFields} attrs={provider.attributes} />
      )}

      {provider && !!tagged.data?.length && (
        <View style={s.tagged}>
          <SectionHeader title="Tagged in" sub={`Posts by other vendors that credit ${firstName}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.taggedRail}>
            {tagged.data.map((a) => (
              <Pressable
                key={a.id}
                onPress={() => router.push({ pathname: '/gallery/[personId]', params: { personId: a.by.id, post: a.id } })}
                style={({ pressed }) => [s.taggedTile, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={`${a.title || 'Post'} by ${a.by.name}`}
              >
                <Photo uri={a.cover} style={s.taggedImg} />
                <Text variant="small" weight="600" numberOfLines={1}>{a.title}</Text>
                <Text variant="tiny" muted numberOfLines={1}>by {a.by.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {provider && tabs.length > 0 && (
        <View style={s.tabs}>
          <Segmented options={tabs.map((t) => ({ value: t, label: TAB_LABELS[t] }))} value={activeTab} onChange={setTab} />
        </View>
      )}

      {provider && activeTab === 'portfolio' && (
        <View style={s.tabBody}>
          {albums.loading && <Loading inline />}
          {albums.error && <ErrorState error={albums.error} onRetry={albums.reload} />}
          {albums.data?.length === 0 && (
            <View style={s.pad}>
              <EmptyState compact icon={Images} title="No albums yet"
                text={isMine ? 'Post your first album and it will show up here.' : `${firstName} hasn’t posted any work yet.`}
                action={isMine ? <Button title="Post photos" size="sm" onPress={() => router.push('/upload')} /> : undefined} />
            </View>
          )}
          {!!albums.data?.length && (
            <AlbumGrid
              albums={albums.data}
              onOpen={(a) => router.push(a.status === 'under_review' && isMine
                ? `/ai-review/${a.id}`
                : { pathname: '/gallery/[personId]', params: { personId: provider.id, post: a.id } })}
            />
          )}
        </View>
      )}

      {provider && activeTab === 'packages' && (
        <View style={s.pad}>
          {provider.packages.length === 0 ? (
            <EmptyState compact icon={PackageIcon} title="No packages listed yet" text={isMine ? null : 'Ask a question to get a quote.'} />
          ) : (
            <PackageList
              packages={provider.packages}
              addons={provider.addons}
              vertical={provider.vertical}
              onSelect={isMine ? undefined : (pkg) => router.push({ pathname: '/book/[providerId]', params: { providerId: provider.id, pkg: pkg.id, ...datesQuery } })}
            />
          )}
          <Text variant="h4" style={s.sectionTitle}>Service area</Text>
          <Text variant="small">{provider.serviceArea}</Text>
          <Text variant="small" muted>Travel fee: {provider.travelFee}</Text>
          {provider.location && (
            <MapPreview
              location={provider.location}
              radiusKm={provider.radiusKm}
              avatar={provider.avatar}
              name={provider.name}
              tint={provider.verticalInfo?.tint}
              onPress={() => router.push({ pathname: '/search', params: { view: 'map', focus: provider.id } })}
            />
          )}
          {provider.cancellationPolicy?.tiers?.length > 0 && (
            <View style={s.policy}>
              <Text variant="small" style={s.policyHead}>Cancellation policy: <Text variant="small" weight="700">{provider.cancellationPolicy.label}</Text></Text>
              {provider.cancellationPolicy.tiers.map((tier: { when: string; refund: number }) => (
                <View key={tier.when} style={s.lineRow}>
                  <Text variant="small" style={s.grow}>{tier.when}</Text>
                  <Text variant="small" muted={!tier.refund}>{tier.refund}% refund</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {provider && activeTab === 'gear' && (
        <View style={s.pad}>
          {!provider.gear.bodies.length && !provider.gear.lenses.length && <EmptyState compact icon={Camera} title="No gear listed yet" />}
          {provider.gear.bodies.length > 0 && <Text variant="h4" style={s.sectionTitle}>Bodies</Text>}
          {provider.gear.bodies.map((g: string) => (
            <View key={g} style={s.lineRow}><Camera size={16} color={c.ink} /><Text variant="body" style={s.grow}>{g}</Text></View>
          ))}
          {provider.gear.lenses.length > 0 && <Text variant="h4" style={s.sectionTitle}>Lenses</Text>}
          {provider.gear.lenses.map((g: string) => (
            <View key={g} style={s.lineRow}><CircleDot size={16} color={c.ink} /><Text variant="body" style={s.grow}>{g}</Text></View>
          ))}
        </View>
      )}

      {provider && activeTab === 'reviews' && (
        <View style={s.pad}>
          {provider.rating != null ? (
            <View style={s.ratingSummary}>
              <Text style={s.big}>{provider.rating.toFixed(1)}</Text>
              <View style={s.grow}>
                <Stars value={provider.rating} size={16} />
                <Text variant="small" muted>{provider.reviewCount} review{provider.reviewCount === 1 ? '' : 's'} from completed bookings</Text>
              </View>
            </View>
          ) : (
            <EmptyState compact icon={Star} title="No reviews yet" text="Reviews appear here after completed bookings." />
          )}
          {provider.rating != null && !provider.reviews?.length && <Text variant="small" muted style={s.sectionTitle}>No written reviews yet.</Text>}
          <ReviewList reviews={provider.reviews || []} provider={{ id: provider.id, name: provider.name, avatar: provider.avatar }} here />
        </View>
      )}

      {provider && (
        <FollowersSheet open={followersOpen} onClose={() => setFollowersOpen(false)} providerId={provider.id} count={provider.followers} />
      )}
      {provider && sharing && (
        <ShareSheet
          item={{ kind: 'provider', id: provider.id, link: `/u/${provider.slug || provider.id}`, title: provider.name, subtitle: [provider.verticalInfo?.name, provider.city?.split(',')[0]].filter(Boolean).join(' · '), image: provider.avatar }}
          onClose={() => setSharing(false)}
        />
      )}
    </Screen>
  )
}

function AboutCard({ firstName, fields, attrs }: { firstName: string; fields: any[]; attrs: Record<string, any> }) {
  const s = useStyles()
  const content = <AttributeList fields={fields} attrs={attrs} />
  // Nothing filled in: no card.
  if (!fields.some((f) => attrs?.[f.key] != null && attrs[f.key] !== '' && !(Array.isArray(attrs[f.key]) && !attrs[f.key].length))) return null
  return (
    <View style={s.padX}>
      <View style={s.infoCard}>
        <Text variant="small" weight="700">About {firstName}</Text>
        {content}
      </View>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  cover: { width: '100%', height: 130 },
  head: { alignItems: 'center', padding: t.space.lg, gap: 4 },
  headOverCover: { marginTop: -58 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'center' },
  vtag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginRight: 4 },
  underline: { textDecorationLine: 'underline' },
  bio: { marginTop: t.space.sm },
  centerChips: { justifyContent: 'center', marginTop: 10 },
  actions: { alignSelf: 'stretch', marginTop: t.space.lg, gap: t.space.sm },
  row: { flexDirection: 'row', gap: t.space.sm },
  padX: { paddingHorizontal: t.space.lg, marginBottom: t.space.sm },
  infoCard: { borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg, padding: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  shrink: { flexShrink: 1 },
  mtSm: { marginTop: t.space.sm },
  tabs: { paddingHorizontal: t.space.lg, marginTop: t.space.sm },
  tagged: { marginTop: t.space.sm, marginBottom: t.space.sm },
  taggedRail: { paddingHorizontal: t.space.lg, gap: 10 },
  taggedTile: { width: 132, gap: 1 },
  taggedImg: { width: 132, height: 99, borderRadius: t.radius.md, marginBottom: 5 },
  tabBody: { marginTop: t.space.sm },
  pad: { padding: t.space.lg },
  grow: { flex: 1 },
  sectionTitle: { marginTop: 20, marginBottom: 8 },
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.c.line },
  policy: { marginTop: 20 },
  policyHead: { marginBottom: 4 },
  ratingSummary: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  big: { fontSize: 40, fontWeight: '800', color: t.c.ink },
}))
