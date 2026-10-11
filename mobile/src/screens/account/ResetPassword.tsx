// /reset-password: native port of frontend/src/screens/ResetPassword.jsx. Reached
// from a "reset your password" email (the link opens the app here and signs you in
// for this one step; see authLink.ts) or from Settings while signed in.
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Eye, EyeOff } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, KeyboardView, Text, TextField, TopBar } from '@/components'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { TOGGLE_ROLE } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'
import { useIncomingUrl } from './AuthCallback'
import { completeAuthFromUrl } from './authLink'
import { FormError } from './ui'

const MIN_PASSWORD = 8

export default function ResetPassword() {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<Record<string, string>>()
  const url = useIncomingUrl(params)
  const { user, loading } = useAuth()
  const { toast } = useStore()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linkError, setLinkError] = useState('')
  const [waited, setWaited] = useState(false)

  // Opened from the email: sign in with the link's tokens first.
  useEffect(() => {
    let live = true
    completeAuthFromUrl(url).then((r) => live && r.error && setLinkError(r.error))
    return () => { live = false }
  }, [url])

  // A reset link needs a moment to sign you in; only then decide it was invalid.
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 4000)
    return () => clearTimeout(t)
  }, [])

  const save = async () => {
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`)
    if (password !== confirm) return setError('The passwords don’t match.')
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) return setError(err.message)
    toast('Password saved. You can now log in with it.')
    router.replace('/me')
  }

  if (!user) {
    return (
      <SafeAreaView style={s.root} edges={['top']}>
        <TopBar title="New password" />
        <View style={s.center}>
          {(loading || !waited) && !linkError ? (
            <ActivityIndicator size="large" color={c.ink} />
          ) : (
            <>
              <Text variant="h3" center>That reset link didn’t work</Text>
              <Text variant="small" muted center>{linkError ? `${linkError.replace(/\.?$/, '.')} ` : ''}It may have expired or already been used. Request a new one from the log-in screen.</Text>
              <Button title="Back to log in" onPress={() => router.replace('/sign-in')} style={s.btn} />
            </>
          )}
        </View>
      </SafeAreaView>
    )
  }

  const eye = (
    <Pressable onPress={() => setShow((v) => !v)} hitSlop={14} accessibilityRole={TOGGLE_ROLE} accessibilityLabel="Show password" accessibilityState={{ checked: show }}>
      {show ? <EyeOff size={16} color={c.muted} /> : <Eye size={16} color={c.muted} />}
    </Pressable>
  )
  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <TopBar title="New password" />
      <KeyboardView bottomInset={insets.bottom}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text variant="small" muted>
            Choose a password for <Text variant="small" weight="700">{user.email}</Text>. You’ll use it to log in from now on.
          </Text>
          <TextField
            label="New password"
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder={`At least ${MIN_PASSWORD} characters`}
            value={password}
            onChangeText={setPassword}
            autoFocus
            right={eye}
            containerStyle={s.mt}
          />
          <TextField
            label="Confirm password"
            secureTextEntry={!show}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            value={confirm}
            onChangeText={setConfirm}
            onSubmitEditing={save}
            containerStyle={s.mtSm}
          />
          {!!error && <FormError>{error}</FormError>}
          <Button title={busy ? 'Saving…' : 'Save password'} block disabled={busy || !password || !confirm} onPress={save} style={s.mt} />
        </ScrollView>
      </KeyboardView>
    </SafeAreaView>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  center: { alignItems: 'center', gap: 12, paddingTop: 80, paddingHorizontal: t.space.xl },
  body: { padding: t.space.lg },
  btn: { alignSelf: 'center' },
  mt: { marginTop: t.space.lg },
  mtSm: { marginTop: t.space.sm },
}))
