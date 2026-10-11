// Booking gallery upload rules, the same as the backend's (backend/core/gallery.py).
// No imports, so Node can load this file directly.

export const GALLERY_MAX_PHOTOS = 100
export const GALLERY_MAX_FILE_BYTES = 52428800 // 50 MiB
export const GALLERY_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'

const PHOTO_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const PHOTO_EXT = /\.(jpe?g|png|webp|hei[cf])$/i

// Browsers often report HEIC with no type (or application/octet-stream), so then the extension decides.
const isPhoto = ({ name = '', type = '' }) => {
  const kind = (type || '').split(';')[0].trim().toLowerCase()
  if (!kind || kind === 'application/octet-stream') return PHOTO_EXT.test(name)
  return PHOTO_TYPES.includes(kind)
}

// files: array-like of { name, type, size }. Returns null if the pick can be uploaded,
// or a short reason for the first problem.
export function checkGallery(files) {
  const list = Array.from(files || [])
  if (list.length < 1 || list.length > GALLERY_MAX_PHOTOS) return `Upload between 1 and ${GALLERY_MAX_PHOTOS} photos.`
  for (const f of list) {
    if (!(f.size > 0)) return `${f.name} is empty.`
    if (f.size > GALLERY_MAX_FILE_BYTES) return `${f.name} is larger than 50 MB.`
    if (!isPhoto(f)) return `${f.name} isn’t a supported photo type. Use JPEG, PNG, WebP or HEIC.`
  }
  return null
}
