// Style switcher. The art uses a fixed six-colour ramp, so a whole new look is
// just a new ramp: each sprite is redrawn on a canvas with the colours swapped,
// and the resulting images replace the CSS variables the UI paints with.
//
// One set of art, any number of styles, and Peter never has to redraw a sheet.
import { SPRITES } from './panel-layout.js'

// Vite resolves and hashes these at build time, so the urls are correct in dev,
// in the bundle, and behind Tauri's asset protocol.
const FILES = import.meta.glob('./sprites/*.png', { eager: true, query: '?url', import: 'default' })

const url = (name) => FILES[`./sprites/${name}.png`]

// The exact colours in Peter's sheets, darkest to lightest.
// Index 0 is the outline, 5 is the main fill.
const SOURCE = ['000000', '091305', '12270b', '244d15', '3e8725', '50ae30']

export const THEMES = [
  {
    id: 'moss',
    label: 'moss',
    ramp: SOURCE,                     // identity — the art as drawn
    text: '#bfe9a8',
    textDim: '#6f9c5c',
  },
  {
    id: 'slate',
    label: 'slate',
    ramp: ['000000', '05080d', '0d1420', '1c2740', '3a4a70', '5a72a8'],
    text: '#cddcf5',
    textDim: '#7488ad',
  },
  {
    id: 'amber',
    label: 'amber',
    ramp: ['000000', '0f0a02', '26170a', '4d3115', '8a5f22', 'c99433'],
    text: '#f5dfae',
    textDim: '#a8834a',
  },
  {
    id: 'berry',
    label: 'berry',
    ramp: ['000000', '0d0308', '26091a', '4d1330', '8a2258', 'c93f86'],
    text: '#f5c2dc',
    textDim: '#a85f83',
  },
  {
    id: 'ice',
    label: 'ice',
    ramp: ['000000', '03090d', '0b1e26', '16414d', '2b7a8a', '46b8c9'],
    text: '#c2eaf5',
    textDim: '#5f95a8',
  },
]

const STORE = 'dchat.theme.v1'
const DEFAULT = THEMES[0]

const cache = new Map()   // themeId -> { [sprite]: blobUrl }
let current = DEFAULT.id

export function currentTheme() {
  return THEMES.find((t) => t.id === current) ?? DEFAULT
}

export function savedTheme() {
  try {
    const id = localStorage.getItem(STORE)
    if (THEMES.some((t) => t.id === id)) return id
  } catch {}
  return DEFAULT.id
}

function hexToRgb(hex) {
  const n = parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${src}`))
    img.src = src
  })
}

// Decoded source images, loaded once and reused by every style after the first.
let decoded = null
async function decodeAll() {
  if (decoded) return decoded
  const pairs = await Promise.all(SPRITES.map(async (name) => [name, await loadImage(url(name))]))
  decoded = new Map(pairs)
  return decoded
}

// Synchronous on purpose. toBlob is async per sprite and, over seventeen of
// them, took well over a second to switch style. These images are a few
// hundred bytes each, so a data url costs nothing and lands in one frame.
function recolour(img, map) {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0)

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = image.data
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]
    const to = map.get(key)
    if (to) { px[i] = to[0]; px[i + 1] = to[1]; px[i + 2] = to[2] }
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

async function buildTheme(theme) {
  if (cache.has(theme.id)) return cache.get(theme.id)

  const map = new Map()
  SOURCE.forEach((from, i) => {
    const [r, g, b] = hexToRgb(from)
    map.set((r << 16) | (g << 8) | b, hexToRgb(theme.ramp[i]))
  })

  const images = await decodeAll()
  const built = {}
  for (const name of SPRITES) built[name] = recolour(images.get(name), map)
  cache.set(theme.id, built)
  return built
}

/**
 * Paint a theme. The default theme needs no work — styles.css already points
 * at the original art, so switching back just clears the overrides and there
 * is never a flash of unstyled sprites on first load.
 */
export async function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) ?? DEFAULT
  current = theme.id
  try { localStorage.setItem(STORE, theme.id) } catch {}

  const root = document.documentElement
  root.dataset.theme = theme.id
  root.style.setProperty('--text', theme.text)
  root.style.setProperty('--text-dim', theme.textDim)

  if (theme.id === DEFAULT.id) {
    for (const name of SPRITES) root.style.removeProperty(`--sp-${name}`)
    return theme
  }

  const sprites = await buildTheme(theme)
  for (const name of SPRITES) root.style.setProperty(`--sp-${name}`, `url("${sprites[name]}")`)
  return theme
}
