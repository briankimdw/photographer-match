// What went wrong with the last planner call, with a way forward
// (the web's components/planner/PlanError.jsx).
import { PlugZap, TriangleAlert } from 'lucide-react-native'
import { View } from 'react-native'

import { useEffect } from 'react'

import { Button, SignInPrompt, Text } from '@/components'
import { announce } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'

export type PlanErr = Error & { kind?: 'offline' | 'auth' | 'server'; status?: number | null }

export default function PlanError({ error, onRetry }: { error: PlanErr | null; onRetry?: () => void }) {
  const s = useStyles()
  const { c, scheme } = useTheme()
  useEffect(() => {
    if (error && error.kind !== 'auth') announce(error.kind === 'offline' ? 'The planner isn’t running' : 'That didn’t work')
  }, [error])
  if (error?.kind === 'auth') {
    return <SignInPrompt title="Sign in again to keep planning" text="Your session ended. Sign in again, then send that message once more." />
  }
  const offline = error?.kind === 'offline'
  const Icon = offline ? PlugZap : TriangleAlert
  return (
    <View style={s.card}>
      <View style={s.icon}>
        <Icon size={18} color={scheme === 'dark' ? '#fdba74' : '#c2410c'} />
      </View>
      <View style={s.grow}>
        <Text variant="body" weight="700">{offline ? 'The planner isn’t running' : 'That didn’t work'}</Text>
        <Text variant="small" muted>
          {offline
            ? __DEV__
              ? 'Couldn’t reach the planner service. Start services/ml (uvicorn app.main:app --host 0.0.0.0 --port 8000) and check EXPO_PUBLIC_PLANNER_URL in mobile/.env.'
              : 'It’s taking a short break. Try again in a minute.'
            : error?.message || 'Something went wrong. Try again.'}
        </Text>
        {onRetry && <Button title="Try again" size="sm" onPress={onRetry} style={s.mtSm} />}
      </View>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  card: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderWidth: 1, borderColor: t.c.line, borderRadius: 16, padding: 14, backgroundColor: t.c.card },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: t.scheme === 'dark' ? '#3a2410' : '#fff7ed' },
  grow: { flex: 1, gap: 2 },
  mtSm: { marginTop: 8 },
}))
