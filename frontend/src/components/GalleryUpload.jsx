import { useEffect, useState } from 'react'
import Sheet from './Sheet.jsx'
import { uploadGallery } from '../api/gallery.js'
import { checkGallery } from '../lib/galleryRules.js'
import { formatBytes } from '../lib/images.js'

// Booking delivery gallery: summary of the picked photos, upload with progress, then the receipt.
// v1 backend only acknowledges the upload, so the result says plainly that nothing was saved.
export default function GalleryUpload({ open, bookingId, files, onClose, onChooseAgain }) {
  const [state, setState] = useState('idle') // idle | sending | done | failed
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setState('idle')
    setProgress(0)
    setResult(null)
    setError(null)
  }, [open, files])

  const list = Array.from(files || [])
  const total = list.reduce((n, f) => n + f.size, 0)
  const problem = checkGallery(list)
  const sending = state === 'sending'
  const photoCount = `${list.length} ${list.length === 1 ? 'photo' : 'photos'}`
  const percent = Math.round(progress * 100)

  let uploadLabel = `Upload ${photoCount}`
  if (sending) uploadLabel = 'Uploading…'
  else if (state === 'failed') uploadLabel = 'Try again'

  const upload = async () => {
    if (sending || problem) return
    setState('sending')
    setProgress(0)
    setError(null)
    try {
      setResult(await uploadGallery(bookingId, list, setProgress))
      setState('done')
    } catch (e) {
      console.warn(e)
      setError(e.message || 'Upload failed. Try again.')
      setState('failed')
    }
  }

  // Can't be dismissed mid-upload.
  const close = () => {
    if (!sending) onClose()
  }

  return (
    <Sheet open={open} onClose={close} title="Upload gallery">
      <div>
        <b>{photoCount}</b>
        <span className="muted small"> · {formatBytes(total)}</span>
      </div>

      {problem && <div className="callout danger small">{problem}</div>}

      {state === 'done' && result ? (
        <>
          <div className="callout accent small">
            Received {result.received} photos ({formatBytes(result.total_bytes)}). Storage isn’t connected yet, so nothing was saved.
          </div>
          <button className="btn accent block mt-sm" onClick={onClose}>Done</button>
        </>
      ) : (
        <>
          {sending && (
            <div className="mt-sm">
              <div className="muted small">Uploading… {percent}%</div>
              <div className="progress"><div style={{ width: `${percent}%` }} /></div>
            </div>
          )}
          {state === 'failed' && <div className="callout danger small">{error}</div>}
          {problem ? (
            <>
              <button className="btn accent block mt-sm" disabled>Upload {photoCount}</button>
              <button className="btn ghost block mt-sm" onClick={onChooseAgain}>Choose again</button>
            </>
          ) : (
            <button className="btn accent block mt-sm" disabled={sending} onClick={upload}>
              {uploadLabel}
            </button>
          )}
        </>
      )}
    </Sheet>
  )
}
