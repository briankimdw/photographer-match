// Design tokens, mirroring the web app's CSS variables (frontend/src/styles.css :root).
// Light values are the web's; dark values are the native app's own (the web has no
// dark mode yet). Use them through useTheme() / makeStyles(), never hard-coded hex.
//
// Light / dark is the user's choice (Settings > Appearance), not the phone's:
// preference 'light' (default, the web's black-and-white look) | 'dark' | 'system',
// saved in AsyncStorage under THEME_KEY. <AppThemeProvider> (root layout) holds it;
// useThemePreference() reads / changes it; useTheme() / makeStyles() follow it.
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SystemUI from 'expo-system-ui'
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Appearance, StyleSheet, useColorScheme, type TextStyle } from 'react-native'

const light = {
  bg: '#ffffff', // --bg
  ink: '#111111', // --ink (primary text, primary button background)
  onInk: '#ffffff', // text on an ink-colored surface
  muted: '#6b6b6b', // --muted (secondary text)
  faint: '#707070', // inactive tab labels, placeholders (4.5:1 on bg and soft; was #9a9a9a, 2.8:1)
  line: '#ececec', // --line (borders, dividers)
  soft: '#f5f5f4', // --soft (chips, inputs, placeholders)
  card: '#ffffff', // card surfaces
  accent: '#d4401c', // --accent, deepened from the web's #ff5a36 (3.1:1) so text in it and white on it reach 4.6:1
  accentSoft: '#fff0eb', // --accent-soft
  accentInk: '#c13a18', // accent-colored text on accentSoft (4.9:1; accent itself is 4.2:1 there)
  onAccent: '#ffffff',
  ok: '#15803d', // --ok (was #16a34a, 3.3:1 as text)
  warn: '#b45309',
  danger: '#c81e1e', // --danger (4.5:1+ on dangerSoft too)
  dangerSoft: '#fef2f2', // --danger-soft
  pro: '#7c3aed', // --pro (Verified Pro badge)
  id: '#2563eb', // --id (ID verified badge)
  star: '#d97706', // --star (3:1 as an icon on white; the web's #f59e0b is 2.1:1)
  backdrop: 'rgba(0,0,0,0.4)', // sheet backdrop
  overlay: 'rgba(0,0,0,0.55)', // badges on photos
}

export type Colors = typeof light

const dark: Colors = {
  bg: '#0b0b0c',
  ink: '#f4f4f5',
  onInk: '#111111',
  muted: '#a1a1aa',
  faint: '#8e8e96', // 4.5:1+ on bg, soft and card
  line: '#27272a',
  soft: '#18181b',
  card: '#121214',
  accent: '#ff6a4a',
  accentSoft: '#3b1a12',
  accentInk: '#ff6a4a',
  onAccent: '#111111', // white on this bright orange is 2.8:1; near-black is 6.7:1
  ok: '#22c55e',
  warn: '#f59e0b',
  danger: '#f87171',
  dangerSoft: '#3a1414',
  pro: '#7c3aed', // the PRO badge's white text: 5.7:1
  id: '#60a5fa',
  star: '#fbbf24',
  backdrop: 'rgba(0,0,0,0.6)',
  overlay: 'rgba(0,0,0,0.6)',
}

// --radius is 14px; the rest are the radii the web CSS uses repeatedly.
export const radius = { sm: 10, md: 12, lg: 14, xl: 18, sheet: 22, pill: 999 } as const

// The web's spacing steps (.mt-xs 4, .gap-xs 8, .pad 16, .mt-lg 24).
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

// Font: the web uses Inter, falling back to the system UI font. The app uses the
// platform system font (SF / Roboto) for now; load Inter with expo-font later if wanted.
export const font = {
  size: { tiny: 11.5, xs: 12.5, sm: 13, md: 14, body: 15, lg: 17, xl: 20, xxl: 24, hero: 40 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800' } as Record<string, TextStyle['fontWeight']>,
}

export const theme = { light, dark }

export type Theme = { scheme: 'light' | 'dark'; c: Colors; radius: typeof radius; space: typeof space; font: typeof font }

export type Scheme = 'light' | 'dark'
export type ThemePreference = Scheme | 'system'
export const THEME_KEY = 'pm:theme'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'light'

const isPreference = (v: unknown): v is ThemePreference => v === 'light' || v === 'dark' || v === 'system'

const themes: Record<Scheme, Theme> = {
  light: { scheme: 'light', c: light, radius, space, font },
  dark: { scheme: 'dark', c: dark, radius, space, font },
}

type ThemeState = {
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
  scheme: Scheme // what's on screen
  ready: boolean // the saved preference has been read
}

const ThemeContext = createContext<ThemeState | null>(null)

// Native chrome (keyboard, alerts, date pickers, Apple Maps) follows the chosen scheme too.
// 'unspecified' hands it back to the OS. No-op where unsupported (web).
function applyNativeAppearance(pref: ThemePreference) {
  try {
    if (typeof Appearance.setColorScheme === 'function') Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref)
  } catch {}
}

