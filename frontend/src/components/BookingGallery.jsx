import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Download, Images, Loader2, MessageCircle, RotateCcw, Trash2 } from 'lucide-react'
import Sheet from './Sheet.jsx'
import { EmptyState, ErrorState, Loading } from './States.jsx'
import { useStore } from '../store.jsx'
import { PREVIEWS_BUCKET, deletePhoto, downloadUrl, listGallery, retryPhoto, signedUrls } from '../api/gallery.js'

const OPEN_STATUSES = ['confirmed', 'in_progress', 'delivered']
const VIEW_STATUSES = ['delivered', 'completed']
const POLL_MS = 5000
const STATUS_LABEL = { queued: 'Queued', processing: 'Processing', failed: 'Processing failed' }

// The booking's delivery gallery. Providers see every photo with its processing
// status (Retry / Delete); clients see the watermarked previews once the booking
// is delivered, and can download the originals after accepting it.
export default function BookingGallery({ booking }) {
  const b = booking
  const isClient = b.role === 'client'
  const other = isClient ? b.provider : b.client
  const first = (other?.name || '').split(' ')[0] || (isClient ? 'Your vendor' : 'the client')
  const clientCanView = VIEW_STATUSES.includes(b.status)

  if (isClient && !clientCanView) {
    return (
      <EmptyState
        icon={Images}
        title="No photos yet"
        text={`Your photos will appear here once ${first} marks the booking delivered.`}
      />
    )
  }
  return <GalleryGrid b={b} isClient={isClient} first={first} />
}

