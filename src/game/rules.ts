/** Local score rules shared by the simulation, daily tower and device-local records. */
export const STAGE_FLOORS = [10, 10, 10, 10, 10, 10] as const
export const TOTAL_FLOORS = STAGE_FLOORS.reduce((sum, count) => sum + count, 0)

export const SCORE = {
  floor: 10,
  maxMultiplier: 8,
  smash: 20,
  nearMiss: 5,
  stageClear: 50,
  finish: 500,
  parSeconds: 150,
  perSecond: 5,
} as const

export const MIN_MS_PER_FLOOR = 100
export const MAX_RUN_MS = 600_000
export const MAX_SCORE = 20_000
export const RULES_VERSION = 'spiral-smash-v1'
export const BOARD_ID = 'spiral-smash-local-v1'
export const DAY_OFFSET_HOURS = 8

/** A seeded tower is shared by every device for the same UTC+8 calendar day. */
export function boardDay(nowMs = Date.now()): string {
  return new Date(nowMs + DAY_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10)
}

export function floorPoints(chain: number): number {
  return SCORE.floor * Math.max(1, Math.min(Math.floor(chain), SCORE.maxMultiplier))
}

export function stagesCleared(floors: number): number {
  let left = floors
  let count = 0
  for (const floorCount of STAGE_FLOORS) {
    if (left < floorCount) break
    left -= floorCount
    count += 1
  }
  return count
}

export function stageBonusTotal(stages: number): number {
  let sum = 0
  for (let stage = 1; stage <= stages; stage += 1) sum += stage * SCORE.stageClear
  return sum
}

export function finishBonus(seconds: number): number {
  return SCORE.finish + Math.max(0, Math.floor(SCORE.parSeconds - seconds)) * SCORE.perSecond
}

export function checkRun({ score, durationMs, floors }: { score: number; durationMs: number; floors: number }): string | null {
  if (![score, durationMs, floors].every(Number.isSafeInteger)) return 'not_integer'
  if (score < 0 || score > MAX_SCORE) return 'score_bounds'
  if (floors < 0 || floors > TOTAL_FLOORS) return 'floor_bounds'
  if (durationMs < 1000 || durationMs > MAX_RUN_MS) return 'duration_bounds'
  if (score % 5 !== 0) return 'score_granularity'
  if (durationMs < floors * MIN_MS_PER_FLOOR) return 'too_fast'
  const stages = stagesCleared(floors)
  const perFloorMax = SCORE.floor * SCORE.maxMultiplier + SCORE.smash + SCORE.nearMiss
  let max = floors * perFloorMax + stageBonusTotal(stages)
  if (floors === TOTAL_FLOORS) max += finishBonus(durationMs / 1000)
  if (score > max) return 'score_too_high'
  let min = floors * SCORE.floor + stageBonusTotal(stages)
  if (floors === TOTAL_FLOORS) min += SCORE.finish
  if (score < min) return 'score_too_low'
  return null
}
