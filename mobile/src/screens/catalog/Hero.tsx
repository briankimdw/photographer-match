// The tinted hero of /services/[vertical] and /occasions/[slug] (the web's .svc-hero /
// .occ-hero): a gradient from the item's tint into the page, its icon on a white disc, the
// title and tagline, plus floating round Back / Search buttons that stay put (.hd-float-bar).
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import { ChevronLeft, Search as SearchIcon, type LucideIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text, VerticalIcon } from '@/components'
import { makeStyles, readableTint, useTheme } from '@/theme'

type HeroProps = { icon: string; tint: string; title: string; text?: string; children?: ReactNode }

export function CatalogHero({ icon, tint, title, text, children }: HeroProps) {
  const s = useStyles()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <LinearGradient colors={[`${tint}29`, c.bg]} style={[s.hero, { paddingTop: insets.top + 62 }]}>
      <View style={s.disc}>
        <VerticalIcon name={icon} size={26} color={tint} />
      </View>
      <Text style={s.title}>{title}</Text>
      {!!text && <Text variant="small" muted style={s.text}>{text}</Text>}
      {children}
    </LinearGradient>
  )
}

// Round pills over the hero (absolute; render after the ScrollView so they float).
export function FloatBar({ onSearch, searchLabel }: { onSearch?: () => void; searchLabel?: string }) {
  const s = useStyles()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View style={[s.float, { top: insets.top + 8 }]} pointerEvents="box-none">
      <FloatButton icon={ChevronLeft} label="Back" size={24} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      {onSearch && <FloatButton icon={SearchIcon} label={searchLabel || 'Search'} size={20} onPress={onSearch} />}
    </View>
  )
}

function FloatButton({ icon: Icon, label, onPress, size }: { icon: LucideIcon; label: string; onPress: () => void; size: number }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.fbtn, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Icon size={size} color={c.ink} />
    </Pressable>
  )
}

// "12 caterers", "from $45 per person"... pills under the hero title.
export function MetaPill({ label, icon: Icon, tint }: { label: string; icon?: LucideIcon; tint?: string }) {
  const s = useStyles()
  const { c, scheme } = useTheme()
  return (
    <View style={[s.pill, tint ? { borderColor: `${tint}33` } : null]}>
      {Icon && <Icon size={12} color={c.ink} />}
      <Text variant="tiny" weight="600" style={tint ? { color: readableTint(tint, scheme, 5) } : undefined}>{label}</Text>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  hero: { paddingHorizontal: t.space.lg, paddingBottom: 20 },
  disc: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: t.scheme === 'dark' ? t.c.soft : '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginTop: 10, marginBottom: 2, color: t.c.ink },
  text: { lineHeight: 19 },
  float: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  fbtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.scheme === 'dark' ? 'rgba(24,24,27,0.92)' : 'rgba(255,255,255,0.92)',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999,
    backgroundColor: t.scheme === 'dark' ? 'rgba(24,24,27,0.85)' : 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: t.c.line,
  },
}))
