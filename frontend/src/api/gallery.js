// Booking gallery upload: talks to the FastAPI backend (backend/, POST /bookings/:id/gallery).
// v1 only acknowledges what it received; nothing is stored yet.
import { supabase } from '../lib/supabase.js'

// VITE_API_URL (frontend/.env.local) wins; otherwise the same host as the page on
// port 8001 (8000 is the ML service), so a phone on the LAN reaches the dev machine too.
export const API_URL = (import.meta.env.VITE_API_URL || `http://${location.hostname}:8001`).replace(/\/+$/, '')

const errorFrom = (text) => {
  let detail = null
  try {
    detail = JSON.parse(text).detail
  } catch {
    /* not JSON */
  }
  if (typeof detail === 'string' && detail) return new Error(detail)
  if (Array.isArray(detail) && detail[0]?.msg) return new Error(detail[0].msg)
  return new Error('Upload failed. Try again.')
}

// Sends every file as a `photos` form field. onProgress(0..1) follows the bytes sent.
// Resolves to the backend's receipt: { booking_id, received, total_bytes, stored, photos }.
export async function uploadGallery(bookingId, files, onProgress) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your session expired. Sign in again, then retry.')

  const form = new FormData()
  for (const f of files) form.append('photos', f, f.name)

  // XMLHttpRequest rather than fetch: fetch has no upload progress.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}/bookings/${encodeURIComponent(bookingId)}/gallery`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('Upload failed. Try again.'))
        }
      } else {
        reject(errorFrom(xhr.responseText))
      }
    }
    xhr.onerror = () => reject(new Error('Network problem. Check your connection and try again.'))
    xhr.send(form)
  })
}
