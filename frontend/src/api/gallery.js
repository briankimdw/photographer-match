// Booking gallery. Uploads and deletes go through the FastAPI backend (backend/,
// /bookings/:id/gallery), which stores the originals and queues processing; a worker
// then makes watermarked previews. Listing, signed URLs and retry go straight to
// Supabase, where RLS and storage policies decide what each person can see.
import { supabase } from '../lib/supabase.js'

export const ORIGINALS_BUCKET = 'gallery-originals'
export const PREVIEWS_BUCKET = 'gallery-previews'
const URL_SECONDS = 60 * 60

// VITE_API_URL (frontend/.env.local) wins; otherwise the same host as the page on
// port 8001 (8000 is the ML service), so a phone on the LAN reaches the dev machine too.
export const API_URL = (import.meta.env.VITE_API_URL || `http://${location.hostname}:8001`).replace(/\/+$/, '')

const errorFrom = (text, fallback = 'Upload failed. Try again.') => {
  let detail = null
  try {
    detail = JSON.parse(text).detail
  } catch {
    /* not JSON */
  }
  if (typeof detail === 'string' && detail) return new Error(detail)
  if (Array.isArray(detail) && detail[0]?.msg) return new Error(detail[0].msg)
  return new Error(fallback)
}

async function accessToken() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your session expired. Sign in again, then retry.')
  return token
}

// Sends every file as a `photos` form field. onProgress(0..1) follows the bytes sent.
// Resolves to the backend's receipt (202): { booking_id, upload_id, received, total_bytes,
// stored, photos: [{ id, filename, content_type, size_bytes, status }] }.
export async function uploadGallery(bookingId, files, onProgress) {
  const token = await accessToken()

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

// The booking's gallery photos that RLS lets this user see: everything for the
// provider, ready photos for the client once the booking is delivered.
export async function listGallery(bookingId) {
  const { data, error } = await supabase
    .from('gallery_photos')
    .select('id, filename, status, error, original_path, preview_path, thumb_path, width, height, created_at, position')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true })
    .order('position', { ascending: true })
  if (error) throw error
  return data || []
}

// { path: signedUrl } for the paths in one bucket (valid for an hour).
export async function signedUrls(bucket, paths) {
  const list = [...new Set(paths.filter(Boolean))]
  if (!list.length) return {}
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(list, URL_SECONDS)
  if (error) throw error
  const urls = {}
  for (const item of data || []) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl
  }
  return urls
}

// Put a failed photo back in the processing queue (provider only).
export async function retryPhoto(photoId) {
  const { error } = await supabase.rpc('retry_gallery_photo', { p_photo_id: photoId })
  if (error) throw new Error(error.message || 'Couldn’t retry this photo. Try again.')
}

// Delete one photo and its files (provider, while the booking is open).
export async function deletePhoto(bookingId, photoId) {
  const token = await accessToken()
  let res
  try {
    res = await fetch(
      `${API_URL}/bookings/${encodeURIComponent(bookingId)}/gallery/${encodeURIComponent(photoId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    )
  } catch {
    throw new Error('Network problem. Check your connection and try again.')
  }
  if (!res.ok) throw errorFrom(await res.text(), 'Couldn’t delete the photo. Try again.')
}

// Signed link that downloads the clean original (the client, once the booking is completed).
export async function downloadUrl(path, filename) {
  const { data, error } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .createSignedUrl(path, URL_SECONDS, { download: filename || true })
  if (error) throw error
  return data.signedUrl
}
