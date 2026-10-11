// A screen's outer frame: background, safe areas, optional TopBar and scrolling.
//   <Screen title="Search" back>...</Screen>          stack screen with a back button
//   <Screen header={<HomeHeader />}>...</Screen>      custom header (tab screens)
//   <Screen scroll={false}>...<FlatList/></Screen>    when the content scrolls itself
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'

import { makeStyles, useTheme } from '@/theme'
import { Text } from './Text'

type ScreenProps = {
  children?: ReactNode
  title?: string
  subtitle?: string
  back?: boolean
  right?: ReactNode
  header?: ReactNode
  scroll?: boolean
  padded?: boolean
  refreshing?: boolean
  onRefresh?: () => void
  edges?: Edge[]
  contentStyle?: StyleProp<ViewStyle>
}

export function Screen({
  children, title, subtitle, back, right, header, scroll = true, padded = false, refreshing = false, onRefresh,
  edges = ['top'], contentStyle,
}: ScreenProps) {
  const s = useStyles()
  const { c } = useTheme()
  const head = header ?? (title != null || back || right ? <TopBar title={title} subtitle={subtitle} back={back} right={right} /> : null)
  const body = scroll ? (
    <ScrollView
      style={s.flex}
      contentContainerStyle={[padded && s.padded, s.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} colors={[c.ink]} progressBackgroundColor={c.card} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[s.flex, padded && s.padded, contentStyle]}>{children}</View>
  )
  return (
    <SafeAreaView style={s.root} edges={edges}>
      {head}
      {body}
    </SafeAreaView>
  )
}

// Back button, centered title, right-side actions (the web's components/TopBar.jsx).
export function TopBar({ title, subtitle, back = true, right }: { title?: string; subtitle?: string; back?: boolean; right?: ReactNode }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  return (
    <View style={s.topbar}>
      <View style={s.side}>
        {back && (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={s.iconBtn}
          >
            <ChevronLeft size={26} color={c.ink} />
          </Pressable>
        )}
      </View>
      <View style={s.titleWrap}>
        {!!title && <Text variant="h4" numberOfLines={1} center accessibilityRole="header" maxFontSizeMultiplier={1.4}>{title}</Text>}
        {!!subtitle && <Text variant="tiny" muted numberOfLines={1} center maxFontSizeMultiplier={1.4}>{subtitle}</Text>}
      </View>
      <View style={[s.side, s.sideRight]}>{right}</View>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  flex: { flex: 1 },
  padded: { padding: t.space.lg },
  scrollContent: { paddingBottom: t.space.xxl },
  topbar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.space.xs, minHeight: 48,
    borderBottomWidth: 1, borderBottomColor: t.c.line, backgroundColor: t.c.bg,
  },
  side: { width: 88, flexDirection: 'row', alignItems: 'center' },
  sideRight: { justifyContent: 'flex-end', gap: 4, paddingRight: t.space.xs },
  titleWrap: { flex: 1, minWidth: 0, alignItems: 'center' },
  iconBtn: { padding: 6, borderRadius: 999 },
}))
