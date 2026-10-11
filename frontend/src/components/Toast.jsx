import { useStore } from '../store.jsx'

// The live region is always on the page, so a toast that appears inside it is announced.
export default function Toast() {
  const { toastMsg } = useStore()
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  )
}