function GalleryGrid({ b, isClient, first }) {
  const navigate = useNavigate()
  const { toast } = useStore()
  const [photos, setPhotos] = useState(null)
  const [thumbs, setThumbs] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // photo id being retried/deleted
  const [viewing, setViewing] = useState(null) // { photo, url }
  const [downloading, setDownloading] = useState(false)
  const signed = useRef({})

  const editable = !isClient && OPEN_STATUSES.includes(b.status)
  const completed = b.status === 'completed'

  const load = useCallback(async () => {
    try {
      const rows = await listGallery(b.id)
      // Sign only thumbnails we haven't signed yet (polling shouldn't re-sign everything).
      const missing = rows.filter((p) => p.status === 'ready' && p.thumb_path && !signed.current[p.thumb_path]).map((p) => p.thumb_path)
      if (missing.length) {
        signed.current = { ...signed.current, ...(await signedUrls(PREVIEWS_BUCKET, missing)) }
        setThumbs(signed.current)
      }
      setPhotos(rows)
      setError(null)
    } catch (e) {
      console.warn(e)
      setError(e)
    }
  }, [b.id])

  useEffect(() => {
    load()
  }, [load])

  // Re-fetch while anything is still being processed.
  const pending = (photos || []).some((p) => p.status === 'queued' || p.status === 'processing')
  useEffect(() => {
    if (!pending) return undefined
    const t = setTimeout(load, POLL_MS)
    return () => clearTimeout(t)
  }, [pending, photos, load])

  const retry = async (photo) => {
    setBusy(photo.id)
    try {
      await retryPhoto(photo.id)
      toast('Photo queued for processing again.')
      await load()
    } catch (e) {
      toast(e.message || 'Couldn’t retry this photo. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (photo) => {
    if (!window.confirm(`Delete ${photo.filename || 'this photo'} from the gallery? This can’t be undone.`)) return
    setBusy(photo.id)
    try {
      await deletePhoto(b.id, photo.id)
      setPhotos((list) => (list || []).filter((p) => p.id !== photo.id))
      if (viewing?.photo.id === photo.id) setViewing(null)
      toast('Photo deleted.')
    } catch (e) {
      toast(e.message || 'Couldn’t delete the photo. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const open = async (photo) => {
    setViewing({ photo, url: null })
    try {
      const urls = await signedUrls(PREVIEWS_BUCKET, [photo.preview_path])
      setViewing((v) => (v?.photo.id === photo.id ? { photo, url: urls[photo.preview_path] || null } : v))
    } catch (e) {
      console.warn(e)
      toast('Couldn’t open this photo. Try again.')
      setViewing(null)
    }
  }

  const download = async (photo) => {
    setDownloading(true)
    try {
      const url = await downloadUrl(photo.original_path, photo.filename)
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      console.warn(e)
      toast('Couldn’t download the original. Try again.')
    } finally {
      setDownloading(false)
    }
  }

  const chatAction = b.conversationId && (
    <button className="btn sm" onClick={() => navigate(`/inbox/${b.conversationId}`)}>
      <MessageCircle size={14} /> Open chat with {first}
    </button>
  )

  if (error && !photos) return <ErrorState error={error} onRetry={load} />
  if (!photos) return <Loading label="Loading gallery…" />
  if (!photos.length) {
    return (
      <EmptyState
        icon={Images}
        title="No photos yet"
        text={isClient ? `${first} hasn’t added photos to this gallery. Ask in your booking chat.` : `Upload photos from your booking chat with ${first}.`}
        action={chatAction}
      />
    )
  }

  const ready = photos.filter((p) => p.status === 'ready').length

  return (
    <div className="mt-sm">
      <div className="pad-x">
        <div className="inline-icon"><Images size={15} /> <b>Gallery</b></div>
        <div className="muted small">
          {isClient
            ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}${completed ? '' : ' · watermarked previews'}`
            : `${ready} of ${photos.length} ready${pending ? ' · processing…' : ''}`}
        </div>
      </div>
      <div className="grid2 mt-sm">
        {photos.map((p) => {
          const thumb = p.status === 'ready' ? thumbs[p.thumb_path] : null
          return (
            <div key={p.id} className="delivery-item">
              {thumb ? (
                <button style={{ display: 'block', width: '100%', padding: 0 }} onClick={() => open(p)} aria-label={`Open ${p.filename || 'photo'}`}>
                  <img src={thumb} alt={p.filename || 'Gallery photo'} loading="lazy" />
                </button>
              ) : (
                <div
                  className="muted small"
                  style={{ aspectRatio: '4 / 5', background: 'var(--soft)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, textAlign: 'center' }}
                >
                  {p.status === 'failed' ? <AlertTriangle size={18} /> : p.status === 'ready' ? <Images size={18} /> : <Loader2 size={18} />}
                  <span>{STATUS_LABEL[p.status] || 'Ready'}</span>
                  {p.status === 'failed' && !isClient && (
                    <button className="btn sm accent" disabled={busy === p.id} onClick={() => retry(p)}>
                      <RotateCcw size={13} /> Retry
                    </button>
                  )}
                </div>
              )}
              {editable && (
                <button className="fav" disabled={busy === p.id} onClick={() => remove(p)} aria-label={`Delete ${p.filename || 'photo'}`}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <Sheet open={!!viewing} onClose={() => setViewing(null)} title={viewing?.photo.filename || 'Photo'}>
        {viewing && (
          <>
            {viewing.url ? (
              <img src={viewing.url} alt={viewing.photo.filename || 'Gallery photo'} style={{ width: '100%', borderRadius: 10 }} />
            ) : (
              <Loading inline label="Loading preview…" />
            )}
            {!completed && isClient && (
              <div className="muted small mt-sm">Watermarked preview. Originals can be downloaded after you accept the delivery.</div>
            )}
            {completed && (
              <button className="btn accent block mt-sm" disabled={downloading} onClick={() => download(viewing.photo)}>
                <Download size={15} /> {downloading ? 'Preparing…' : 'Download original'}
              </button>
            )}
            <button className="btn ghost block mt-sm" onClick={() => setViewing(null)}>Close</button>
          </>
        )}
      </Sheet>
    </div>
  )
}
