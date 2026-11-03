// SHA-1 in plain JavaScript, synchronous where WebCrypto is not; the same hex as Node's createHash('sha1').
const utf8 = new TextEncoder()

/** 40 hex digits; a string is hashed as its UTF-8 bytes. */
export function sha1(data: string | Uint8Array): string {
  const m = typeof data === 'string' ? utf8.encode(data) : data
  const blocks = ((m.length + 8) >>> 6) + 1
  const w = new Uint32Array(blocks * 16)
  for (let i = 0; i < m.length; i++) w[i >>> 2] |= m[i] << (24 - (i & 3) * 8)
  w[m.length >>> 2] |= 0x80 << (24 - (m.length & 3) * 8)
  // the length in bits as two 32-bit words
  w[blocks * 16 - 2] = Math.floor(m.length / 0x20000000)
  w[blocks * 16 - 1] = (m.length * 8) >>> 0
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const x = new Uint32Array(80)
  for (let o = 0; o < w.length; o += 16) {
    for (let t = 0; t < 16; t++) x[t] = w[o + t]
    for (let t = 16; t < 80; t++) {
      const v = x[t - 3] ^ x[t - 8] ^ x[t - 14] ^ x[t - 16]
      x[t] = (v << 1) | (v >>> 31)
    }
    let [a, b, c, d, e] = h
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6
      const next = (((a << 5) | (a >>> 27)) + f + e + k + x[t]) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = next
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
  }
  return h.map(v => v.toString(16).padStart(8, '0')).join('')
}
