import { CONFIG, DEFAULT_CONFIG, type GameplayConfig } from './config'
import { SCORE, TOTAL_FLOORS, finishBonus, floorPoints } from './rules'
import { isStageEnd, probe, stageOf, type Tower } from './level'

export const GRAVITY = DEFAULT_CONFIG.gameplay.gravity
export const BOUNCE_SPEED = DEFAULT_CONFIG.gameplay.bounceSpeed
export const TERMINAL_SPEED = DEFAULT_CONFIG.gameplay.terminalSpeed
export const BALL_RADIUS = 0.3
/** Keyboard / stick full-deflection rotation speed (rad/s). */
export const ROT_SPEED = DEFAULT_CONFIG.gameplay.rotationSpeed
/** How fast rotation velocity follows the input (1/s); high = snappy, still eased. */
export const ROT_RESPONSE = 24
/** Floors passed in one fall that arm Smash mode. */
export const SMASH_CHAIN = DEFAULT_CONFIG.gameplay.smashThreshold
/** A bounce this close (rad) to an active hazard edge counts as a near miss. */
export const NEAR_MISS = 0.16

// Must match tower.ts geometry (kept here so the sim has no three.js dependency).
const FLOOR_SPACING = 3.3
const PLATFORM_THICKNESS = 0.5
export const floorY = (index: number) => -index * FLOOR_SPACING

export type SimEvent =
  | { type: 'bounce'; floor: number; near: boolean; points: number }
  | { type: 'pass'; floor: number; chain: number; points: number }
  | { type: 'smashOn' }
  | { type: 'smash'; floor: number; points: number }
  | { type: 'stage'; stage: number; points: number }
  | { type: 'death'; floor: number; cause: 'danger' | 'blink' | 'sweeper' }
  | { type: 'win'; points: number }

export class Sim {
  phi = 0
  prevPhi = 0
  rotVel = 0
  y = floorY(0) + 2.4
  prevY = this.y
  vy = 0
  time = 0
  /** Index of the next intact floor below the ball (== TOTAL_FLOORS → the base). */
  floor = 0
  chain = 0
  bestChain = 0
  smash = false
  score = 0
  floors = 0
  smashes = 0
  nearMisses = 0
  over: null | 'dead' | 'won' = null
  private passing = false
  private nearDone = new Set<number>()

  constructor(readonly tower: Tower, private readonly config: GameplayConfig = CONFIG.gameplay) {}

  get stage(): number {
    return stageOf(Math.min(this.floor, TOTAL_FLOORS - 1))
  }

  /** Tower-frame angle under the ball (the ball sits at world angle 0). */
  get ballAngle(): number {
    return -this.phi
  }

  /**
   * Advance one fixed step. `turn` is the continuous input (−1..1); `drag` is direct rotation in
   * radians from mouse/touch since the previous step.
   */
  step(dt: number, turn: number, drag: number): SimEvent[] {
    const events: SimEvent[] = []
    this.prevPhi = this.phi
    this.prevY = this.y
    if (this.over) return events
    this.time += dt
    const target = turn * this.config.rotationSpeed
    this.rotVel += (target - this.rotVel) * (1 - Math.exp(-dt * ROT_RESPONSE))
    this.phi += this.rotVel * dt + drag
    this.vy = Math.max(this.vy - this.config.gravity * dt, -this.config.terminalSpeed)
    this.y += this.vy * dt

    if (this.floor >= TOTAL_FLOORS) {
      const top = floorY(TOTAL_FLOORS)
      if (this.y - BALL_RADIUS < top) {
        this.y = top + BALL_RADIUS
        this.vy = 0
        const points = finishBonus(this.time)
        this.score += points
        this.over = 'won'
        events.push({ type: 'win', points })
      }
      return events
    }

    const top = floorY(this.floor)
    const spec = this.tower.floors[this.floor]
    if (!this.passing && this.vy < 0 && this.prevY - BALL_RADIUS >= top && this.y - BALL_RADIUS < top) {
      const p = probe(spec, this.ballAngle, this.time)
      if (p.kind === 'gap') this.passing = true
      else if (this.smash) {
        // Smash straight through whatever is there, hazards included.
        this.floors += 1
        const points = floorPoints(this.chain + 1) + SCORE.smash
        this.score += points
        this.smashes += 1
        events.push({ type: 'smash', floor: this.floor, points })
        this.smash = false
        this.chain = 0
        this.vy = Math.min(this.vy, -7)
        this.stageCheck(this.floor, events)
        this.floor += 1
        return events
      } else if (p.kind === 'danger' || p.kind === 'blink' || p.kind === 'sweeper') {
        this.y = top + BALL_RADIUS
        this.vy = 0
        this.over = 'dead'
        events.push({ type: 'death', floor: this.floor, cause: p.kind })
        return events
      } else {
        this.y = top + BALL_RADIUS
        this.vy = this.config.bounceSpeed
        this.chain = 0
        let points = 0
        const near = p.hazardDistance < NEAR_MISS
        if (near && !this.nearDone.has(this.floor)) {
          this.nearDone.add(this.floor)
          points = SCORE.nearMiss
          this.score += points
          this.nearMisses += 1
        }
        events.push({ type: 'bounce', floor: this.floor, near, points })
      }
    }
    if (this.passing && this.y + BALL_RADIUS < top - PLATFORM_THICKNESS) {
      this.passing = false
      this.chain += 1
      this.bestChain = Math.max(this.bestChain, this.chain)
      this.floors += 1
      const points = floorPoints(this.chain)
      this.score += points
      events.push({ type: 'pass', floor: this.floor, chain: this.chain, points })
      if (this.chain >= this.config.smashThreshold && !this.smash) {
        this.smash = true
        events.push({ type: 'smashOn' })
      }
      this.stageCheck(this.floor, events)
      this.floor += 1
    }
    return events
  }

  private stageCheck(floor: number, events: SimEvent[]): void {
    if (!isStageEnd(floor)) return
    const stage = stageOf(floor)
    const points = (stage + 1) * SCORE.stageClear
    this.score += points
    events.push({ type: 'stage', stage, points })
  }
}
