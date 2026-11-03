// SVGs from stdin as a JSON array to PNGs on stdout through sharp, each a 4-byte little-endian length and its bytes; see raster.ts
import sharp from 'sharp'

const input: Buffer[] = []
for await (const chunk of process.stdin) input.push(chunk as Buffer)
const svgs = JSON.parse(Buffer.concat(input).toString('utf8')) as string[]
for (const svg of svgs) {
  const png = await sharp(Buffer.from(svg), { limitInputPixels: false }).png({ compressionLevel: 9 }).toBuffer()
  const len = Buffer.alloc(4)
  len.writeUInt32LE(png.length)
  process.stdout.write(len)
  process.stdout.write(png)
}
