import { CONFIG, type GameplayConfig } from './config'
import { STAGE_FLOORS, TOTAL_FLOORS } from './rules'

/** Every floor is a ring split into this many equal slots. */
export const SLOTS = 16
export const SLOT_ANGLE = (Math.PI * 2) / SLOTS

export type SlotKind = 'safe' | 'gap' | 'danger' | 'blink'

/** A danger arc that orbits the floor at its own speed. Angles are in the floor's local frame. */
export type Sweeper = { start: number; width: number; speed: number }

export type FloorSpec = {
  index: number
  stage: number
  /** Rotation of slot 0 in the tower frame (radians). */
  offset: number
  slots: SlotKind[]
  sweeper?: Sweeper
  /** Blink hazards are active while ((t + phase) mod period) < period · duty. */
  blink?: { period: number; phase: number; duty: number }
}

export type Tower = { seed: number; floors: FloorSpec[] }

/** Small fast deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a string hash → 32-bit seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const dailySeed = (day: string) => hashSeed(`helix-drop/daily/${day}`)

export function stageOf(floor: number): number {
  let left = floor
  for (let s = 0; s < STAGE_FLOORS.length; s += 1) {
    if (left < STAGE_FLOORS[s]) return s
    left -= STAGE_FLOORS[s]
  }
  return STAGE_FLOORS.length - 1
}

/** True when `floor` is the last floor of its stage. */
export function isStageEnd(floor: number): boolean {
  let acc = 0
  for (const f of STAGE_FLOORS) {
    acc += f
    if (floor === acc - 1) return true
  }
  return false
}

export const wrapAngle = (a: number) => {
  const t = a % (Math.PI * 2)
  return t < 0 ? t + Math.PI * 2 : t
}

/**
 * Difficulty knobs by floor. `d` rises 0 → 1 across the tower; stages add discrete steps so each
 * theme change also feels like a new challenge.
 */
function knobs(index: number, stage: number, difficulty: GameplayConfig) {
  const d = index / (TOTAL_FLOORS - 1)
  const baseGap = index < 5 ? 4 : stage === 0 ? 3 : stage < 3 ? (index % 2 === 0 ? 3 : 2) : stage < 5 ? (index % 4 === 0 ? 3 : 2) : 2
  const scaled = (values: number[]) => Math.min(9, Math.max(0, Math.round(values[stage] * difficulty.hazardScale)))
  return {
    gap: Math.max(2, Math.min(5, Math.round(baseGap * difficulty.gapScale))),
    dangerMin: index < 3 ? 0 : scaled([0, 0, 0, 1, 1, 2]),
    dangerMax: index < 3 ? 0 : Math.max(scaled([1, 1, 2, 2, 3, 3]), scaled([0, 0, 0, 1, 1, 2])),
    blinkChance: stage >= 1 ? Math.min(0.45, (0.05 + 0.04 * stage) * difficulty.hazardScale) : 0,
    sweeperChance: stage >= 2 ? Math.min(0.35, (0.06 + 0.04 * (stage - 2)) * difficulty.hazardScale) : 0,
    blinkPeriod: 2.0 - 0.5 * d,
    /** Chance that the next floor's gap sits right under this one: a "chute" for chains/smash. */
    chute: 0.3 - 0.12 * d,
  }
}

