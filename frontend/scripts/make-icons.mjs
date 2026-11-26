/**
 * Generates the app icons and favicon.ico from the land-plot mark in public/favicon.svg.
 * Run by hand after the mark changes (`npm run icons`) and commit the output: the URLs
 * stay the same on purpose, because phones and Google cache icons for months.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pub = path.join(root, 'public')
const icons = path.join(pub, 'icons')
const BLUE = '#0066cc'
const BG = '#ffffff'

// The paths from favicon.svg, without its dark-mode style: app icons sit on white
const paths = [...fs.readFileSync(path.join(pub, 'favicon.svg'), 'utf8').matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1])
if (!paths.length) throw new Error('No paths found in public/favicon.svg')

/** The mark, `mark` px wide, centred on a `size` px opaque square */
function icon(size, mark) {
  const pad = (size - mark) / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${pad} ${pad}) scale(${mark / 24})" fill="none" stroke="${BLUE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${paths.map((d) => `<path d="${d}"/>`).join('')}
  </g>
</svg>`
  return sharp(Buffer.from(svg)).flatten({ background: BG }).png({ compressionLevel: 9 })
}

fs.mkdirSync(icons, { recursive: true })

async function save(pipeline, file) {
  await pipeline.toFile(path.join(icons, file))
  console.log(`icons/${file}`)
}

await save(icon(192, 144), 'icon-192.png')
await save(icon(512, 384), 'icon-512.png')
// Maskable: launchers crop to a circle, so the mark stays inside the central 80% safe zone
await save(icon(512, 290), 'icon-maskable-512.png')
// iOS adds its own rounded corners and needs an opaque square
await save(icon(180, 128), 'apple-touch-icon.png')
await save(icon(96, 80), 'favicon-96.png')

// favicon.ico with PNG-encoded 16, 32 and 48 px images (valid since Windows Vista)
const sizes = [16, 32, 48]
const images = await Promise.all(sizes.map((s) => icon(s, Math.round(s * 0.875)).toBuffer()))
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
sizes.forEach((s, i) => {
  const e = 6 + 16 * i
  header.writeUInt8(s, e)
  header.writeUInt8(s, e + 1)
  header.writeUInt16LE(1, e + 4)
  header.writeUInt16LE(32, e + 6)
  header.writeUInt32LE(images[i].length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += images[i].length
})
fs.writeFileSync(path.join(pub, 'favicon.ico'), Buffer.concat([header, ...images]))
console.log('favicon.ico')