// Started at import so it's usually done before the first render.
let saved: ThemePreference | null = null
const loading: Promise<ThemePreference> = AsyncStorage.getItem(THEME_KEY)
  .then((v) => (saved = isPreference(v) ? v : DEFAULT_THEME_PREFERENCE))
  .catch(() => (saved = DEFAULT_THEME_PREFERENCE))

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(saved ?? DEFAULT_THEME_PREFERENCE)
  const [ready, setReady] = useState(saved != null)
  const system = useColorScheme()

  useEffect(() => {
    if (ready) return
    let done = false
    const finish = (p: ThemePreference) => {
      if (done) return
      done = true
      setPref(p)
      setReady(true)
    }
    loading.then(finish)
    const timer = setTimeout(() => finish(DEFAULT_THEME_PREFERENCE), 1000) // never hold the app on storage
    return () => clearTimeout(timer)
  }, [ready])

  // While the override is on, useColorScheme() reports it; with 'system' it's the OS value.
  const scheme: Scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference

  useEffect(() => {
    applyNativeAppearance(preference)
  }, [preference])

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(themes[scheme].c.bg).catch(() => {})
  }, [scheme])

  const setPreference = useCallback((p: ThemePreference) => {
    saved = p
    setPref(p)
    AsyncStorage.setItem(THEME_KEY, p).catch(() => {})
  }, [])

  const value = useMemo(() => ({ preference, setPreference, scheme, ready }), [preference, setPreference, scheme, ready])
  return createElement(ThemeContext.Provider, { value }, children)
}

// The preference and its setter (Settings > Appearance).
export function useThemePreference(): ThemeState {
  return (
    useContext(ThemeContext) ?? { preference: DEFAULT_THEME_PREFERENCE, setPreference: () => {}, scheme: 'light', ready: true }
  )
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext)
  return themes[ctx?.scheme ?? 'light']
}

// A tint (a vertical's or occasion's catalog color) made readable as text or an icon on the
// current background: mixed toward black (light) or white (dark) until it reaches `min`
// contrast (4.5 for text, 3 for icons and borders). Catalog tints like sky, amber, teal or
// slate are 1.9 to 2.8:1 as is. Tints that already pass are returned unchanged.
const hexRgb = (h: string) => {
  const x = h.replace('#', '')
  const f = x.length === 3 ? x.split('').map((ch) => ch + ch).join('') : x.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16))
}
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastRatio(a: string, b: string) {
  const [x, y] = [luminance(hexRgb(a)), luminance(hexRgb(b))].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const tintCache = new Map<string, string>()
export function readableTint(tint: string | null | undefined, scheme: Scheme, min = 4.5): string {
  const bg = themes[scheme].c.bg
  if (!tint || !/^#[0-9a-f]{3,8}$/i.test(tint)) return themes[scheme].c.ink
  const key = `${tint}|${scheme}|${min}`
  const hit = tintCache.get(key)
  if (hit) return hit
  const base = hexRgb(tint)
  const to = scheme === 'dark' ? 255 : 0
  let out = tint
  for (let k = 0; k <= 1.0001; k += 0.04) {
    const rgb = base.map((v) => Math.round(v + (to - v) * k))
    const hex = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
    out = hex
    if (contrastRatio(hex, bg) >= min) break
  }
  tintCache.set(key, out)
  return out
}

/** useTheme() + readableTint() for the current scheme. */
export function useReadableTint() {
  const t = useTheme()
  return useCallback((tint: string | null | undefined, min = 4.5) => readableTint(tint, t.scheme, min), [t.scheme])
}

// Theme-aware StyleSheets:
//   const useStyles = makeStyles((t) => ({ box: { backgroundColor: t.c.soft } }))
//   function Thing() { const s = useStyles(); return <View style={s.box} /> }
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (t: Theme) => T) {
  const cache: Partial<Record<'light' | 'dark', T>> = {}
  return function useStyles(): T {
    const t = useTheme()
    return (cache[t.scheme] ??= StyleSheet.create(factory(t)))
  }
}