export function generateTower(seed: number, difficulty: GameplayConfig = CONFIG.gameplay): Tower {
  const r = rng(seed)
  const floors: FloorSpec[] = []
  // The first gap sits a quarter turn away so the very first input already scores.
  let offset = 0
  let prevGapCenter = 0
  for (let i = 0; i < TOTAL_FLOORS; i += 1) {
    const stage = stageOf(i)
    const k = knobs(i, stage, difficulty)
    const slots: SlotKind[] = new Array(SLOTS).fill('safe')
    // Gap slots start at local slot 0.
    for (let s = 0; s < k.gap; s += 1) slots[s] = 'gap'
    // Where to put this floor's gap (tower frame): near a quarter/half turn from the previous one,
    // or directly underneath it for a chute.
    let gapCenter: number
    if (i === 0) gapCenter = Math.PI / 2
    else if (r() < k.chute) gapCenter = prevGapCenter + (r() - 0.5) * SLOT_ANGLE * 1.2
    else gapCenter = prevGapCenter + (r() < 0.5 ? -1 : 1) * (Math.PI * (0.35 + r() * 0.55))
    offset = wrapAngle(gapCenter - (k.gap * SLOT_ANGLE) / 2)
    // Slots directly beneath the previous floor's gap are the landing zone: keep them safe so a
    // clean drop never lands on a hazard the player could not see.
    const landing = new Set<number>()
    if (i > 0) {
      const prev = floors[i - 1]
      const prevGap = prev.slots.map((s, j) => (s === 'gap' ? j : -1)).filter(j => j >= 0)
      for (const j of prevGap) {
        const a = wrapAngle(prev.offset + (j + 0.5) * SLOT_ANGLE - offset)
        landing.add(Math.floor(a / SLOT_ANGLE) % SLOTS)
      }
    }
    const free = () => {
      const out: number[] = []
      for (let s = k.gap + 1; s < SLOTS - 1; s += 1) if (slots[s] === 'safe' && !landing.has(s)) out.push(s)
      // Late stages may put a hazard right beside the gap.
      if (stage >= 3) for (const s of [k.gap, SLOTS - 1]) if (slots[s] === 'safe' && !landing.has(s)) out.push(s)
      return out
    }
    const dangers = k.dangerMin + Math.floor(r() * (k.dangerMax - k.dangerMin + 1))
    for (let n = 0; n < dangers; n += 1) {
      const options = free()
      if (!options.length) break
      const s = options[Math.floor(r() * options.length)]
      slots[s] = 'danger'
      // Sometimes grow into a two-slot block for readable larger hazards.
      if (stage >= 2 && r() < 0.35 && s + 1 < SLOTS && slots[s + 1] === 'safe' && !landing.has(s + 1) && s + 1 > k.gap) slots[s + 1] = 'danger'
    }
    let blink: FloorSpec['blink']
    if (r() < k.blinkChance) {
      const options = free()
      const count = stage >= 4 ? 2 : 1
      for (let n = 0; n < count && options.length; n += 1) {
        const pick = options.splice(Math.floor(r() * options.length), 1)[0]
        slots[pick] = 'blink'
      }
      blink = { period: k.blinkPeriod, phase: r() * k.blinkPeriod, duty: 0.5 }
    }
    let sweeper: Sweeper | undefined
    if (r() < k.sweeperChance) {
      const speed = (0.7 + r() * 0.7 + stage * 0.08) * (r() < 0.5 ? -1 : 1)
      sweeper = { start: r() * Math.PI * 2, width: SLOT_ANGLE * 1.25, speed }
    }
    floors.push({ index: i, stage, offset, slots, sweeper, blink })
    prevGapCenter = gapCenter
  }
  return { seed, floors }
}

/** Slot under a tower-frame angle. */
export function slotAt(floor: FloorSpec, towerAngle: number): number {
  return Math.floor(wrapAngle(towerAngle - floor.offset) / SLOT_ANGLE) % SLOTS
}

export function blinkActive(floor: FloorSpec, time: number): boolean {
  if (!floor.blink) return false
  const { period, phase, duty } = floor.blink
  return ((time + phase) % period) / period < duty
}

/** Sweeper arc start (tower frame) at `time`. */
export function sweeperStart(floor: FloorSpec, time: number): number {
  const s = floor.sweeper!
  return wrapAngle(floor.offset + s.start + s.speed * time)
}

/** Signed smallest difference a − b in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = wrapAngle(a - b)
  if (d > Math.PI) d -= Math.PI * 2
  return d
}

export type Probe = { kind: SlotKind | 'sweeper'; /** Distance (rad) from the probe to the nearest active hazard edge. */ hazardDistance: number }

/**
 * What the ball touches on `floor` at tower-frame angle `angle` and run time `time`. Pure, shared by
 * gameplay and tests.
 */
export function probe(floor: FloorSpec, angle: number, time: number): Probe {
  const slot = slotAt(floor, angle)
  let kind: Probe['kind'] = floor.slots[slot]
  const blinkOn = blinkActive(floor, time)
  if (kind === 'blink') kind = blinkOn ? 'blink' : 'safe'
  let nearest = Infinity
  // Distance to hazard slot edges.
  for (let s = 0; s < SLOTS; s += 1) {
    const k = floor.slots[s]
    if (k !== 'danger' && !(k === 'blink' && blinkOn)) continue
    const a0 = floor.offset + s * SLOT_ANGLE
    const a1 = a0 + SLOT_ANGLE
    const inside = wrapAngle(angle - a0) < SLOT_ANGLE
    if (inside) nearest = 0
    else nearest = Math.min(nearest, Math.abs(angleDiff(angle, a0)), Math.abs(angleDiff(angle, a1)))
  }
  if (floor.sweeper) {
    const a0 = sweeperStart(floor, time)
    const w = floor.sweeper.width
    if (wrapAngle(angle - a0) < w) {
      if (kind !== 'gap') kind = 'sweeper'
      nearest = 0
    } else nearest = Math.min(nearest, Math.abs(angleDiff(angle, a0)), Math.abs(angleDiff(angle, a0 + w)))
  }
  return { kind, hazardDistance: nearest }
}
