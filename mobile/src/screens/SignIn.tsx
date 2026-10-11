// /sign-in: native port of frontend/src/screens/SignIn.jsx. Email + password
// (log in / create account), passwordless email link + 6-digit code, forgot password.
// ?next=/u/abc returns there after signing in.
//
// Email links: the app passes Linking.createURL('/auth/callback') as the redirect.
// For the link (not the code) to open the app, that URL must be in Supabase Auth >
// URL Configuration > Redirect URLs, and /auth/callback must exchange the token
// (TODO: port AuthCallback). Entering the code from the email works without any of that.
// Google: Supabase's OAuth page in an in-app browser session (works in Expo Go); the
// redirect back to Linking.createURL('/auth/callback') must be an allowed Redirect URL
// (exp://** for Expo Go, eventorganizer://** for builds). Native Google account picker
// (signInWithIdToken) would need a development build.
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft, Eye, EyeOff, Mail, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { listProviders } from '@shared/api/catalog.js'
import { Button, KeyboardView, Photo, Segmented, Text, TextField } from '@/components'
import useQuery from '@/hooks/useQuery'
import { supabase } from '@/lib/supabase'
import { completeAuthFromUrl } from '@/screens/account/authLink'
import { safeNext, useAuth } from '@/state/auth'
import { TOGGLE_ROLE } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'
import type { Provider } from '@/types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8
const RESEND_SECONDS = 30

// Turn Supabase auth errors into something a person can act on (same as the web).
const friendly = (error: { message?: string; status?: number } | null) => {
  const msg = (error?.message || '').toLowerCase()
  if (error?.status === 429 || msg.includes('rate limit') || msg.includes('only request this after')) return 'Too many attempts. Wait a minute, then try again.'
  if (msg.includes('invalid login credentials')) return 'Wrong email or password.'
  if (msg.includes('email not confirmed')) return 'Confirm your email first: check your inbox for the link we sent.'
  if (msg.includes('not authorized') || msg.includes('not allowed')) {
    return 'Sign-in emails can only go to approved addresses until email sending is set up. Ask the team to add you.'
  }
  if (msg.includes('password should be') || msg.includes('weak password')) return `Choose a stronger password (at least ${MIN_PASSWORD} characters).`
  if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) return 'That code didn’t work. Check it, or send a new one.'
  return error?.message || 'Something went wrong. Please try again.'
}

// Closes the auth popup on the web target (no-op on phones).
WebBrowser.maybeCompleteAuthSession()

