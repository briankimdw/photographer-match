// A tiny, valid baseline JPEG generated in code (no image library): a solid grey
// square, one 8-bit component. Each 8x8 block of a flat image has only a DC
// coefficient, so the entropy-coded data is just "DC difference + end of block".
//
//   solidJpeg({ size: 16, gray: 180 }) -> Uint8Array (a 16x16 image, ~170 bytes)

const u16 = (n) => [(n >> 8) & 0xff, n & 0xff]

function segment(marker, payload) {
  return [0xff, marker, ...u16(payload.length + 2), ...payload]
}

// Minimal Huffman tables. Codes are canonical: lengths come from BITS (count of
// codes per length 1..16), assigned in order. No code is all 1-bits.
//   DC: '0' -> category 0, '10' -> category `cat`
//   AC: '0' -> 0x00 (end of block)
function dht(tableClass, id, bits, values) {
  const counts = new Array(16).fill(0)
  bits.forEach((n, i) => (counts[i] = n))
  return segment(0xc4, [(tableClass << 4) | id, ...counts, ...values])
}

class BitWriter {
  bytes = []
  acc = 0
  n = 0
  write(value, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >> i) & 1)
      this.n++
      if (this.n === 8) this.flush()
    }
  }
  flush() {
    this.bytes.push(this.acc)
    if (this.acc === 0xff) this.bytes.push(0x00) // byte stuffing
    this.acc = 0
    this.n = 0
  }
  finish() {
    if (this.n > 0) this.write(0xff, 8 - this.n) // pad with 1-bits
    return this.bytes
  }
}

const category = (v) => (v === 0 ? 0 : Math.floor(Math.log2(Math.abs(v))) + 1)

export function solidJpeg({ size = 16, gray = 180 } = {}) {
  if (size % 8 !== 0 || size < 8 || size > 2048) throw new Error('size must be a multiple of 8')
  const g = Math.max(0, Math.min(255, Math.round(gray)))
  // Forward DCT of a flat 8x8 block: DC = 8 * (pixel - 128); quantization table is all 1s.
  const dc = 8 * (g - 128)
  const cat = category(dc)
  const blocks = (size / 8) ** 2

  const w = new BitWriter()
  for (let b = 0; b < blocks; b++) {
    const diff = b === 0 ? dc : 0
    if (diff === 0) w.write(0b0, 1) // DC category 0
    else {
      w.write(0b10, 2) // DC category `cat`
      w.write(diff > 0 ? diff : diff - 1 + (1 << cat), cat) // value bits (negatives in ones' complement)
    }
    w.write(0b0, 1) // AC: end of block
  }

  const bytes = [
    0xff, 0xd8, // SOI
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, ...u16(1), ...u16(1), 0, 0]), // APP0 JFIF
    ...segment(0xdb, [0x00, ...new Array(64).fill(1)]), // DQT: table 0, all ones
    ...segment(0xc0, [8, ...u16(size), ...u16(size), 1, 1, 0x11, 0]), // SOF0: 1 component
    ...(cat === 0 ? dht(0, 0, [1], [0]) : dht(0, 0, [1, 1], [0, cat])),
    ...dht(1, 0, [1], [0x00]),
    ...segment(0xda, [1, 1, 0x00, 0, 63, 0]), // SOS
    ...w.finish(),
    0xff, 0xd9, // EOI
  ]
  return Uint8Array.from(bytes)
}

/** Width/height from a baseline JPEG's SOF0 marker (used by the unit test). */
export function jpegSize(bytes) {
  for (let i = 2; i < bytes.length - 8; ) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if (marker === 0xc0) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
    i += 2 + len
  }
  return null
}
