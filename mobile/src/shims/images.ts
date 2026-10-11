// Native stand-in for the web's frontend/src/lib/images.js (Metro redirects
// imports of it here, see metro.config.js). The web version decodes photos with
// createImageBitmap + <canvas> and reads EXIF with exifr: none of that exists on
// a phone. Same exports, implemented with expo-image-manipulator.
//
// A "file" on native is an expo-image-picker asset (or anything with a `uri`):
//   { uri, fileName?, mimeType?, fileSize?, width?, height?, exif? }
// To post an album with the shared api/portfolio.js postAlbum(), pass each photo
// through prepareUpload(asset) first: it returns { file, display, settings } where
// file/display.blob are Blobs that the shared XHR upload code can send.
//
// STATUS: written for the Upload screen port; not exercised yet. Verify on a device.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

const MAX_EDGE = 2048
const QUALITY = 0.86
const THUMB_EDGE = 480

export const MAX_PHOTOS = 10
export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const LOW_RES_EDGE = 1200

export type PickedPhoto = {
  uri: string
  fileName?: string | null
  name?: string | null
  mimeType?: string | null
  type?: string | null
  fileSize?: number | null
  size?: number | null
  width?: number
  height?: number
  exif?: Record<string, any> | null
}

const nameOf = (f: PickedPhoto) => f.fileName || f.name || f.uri.split('/').pop() || 'photo.jpg'
const typeOf = (f: PickedPhoto) => f.mimeType || f.type || ''
const sizeOf = (f: PickedPhoto) => f.fileSize ?? f.size ?? 0

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

const RAW_EXT = /\.(cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|dng|raw|3fr|iiq|x3f|srw)$/i

export function quickCheck(file: PickedPhoto): string | null {
  const name = nameOf(file)
  const type = typeOf(file)
  if (RAW_EXT.test(name)) return 'RAW files can’t be posted. Export a JPEG from your editor first.'
  if (type === 'image/gif' || /\.gif$/i.test(name)) return 'GIFs aren’t supported. Use a JPEG, PNG or WebP.'
  if (type && !type.startsWith('image/')) return 'This isn’t a photo. Use a JPEG, PNG or WebP.'
  const size = sizeOf(file)
  if (size > MAX_FILE_BYTES) return `Too large (${formatBytes(size)}). Photos can be up to ${formatBytes(MAX_FILE_BYTES)}.`
  return null
}

export const fileExtension = (file: PickedPhoto) => (nameOf(file).match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase()

const fit = (w: number, h: number, edge: number) => {
  const scale = Math.min(1, edge / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

async function resizeToJpeg(file: PickedPhoto, edge: number, quality: number) {
  const ctx = ImageManipulator.manipulate(file.uri)
  if (file.width && file.height && Math.max(file.width, file.height) > edge) {
    const { width, height } = fit(file.width, file.height, edge)
    ctx.resize({ width, height })
  }
  const image = await ctx.renderAsync()
  // Re-encoding drops all metadata, including GPS (same guarantee as the web canvas copy).
  return image.saveAsync({ format: SaveFormat.JPEG, compress: quality })
}

const blobOf = async (uri: string) => (await fetch(uri)).blob()

export async function makePreview(file: PickedPhoto) {
  const out = await resizeToJpeg(file, THUMB_EDGE, 0.8)
  return { thumbUrl: out.uri, width: file.width ?? out.width, height: file.height ?? out.height }
}

export async function makeDisplayCopy(file: PickedPhoto) {
  const out = await resizeToJpeg(file, MAX_EDGE, QUALITY)
  return { blob: await blobOf(out.uri), width: out.width, height: out.height }
}

// Camera settings from the picker's EXIF (launch the picker with { exif: true }). GPS is never read.
export async function readCameraSettings(file: PickedPhoto) {
  const t = file.exif || {}
  const model = String(t.Model ?? t['{TIFF}']?.Model ?? '').trim()
  const make = String(t.Make ?? t['{TIFF}']?.Make ?? '').trim()
  const exif = t['{Exif}'] || t
  const num = (v: any) => (v == null || Number.isNaN(Number(v)) ? null : Number(v))
  const focal = num(exif.FocalLength)
  const fnum = num(exif.FNumber)
  const exposure = num(exif.ExposureTime)
  const iso = Array.isArray(exif.ISOSpeedRatings) ? exif.ISOSpeedRatings[0] : exif.ISOSpeedRatings ?? exif.ISO
  const settings: Record<string, string | null | undefined> = {
    body: model && make && !model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? `${make} ${model}` : model || make,
    lens: exif.LensModel ? String(exif.LensModel).trim() : null,
    focal: focal ? `${Math.round(focal)}mm` : null,
    aperture: fnum ? `f/${Number(fnum.toFixed(1))}` : null,
    shutter: exposure ? (exposure >= 1 ? `${Number(exposure.toFixed(1))}s` : `1/${Math.round(1 / exposure)}s`) : null,
    iso: iso ? String(iso) : null,
  }
  return Object.fromEntries(Object.entries(settings).filter(([, v]) => v)) as Record<string, string>
}

// Everything postAlbum() needs for one picked photo: { file, display, settings }.
// file is the original as a Blob (with .name/.type, like a browser File).
export async function prepareUpload(asset: PickedPhoto) {
  const original: any = await blobOf(asset.uri)
  original.name = nameOf(asset)
  // RN's Blob.type is a getter with no setter: plain assignment throws in strict mode,
  // so shadow it with an own property (what portfolio.js reads as the upload's content type).
  if (!original.type && typeOf(asset)) Object.defineProperty(original, 'type', { value: typeOf(asset), configurable: true, enumerable: true })
  const [display, settings] = await Promise.all([makeDisplayCopy(asset), readCameraSettings(asset)])
  return { file: original as Blob & { name: string }, display, settings }
}
