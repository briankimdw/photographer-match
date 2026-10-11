// Screen reader and motion helpers (VoiceOver / TalkBack), used by components and screens.
//   announce('Message sent')                 speak a result (toasts, send / booking results, errors)
//   const reduce = useReduceMotion()         the OS "Reduce motion" setting, live
//   const sr = useScreenReader()             VoiceOver / TalkBack is on, live
//   focusOn(ref)                             move the screen-reader cursor to a view (sheets, results)
//   const ref = useFocusOnShow(open)         ...the same, when `open` turns true
// On the web target these map to aria-live / matchMedia, or do nothing.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { AccessibilityInfo, Platform, type View } from 'react-native'

/** Speak a message now (iOS / Android). On the web, an aria-live region does it. */
export function announce(message: string | null | undefined) {
  if (!message) return
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return
    let el = document.getElementById('a11y-live')
    if (!el) {
      el = document.createElement('div')
      el.id = 'a11y-live'
      el.setAttribute('aria-live', 'polite')
      el.setAttribute('role', 'status')
      Object.assign(el.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' })
      document.body.appendChild(el)
    }
    el.textContent = ''
    const node = el
    setTimeout(() => (node.textContent = message), 50)
    return
  }
  // A short delay so it isn't cut off by the focus change that usually comes with it.
  setTimeout(() => AccessibilityInfo.announceForAccessibility(message), 150)
}

function useA11ySetting(read: () => Promise<boolean>, event: 'reduceMotionChanged' | 'screenReaderChanged') {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    read().then((v) => alive && setOn(!!v)).catch(() => {})
    const sub = AccessibilityInfo.addEventListener(event, (v: boolean) => setOn(!!v))
    return () => {
      alive = false
      sub?.remove?.()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return on
}

/** The OS "Reduce motion" setting (iOS Reduce Motion, Android "Remove animations"). */
export function useReduceMotion() {
  return useA11ySetting(() => AccessibilityInfo.isReduceMotionEnabled(), 'reduceMotionChanged')
}

/** VoiceOver / TalkBack is running. */
export function useScreenReader() {
  return useA11ySetting(() => AccessibilityInfo.isScreenReaderEnabled(), 'screenReaderChanged')
}

/** Move the screen-reader cursor to this view (it should be accessible, e.g. a header). */
export function focusOn(ref: RefObject<View | null>, delay = 350) {
  setTimeout(() => {
    const node = ref.current
    if (!node) return
    if (Platform.OS === 'web') {
      const el = node as unknown as HTMLElement
      if (typeof el.focus === 'function') {
        if (!el.hasAttribute?.('tabindex')) el.setAttribute?.('tabindex', '-1')
        el.focus({ preventScroll: true } as FocusOptions)
      }
      return
    }
    AccessibilityInfo.sendAccessibilityEvent(node as any, 'focus')
  }, delay)
}

/** A ref that gets screen-reader focus each time `shown` turns true (sheets, dialogs, results). */
export function useFocusOnShow<T extends View = View>(shown: boolean, delay?: number) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (shown) focusOn(ref as RefObject<View | null>, delay)
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps
  return ref
}

/** "togglebutton" on iOS / Android; the web has no such role (a plain button there). */
export const TOGGLE_ROLE = (Platform.OS === 'web' ? 'button' : 'togglebutton') as 'togglebutton'

/** "imagebutton" on iOS / Android (react-native-web has no mapping for it: a plain button there). */
export const IMAGE_BUTTON_ROLE = (Platform.OS === 'web' ? 'button' : 'imagebutton') as 'imagebutton'
