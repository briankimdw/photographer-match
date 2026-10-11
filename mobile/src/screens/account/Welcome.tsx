// /welcome: native port of frontend/src/screens/Welcome.jsx. One-time step after a
// new account is created: pick a name and a username. The root layout sends
// accounts without a name here (needsWelcome), like the web App does.
import { useLocalSearchParams, useRouter } from 'expo-router'
import { AtSign } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, KeyboardView, Text, TextField } from '@/components'
import { supabase } from '@/lib/supabase'
import { safeNext, useAuth } from '@/state/auth'
import { makeStyles } from '@/theme'
import { FieldHint, FormError } from './ui'

const USERNAME_RE = /^[a-z0-9._]{3,30}$/

export default function Welcome() {
  const s = useStyles()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ next?: string }>()
  const next = safeNext(params.next)
  const { user, profile, refreshProfile, loading } = useAuth()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && !user) router.replace({ pathname: '/sign-in', params: { next } })
  }, [loading, user, next, router])

  useEffect(() => {
    if (profile) {
      setName((n) => n || profile.display_name || '')
      setUsername((u) => u || profile.username || '')
    }
  }, [profile])

  const cleanUsername = username.trim().toLowerCase()
  const usernameOk = USERNAME_RE.test(cleanUsername)

  const save = async () => {
    if (!user || !name.trim() || !usernameOk) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase.from('profiles').update({ display_name: name.trim(), username: cleanUsername }).eq('id', user.id)
    setBusy(false)
    if (err) {
      setError(err.code === '23505' ? 'That username is taken. Try another.' : err.message)
      return
    }
    await refreshProfile()
    router.replace(next as any)
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <KeyboardView bottomInset={insets.bottom}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text variant="display">Event Organizer<Text variant="display" color="accent" accessibilityRole="none">.</Text></Text>
          <Text variant="h1" style={s.title}>Welcome! What should we call you?</Text>
          <Text variant="small" muted>Vendors see your name when you message or book them.</Text>

          <TextField
            label="Your name"
            autoComplete="name"
            textContentType="name"
            value={name}
            maxLength={80}
            onChangeText={setName}
            placeholder="Alex Rivera"
            autoFocus
            returnKeyType="next"
            containerStyle={s.mt}
          />
          <View style={s.mtSm}>
            <TextField
              label="Username"
              icon={AtSign}
              value={username}
              maxLength={30}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              onChangeText={(v) => setUsername(v.toLowerCase())}
              placeholder="alex.rivera"
              onSubmitEditing={save}
              returnKeyType="done"
            />
            {!!username && !usernameOk && <FieldHint error>3–30 characters: lowercase letters, numbers, dots and underscores.</FieldHint>}
          </View>
          {!!error && <FormError>{error}</FormError>}
          <Button title={busy ? 'Saving…' : 'Continue'} block disabled={busy || !name.trim() || !usernameOk} onPress={save} style={s.mt} />
        </ScrollView>
      </KeyboardView>
    </SafeAreaView>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  body: { padding: 20, gap: 8, paddingTop: 40 },
  title: { marginTop: t.space.lg },
  mt: { marginTop: t.space.lg },
  mtSm: { marginTop: t.space.sm },
}))