// Dev-only sign-in trace in the Expo server's terminal (never passwords or tokens).
const authLog = (...args: unknown[]) => {
  if (__DEV__) console.log('[auth]', ...args)
}
// A redirect URL with its tokens / codes cut out.
const redact = (url: string) => url.replace(/([?#&](access_token|refresh_token|code|provider_token|token_hash)=)[^&]+/g, '$1…')

type Step = 'form' | 'code' | 'confirm' | 'forgot' | 'forgot-sent'

export default function SignIn() {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ next?: string; mode?: string }>()
  const next = safeNext(params.next)
  const { user, profile, needsWelcome } = useAuth()
  const { data: providers } = useQuery<Provider[]>(() => listProviders(), [])
  const collage = coverMix(providers)

  const [mode, setMode] = useState<'login' | 'signup'>(params.mode === 'signup' ? 'signup' : 'login')
  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resendIn, setResendIn] = useState(0)

  // Signed in (or just finished): move on.
  useEffect(() => {
    if (user && profile) router.replace((needsWelcome ? { pathname: '/welcome', params: { next } } : next) as any)
  }, [user, profile, needsWelcome, next, router])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  const callbackUrl = () => Linking.createURL('/auth/callback', { queryParams: { next } })
  const cleanEmail = email.trim().toLowerCase()

  const go = (nextStep: Step) => {
    setStep(nextStep)
    setError('')
    setNotice('')
  }
  const checkEmail = () => {
    if (!EMAIL_RE.test(cleanEmail)) {
      setError('Enter a valid email address.')
      return false
    }
    return true
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (e: any) {
      // Network failures and browser errors throw instead of returning { error }.
      authLog('sign-in step threw', e?.name, e?.message)
      setError(friendly(e))
    } finally {
      setBusy(false)
    }
  }

  // Google through Supabase: open its sign-in page, wait for the redirect back to the
  // app, then finish the session from that URL (same handler as email links).
  const google = () =>
    run(async () => {
      const redirectTo = Linking.createURL('/auth/callback')
      authLog('google: redirectTo', redirectTo)
      const { data, error: err } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })
      if (err || !data?.url) {
        authLog('google: could not start', err?.status, err?.message)
        return setError(friendly(err))
      }
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
      authLog('google: browser closed', result.type, result.type === 'success' ? redact(result.url) : '')
      if (result.type !== 'success') {
        // Android can hand the redirect to the /auth/callback route instead of this
        // promise; give it a moment, then see whether that signed us in.
        await new Promise((r) => setTimeout(r, 800))
        const { data: now } = await supabase.auth.getSession()
        if (now.session) return
        if (result.type === 'dismiss' || result.type === 'cancel') {
          setError(`Google didn’t send you back to the app. If you ended up on a website, add ${redirectTo.split('/--/')[0]}/** to Supabase → Authentication → URL Configuration → Redirect URLs.`)
        }
        return
      }
      const done = await completeAuthFromUrl(result.url)
      authLog('google: finished', done.handled, done.error || 'ok')
      if (done.error) setError(done.error)
      else if (!done.handled) setError('Google sign-in didn’t finish. Make sure this app’s link is an allowed redirect URL in Supabase.')
    })

  const logIn = () => {
    if (!checkEmail()) return
    run(async () => {
      const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
      authLog('password sign-in', err ? `failed: ${err.status} ${err.name} ${err.message}` : 'ok')
      if (err) setError(friendly(err))
      // On success the auth listener picks up the session and the effect above navigates.
    })
  }

  const signUp = () => {
    if (!checkEmail()) return
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`)
    run(async () => {
      const { data, error: err } = await supabase.auth.signUp({ email: cleanEmail, password, options: { emailRedirectTo: callbackUrl() } })
      if (err) return setError(friendly(err))
      // An existing address comes back with no identities.
      if (data.user && data.user.identities?.length === 0) {
        setMode('login')
        setNotice('You already have an account with this email. Log in instead.')
        return
      }
      if (!data.session) {
        go('confirm')
        setResendIn(RESEND_SECONDS)
      }
    })
  }

  const resendConfirmation = () =>
    run(async () => {
      const { error: err } = await supabase.auth.resend({ type: 'signup', email: cleanEmail, options: { emailRedirectTo: callbackUrl() } })
      if (err) setError(friendly(err))
      else {
        setNotice('Sent again. Check your inbox (and spam).')
        setResendIn(RESEND_SECONDS)
      }
    })

  const sendLink = () => {
    if (!checkEmail()) return
    run(async () => {
      const { error: err } = await supabase.auth.signInWithOtp({ email: cleanEmail, options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true } })
      authLog('email code sent', err ? `failed: ${err.status} ${err.message}` : 'ok')
      if (err) return setError(friendly(err))
      setCode('')
      go('code')
      setResendIn(RESEND_SECONDS)
    })
  }

  const verifyCode = () =>
    run(async () => {
      const { error: err } = await supabase.auth.verifyOtp({ email: cleanEmail, token: code.trim(), type: 'email' })
      authLog('email code check', err ? `failed: ${err.status} ${err.message}` : 'ok')
      if (err) setError(friendly(err))
    })

  const sendReset = () => {
    if (!checkEmail()) return
    run(async () => {
      const { error: err } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: Linking.createURL('/reset-password') })
      if (err) setError(friendly(err))
      else go('forgot-sent')
    })
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))

  const BackLink = ({ label = 'Back' }: { label?: string }) => (
    <Pressable onPress={() => go('form')} style={s.backLink} accessibilityRole="button">
      <ArrowLeft size={14} color={c.muted} />
      <Text variant="small" muted>{label}</Text>
    </Pressable>
  )

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      {/* KeyboardView: KeyboardAvoidingView with behavior={undefined} does nothing on Android edge-to-edge. */}
      <KeyboardView style={s.flex}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <View style={s.collage}>
              {[0, 3].map((start) => (
                <View key={start} style={s.collageRow}>
                  {[0, 1, 2].map((i) => <Photo key={i} uri={collage[start + i]} style={s.tile} />)}
                </View>
              ))}
            </View>
            <Pressable onPress={close} style={s.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
              <X size={22} color={c.ink} />
            </Pressable>
          </View>

          <View style={s.body}>
            {step === 'form' && (
              <>
                <Text variant="display">Event Organizer<Text variant="display" color="accent" accessibilityRole="none">.</Text></Text>
                <Text variant="h2">{mode === 'login' ? 'Welcome back' : 'Find and book vendors you’ll love'}</Text>

                <Button title="Continue with Google" variant="outline" block onPress={google} disabled={busy} style={s.mtSm} />

                <View style={s.divider}>
                  <View style={s.rule} />
                  <Text variant="tiny" muted>or</Text>
                  <View style={s.rule} />
                </View>

                <Segmented
                  options={[{ value: 'login', label: 'Log in' }, { value: 'signup', label: 'Create account' }]}
                  value={mode}
                  onChange={(m) => { setMode(m); setError(''); setNotice('') }}
                />

                <TextField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  containerStyle={s.mt}
                />
                <TextField
                  label="Password"
                  labelRight={mode === 'login' ? (
                    <Pressable onPress={() => go('forgot')} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} accessibilityRole="link"><Text variant="tiny">Forgot password?</Text></Pressable>
                  ) : undefined}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={mode === 'signup' ? `At least ${MIN_PASSWORD} characters` : ''}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  textContentType={mode === 'login' ? 'password' : 'newPassword'}
                  onSubmitEditing={mode === 'login' ? logIn : signUp}
                  right={
                    <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={14} accessibilityRole={TOGGLE_ROLE} accessibilityLabel="Show password" accessibilityState={{ checked: showPassword }}>
                      {showPassword ? <EyeOff size={16} color={c.muted} /> : <Eye size={16} color={c.muted} />}
                    </Pressable>
                  }
                  containerStyle={s.mtSm}
                />
                <Button
                  title={busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Create account'}
                  block
                  disabled={busy || !email.trim() || !password}
                  onPress={mode === 'login' ? logIn : signUp}
                  style={s.mt}
                />
                <Button title="Email me a sign-in link instead" icon={Mail} variant="link" size="sm" disabled={busy} onPress={sendLink} style={s.center} />
              </>
            )}

            {step === 'code' && (
              <>
                <BackLink label="Use a different email" />
                <Text variant="h2">Check your email</Text>
                <Text variant="small" muted>
                  We sent a sign-in link to <Text variant="small" weight="700">{cleanEmail}</Text>. Enter the code from the email here.
                </Text>
                <TextField
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
                  placeholder="••••••"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={10}
                  autoFocus
                  accessibilityLabel="Sign-in code"
                  style={s.code}
                  containerStyle={s.mt}
                />
                <Button title={busy ? 'Checking…' : 'Sign in'} block disabled={busy || code.length < 6} onPress={verifyCode} style={s.mtSm} />
                <Button title={resendIn > 0 ? `Resend email in ${resendIn}s` : 'Resend email'} variant="link" size="sm" disabled={resendIn > 0 || busy} onPress={sendLink} />
              </>
            )}

            {step === 'confirm' && (
              <>
                <BackLink />
                <Text variant="h2">Confirm your email</Text>
                <Text variant="small" muted>
                  We sent a confirmation link to <Text variant="small" weight="700">{cleanEmail}</Text>. Open it to finish creating your account, then log in with your email and password.
                </Text>
                <Button title={resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend confirmation email'} variant="ghost" block disabled={resendIn > 0 || busy} onPress={resendConfirmation} style={s.mt} />
                <Button title="Already confirmed? Log in" variant="link" size="sm" onPress={() => { setMode('login'); go('form') }} style={s.center} />
              </>
            )}

            {step === 'forgot' && (
              <>
                <BackLink label="Back to log in" />
                <Text variant="h2">Reset your password</Text>
                <Text variant="small" muted>Enter your account email and we’ll send a link to choose a new password.</Text>
                <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus containerStyle={s.mt} />
                <Button title={busy ? 'Sending…' : 'Send reset link'} block disabled={busy || !email.trim()} onPress={sendReset} style={s.mtSm} />
              </>
            )}

            {step === 'forgot-sent' && (
              <>
                <BackLink label="Back to log in" />
                <Text variant="h2">Check your email</Text>
                <Text variant="small" muted>
                  If <Text variant="small" weight="700">{cleanEmail}</Text> has an account, a password reset link is on its way. It works once and expires after an hour.
                </Text>
              </>
            )}

            {!!notice && <View style={s.notice}><Text variant="small">{notice}</Text></View>}
            {!!error && <View style={s.error} accessibilityRole="alert"><Text variant="small" color="danger">{error}</Text></View>}

            <Text variant="tiny" muted center style={s.legal}>By continuing you agree to the Terms and Privacy Policy.</Text>
          </View>
        </ScrollView>
      </KeyboardView>
    </SafeAreaView>
  )
}

// Round-robin over providers so the collage isn't all one person's work: up to 6 cover URLs.
function coverMix(providers: Provider[] = []) {
  const out: string[] = []
  const lists = providers.map((p) => p.covers || [])
  for (let round = 0; out.length < 6 && lists.some((l) => l.length > round); round++) {
    for (const l of lists) if (l[round] && out.length < 6) out.push(l[round])
  }
  return out
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  flex: { flex: 1 },
  scroll: { paddingBottom: t.space.xxl },
  hero: { height: 170, overflow: 'hidden' },
  collage: { flex: 1, gap: 2 },
  collageRow: { flex: 1, flexDirection: 'row', gap: 2 },
  tile: { flex: 1, height: '100%' },
  close: { position: 'absolute', top: 10, right: 12, backgroundColor: t.c.bg, borderRadius: 999, padding: 6 },
  body: { padding: 20, gap: 10 },
  mt: { marginTop: t.space.lg },
  mtSm: { marginTop: t.space.sm },
  center: { alignSelf: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  rule: { flex: 1, height: 1, backgroundColor: t.c.line },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  code: { fontSize: 22, letterSpacing: 6, textAlign: 'center' },
  notice: { padding: 12, borderRadius: t.radius.md, backgroundColor: t.c.soft },
  error: { padding: 12, borderRadius: t.radius.md, backgroundColor: t.c.dangerSoft },
  legal: { marginTop: t.space.xl },
}))
