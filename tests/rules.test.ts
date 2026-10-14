import { describe, expect, it } from 'vitest'
import { boardDay, finishBonus, floorPoints, MAX_SCORE, SCORE, STAGE_FLOORS, stagesCleared, stageBonusTotal, TOTAL_FLOORS } from '../src/game/rules'

describe('drop score rules', () => {
  it('raises the score multiplier for consecutive gaps and caps it cleanly', () => {
    expect(floorPoints(0)).toBe(SCORE.floor)
    expect(floorPoints(1)).toBe(SCORE.floor)
    expect(floorPoints(3)).toBe(SCORE.floor * 3)
    expect(floorPoints(99)).toBe(SCORE.floor * SCORE.maxMultiplier)
  })

  it('awards a color-changing section clear exactly at its boundary', () => {
    expect(STAGE_FLOORS).toHaveLength(6)
    expect(TOTAL_FLOORS).toBe(60)
    expect(stagesCleared(9)).toBe(0)
    expect(stagesCleared(10)).toBe(1)
    expect(stagesCleared(20)).toBe(2)
    expect(stagesCleared(TOTAL_FLOORS)).toBe(STAGE_FLOORS.length)
    expect(stageBonusTotal(2)).toBe(3 * SCORE.stageClear)
  })

  it('keeps finish reward positive and bounds all-time scores with room for chains', () => {
    expect(finishBonus(0)).toBe(SCORE.finish + SCORE.parSeconds * SCORE.perSecond)
    expect(finishBonus(SCORE.parSeconds + 10)).toBe(SCORE.finish)
    expect(MAX_SCORE).toBeGreaterThan(TOTAL_FLOORS * SCORE.floor * SCORE.maxMultiplier)
  })

  it('resets the reproducible daily tower at midnight UTC+8', () => {
    const before = Date.parse('2026-10-13T15:59:59.000Z')
    const after = Date.parse('2026-10-13T16:00:01.000Z')
    expect(boardDay(before)).toBe('2026-10-13')
    expect(boardDay(after)).toBe('2026-10-14')
  })
})
