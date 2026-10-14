import qrcode from 'qrcode-generator'

/** Keep only characters accepted by the source game (≤16; no controls or angle brackets). */
export function cleanName(raw: string): string {
  return [...raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim()].slice(0, 16).join('')
}

export type Challenge = { score: number; name: string; day: string | null }

/** Parse `?c=score&n=name&d=YYYY-MM-DD` from the page URL. */
export function readChallenge(search = location.search): Challenge | null {
  const q = new URLSearchParams(search)
  const score = Number(q.get('c'))
  if (!Number.isInteger(score) || score <= 0 || score > 20000) return null
  const name = cleanName(q.get('n') ?? '')
  const d = q.get('d')
  return { score, name, day: d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null }
}

/** Public link to this page carrying the challenge. Relative to the current page, never an internal host. */
export function challengeUrl(score: number, name: string, day: string | null): string {
  const url = new URL(location.pathname, location.origin)
  url.searchParams.set('c', String(score))
  if (name) url.searchParams.set('n', name)
  if (day) url.searchParams.set('d', day)
  return url.toString()
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for iframes without clipboard permission.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

export type CardData = {
  title: string
  sub: string
  score: number
  modeLine: string
  rankLine: string | null
  statsLine: string
  call: string
  scan: string
  url: string
  name: string
  colors: { sky: string; low: string; safe: string; safeAlt: string; accent: string }
  display: string
}

/** Draw the share card (1080×1350) and return it as a PNG blob + data URL. */
export async function drawCard(d: CardData): Promise<{ blob: Blob; url: string }> {
  const W = 1080
  const H = 1350
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  await document.fonts?.ready
  // Background.
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, d.colors.sky)
  bg.addColorStop(1, d.colors.low)
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  // Low-poly shards in the background.
  const rnd = mulberry(d.score * 31 + 7)
  for (let i = 0; i < 26; i += 1) {
    g.fillStyle = i % 2 ? d.colors.accent : d.colors.safe
    g.globalAlpha = 0.08 + rnd() * 0.12
    const x = rnd() * W
    const y = rnd() * H
    const s = 20 + rnd() * 70
    g.beginPath()
    g.moveTo(x, y - s)
    g.lineTo(x + s * 0.9, y + s * 0.5)
    g.lineTo(x - s * 0.8, y + s * 0.6)
    g.closePath()
    g.fill()
  }
  g.globalAlpha = 1
  drawTower(g, 800, 330, d.colors)

  const outlined = (text: string, x: number, y: number, size: number, fill: string, align: CanvasTextAlign = 'left', stroke = 0.16) => {
    g.font = `900 ${size}px ${d.display}`
    g.textAlign = align
    g.textBaseline = 'alphabetic'
    g.lineJoin = 'round'
    g.lineWidth = size * stroke
    g.strokeStyle = '#1b1838'
    g.fillStyle = '#1b1838'
    g.fillText(text, x + size * 0.06, y + size * 0.08)
    g.strokeText(text, x, y)
    g.fillStyle = fill
    g.fillText(text, x, y)
  }
  outlined(d.title, 80, 190, 118, '#ffd35c')
  outlined(d.sub, 86, 262, 44, '#fff7e8', 'left', 0.2)
  // Mode pill.
  pill(g, 80, 310, d.modeLine, d.display, '#7ef9ff')

  // Score plate with hard shadow.
  plate(g, 60, 420, 960, 420)
  g.font = `800 40px ${d.display}`
  g.fillStyle = '#fff7e8'
  g.textAlign = 'left'
  g.fillText(d.name, 110, 500)
  outlined(String(d.score), 540, 690, 230, '#ffd35c', 'center', 0.12)
  if (d.rankLine) {
    g.font = `800 44px ${d.display}`
    g.fillStyle = '#7ef9ff'
    g.textAlign = 'center'
    g.fillText(d.rankLine, 540, 780)
  }
  g.font = `600 36px ${d.display}`
  g.fillStyle = 'rgba(255,247,232,0.85)'
  g.textAlign = 'center'
  g.fillText(d.statsLine, 540, 905)

  // Call to action + QR.
  outlined(d.call, 80, 1080, 88, '#fff7e8', 'left', 0.18)
  g.font = `700 32px ${d.display}`
  g.fillStyle = 'rgba(255,247,232,0.8)'
  g.textAlign = 'left'
  const shortUrl = d.url.replace(/^https?:\/\//, '')
  wrap(g, shortUrl, 80, 1150, 600, 40)
  const qr = qrcode(0, 'M')
  qr.addData(d.url)
  qr.make()
  const n = qr.getModuleCount()
  const size = 300
  const qx = W - size - 80
  const qy = 960
  g.fillStyle = '#1b1838'
  roundRect(g, qx - 14 + 10, qy - 14 + 10, size + 28, size + 28, 22)
  g.fill()
  g.fillStyle = '#ffffff'
  roundRect(g, qx - 14, qy - 14, size + 28, size + 28, 22)
  g.fill()
  const cell = size / n
  g.fillStyle = '#1b1838'
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (qr.isDark(r, c)) g.fillRect(qx + c * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell))
  g.font = `800 30px ${d.display}`
  g.fillStyle = '#fff7e8'
  g.textAlign = 'center'
  g.fillText(d.scan, qx + size / 2, qy + size + 62)

  const blob = await new Promise<Blob>((resolve, reject) => cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'))
  return { blob, url: URL.createObjectURL(blob) }
}

function drawTower(g: CanvasRenderingContext2D, cx: number, cy: number, c: CardData['colors']): void {
  // A stylised stack of ring floors with gaps, seen from slightly above.
  for (let i = 4; i >= 0; i -= 1) {
    const y = cy + i * 62
    const rx = 180
    const ry = 50
    const gapStart = -0.6 + i * 1.1
    for (let s = 0; s < 12; s += 1) {
      const a0 = (s / 12) * Math.PI * 2
      const a1 = ((s + 1) / 12) * Math.PI * 2
      const mid = (a0 + a1) / 2
      const inGap = ((mid - gapStart) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) < 1.1
      if (inGap) continue
      const hazard = (s + i * 5) % 11 === 0
      g.fillStyle = hazard ? '#ff2d55' : s % 2 ? c.safe : c.safeAlt
      g.globalAlpha = Math.sin(mid) > -0.2 ? 1 : 0.8
      g.beginPath()
      g.moveTo(cx + Math.cos(a0) * rx * 0.35, y + Math.sin(a0) * ry * 0.35)
      g.lineTo(cx + Math.cos(a0) * rx, y + Math.sin(a0) * ry)
      g.lineTo(cx + Math.cos(a1) * rx, y + Math.sin(a1) * ry)
      g.lineTo(cx + Math.cos(a1) * rx * 0.35, y + Math.sin(a1) * ry * 0.35)
      g.closePath()
      g.fill()
      g.globalAlpha = 1
      g.strokeStyle = 'rgba(27,24,56,0.55)'
      g.lineWidth = 3
      g.stroke()
    }
  }
  g.fillStyle = '#fff1dc'
  g.fillRect(cx - 48, cy - 40, 96, 320)
  // Ball with hard shadow.
  g.fillStyle = '#1b1838'
  g.beginPath()
  g.arc(cx + 8, cy - 92 + 8, 34, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff7e8'
  g.beginPath()
  g.arc(cx, cy - 92, 34, 0, Math.PI * 2)
  g.fill()
}

function plate(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#1b1838'
  roundRect(g, x + 14, y + 14, w, h, 30)
  g.fill()
  g.fillStyle = 'rgba(42,37,82,0.94)'
  roundRect(g, x, y, w, h, 30)
  g.fill()
  g.lineWidth = 6
  g.strokeStyle = '#ffd35c'
  g.stroke()
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, text: string, font: string, color: string): void {
  g.font = `800 34px ${font}`
  const w = g.measureText(text).width + 50
  g.fillStyle = '#1b1838'
  roundRect(g, x + 6, y + 6, w, 60, 30)
  g.fill()
  g.fillStyle = color
  roundRect(g, x, y, w, 60, 30)
  g.fill()
  g.fillStyle = '#1b1838'
  g.textAlign = 'left'
  g.fillText(text, x + 25, y + 42)
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number): void {
  let line = ''
  let yy = y
  for (const ch of text) {
    if (g.measureText(line + ch).width > max) {
      g.fillText(line, x, yy)
      line = ch
      yy += lh
      if (yy > y + lh * 2) return
    } else line += ch
  }
  g.fillText(line, x, yy)
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
