import { useEffect, useRef } from 'react'

// Focus management for anything that sits on top of the page (sheets, overlays, viewers):
// - focus moves into the dialog when it opens (an element marked data-autofocus, else the dialog itself),
// - Tab / Shift+Tab stay inside it, Escape calls onClose,
// - everything else in the phone frame is made inert, so screen readers and the keyboard can't reach it,
// - on close, focus goes back to whatever opened it.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"], audio[controls], video[controls], summary'

export const focusableIn = (root) =>
  [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[inert]') && (el.offsetWidth || el.offsetHeight || el.getClientRects().length))

const stack = [] // open dialogs, innermost last: only the top one handles keys

export default function useDialog(ref, open, onClose) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    const node = ref.current
    if (!node) return undefined
    const trigger = document.activeElement
    const entry = { node }
    stack.push(entry)

    // Inert the rest of the frame: the dialog's siblings, and their ancestors' siblings up to the phone.
    const inerted = []
    let el = node
    while (el && el.parentElement && el.id !== 'phone' && el !== document.body) {
      for (const sib of el.parentElement.children) {
        // Live regions (toasts) stay reachable so confirmations made from inside the dialog are announced.
        if (sib !== el && !sib.hasAttribute('inert') && sib.tagName !== 'SCRIPT' && !sib.matches('[aria-live]')) { sib.setAttribute('inert', ''); inerted.push(sib) }
      }
      el = el.parentElement
    }

    const focusFirst = () => {
      const target = node.querySelector('[data-autofocus]') || node
      if (target === node && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    }
    // After paint, so the opening animation and portal are in place.
    const raf = requestAnimationFrame(() => { if (!node.contains(document.activeElement)) focusFirst() })

    const onKey = (e) => {
      if (stack[stack.length - 1] !== entry) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusableIn(node)
      if (!items.length) { e.preventDefault(); node.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === node || !node.contains(active))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (active === last || !node.contains(active))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey, true)
      stack.splice(stack.indexOf(entry), 1)
      for (const sib of inerted) sib.removeAttribute('inert')
      // Return focus to the trigger if it's still on the page (the dialog may have navigated away).
      // If it was re-rendered away (e.g. the swipe card it sat on), fall back to the main content.
      if (trigger && trigger !== document.body && document.contains(trigger) && typeof trigger.focus === 'function') {
        trigger.focus({ preventScroll: true })
      } else if (stack.length === 0) {
        document.getElementById('main')?.focus({ preventScroll: true })
      }
    }
  }, [open, ref])
}
