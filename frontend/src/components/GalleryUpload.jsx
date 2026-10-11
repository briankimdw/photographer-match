import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sheet from './Sheet.jsx'
import { uploadGallery } from '../api/gallery.js'
import { checkGallery } from '../lib/galleryRules.js'
import { formatBytes } from '../lib/images.js'

// Booking delivery gallery: summary of the picked photos, upload with progress, then the receipt.
// The backend stores the originals and queues them; previews show up in the gallery
// (the booking's Delivery screen) once the worker has processed them.
export default function GalleryUpload({ open, bookingId, files, onClose, onChooseAgain }) {
  const navigate = useNavigate()
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
            Uploaded {result.received} {result.received === 1 ? 'photo' : 'photos'} ({formatBytes(result.total_bytes)}). They’re being processed and will show up in the gallery in a few minutes.
          </div>
          <button
            className="btn accent block mt-sm"
            onClick={() => {
              onClose()
              navigate(`/bookings/${bookingId}/delivery`)
            }}
          >
            View gallery
          </button>
          <button className="btn ghost block mt-sm" onClick={onClose}>Done</button>
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
