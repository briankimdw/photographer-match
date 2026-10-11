// Shared loading / empty / error / signed-out states (the web's components/States.jsx),
// so every screen handles "no data yet" the same way.
import { usePathname, useRouter } from 'expo-router'
import { LogIn, type LucideIcon } from 'lucide-react-native'
import { useEffect, type ReactNode } from 'react'
import { ActivityIndicator, View } from 'react-native'

import { announce } from '@/lib/a11y'

import { makeStyles, useTheme } from '@/theme'
import { Button } from './Button'
import { Text } from './Text'

export function Loading({ label = 'Loading…', inline = false }: { label?: string; inline?: boolean }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={[s.state, inline && s.inline]} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size={inline ? 'small' : 'large'} color={c.ink} />
      <Text variant="small" muted>{label}</Text>
    </View>
  )
}

type EmptyProps = { icon?: LucideIcon; title?: string; text?: string | null; action?: ReactNode; compact?: boolean }

export function EmptyState({ icon: Icon, title, text, action, compact = false }: EmptyProps) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={[s.state, compact && s.compact]}>
      {Icon && (
        <View style={[s.icon, compact && s.iconCompact]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Icon size={compact ? 20 : 26} color={c.muted} />
        </View>
      )}
      {!!title && <Text variant="h4" center accessibilityRole="header">{title}</Text>}
      {!!text && <Text variant="small" muted center style={s.text}>{text}</Text>}
      {action ? <View style={s.action}>{action}</View> : null}
    </View>
  )
}

export function ErrorState({ error, onRetry }: { error?: { message?: string } | null; onRetry?: () => void }) {
  const s = useStyles()
  const msg = error?.message || 'Check your connection and try again.'
  useEffect(() => announce(`Couldn’t load this. ${msg}`), [msg])
  return (
    <View style={s.state}>
      <Text variant="h4" center accessibilityRole="header">Couldn’t load this</Text>
      <Text variant="small" muted center style={s.text}>{msg}</Text>
      {onRetry && <View style={s.action}><Button title="Try again" variant="ghost" size="sm" onPress={onRetry} /></View>}
    </View>
  )
}

// Shown in place of screens that need an account (Bookings, Inbox...).
export function SignInPrompt({ title = 'Sign in to continue', text }: { title?: string; text?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <EmptyState
      icon={LogIn}
      title={title}
      text={text}
      action={<Button title="Sign in" onPress={() => router.push({ pathname: '/sign-in', params: { next: pathname } })} />}
    />
  )
}

const useStyles = makeStyles((t) => ({
  state: { paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', gap: 10 },
  inline: { paddingVertical: 16, flexDirection: 'row', gap: 10 },
  compact: { paddingVertical: 20, paddingHorizontal: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.c.line, borderRadius: 16, gap: 6 },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
  iconCompact: { width: 40, height: 40, borderRadius: 20 },
  text: { maxWidth: 280 },
  action: { marginTop: 6 },
}))
