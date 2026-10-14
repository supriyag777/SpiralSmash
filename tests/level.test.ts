import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/game/config'
import { SLOT_ANGLE, angleDiff, dailySeed, generateTower, probe, stageOf } from '../src/game/level'
import { STAGE_FLOORS, TOTAL_FLOORS } from '../src/game/rules'

describe('helix tower', () => {
  it('builds a stable daily tower for every device on the same UTC+8 day', () => {
    const a = generateTower(dailySeed('2026-10-13'))
    const b = generateTower(dailySeed('2026-10-13'))
    const c = generateTower(dailySeed('2026-10-14'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c))
    expect(a.floors).toHaveLength(TOTAL_FLOORS)
    expect(TOTAL_FLOORS).toBe(60)
  })

  it('keeps at least one fair opening on every platform and a gentle opening section', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const tower = generateTower(seed * 7919)
      for (const floor of tower.floors) {
        const gapCount = floor.slots.filter(slot => slot === 'gap').length
        expect(gapCount).toBeGreaterThanOrEqual(2)
        expect(floor.slots.length).toBe(16)
        expect(floor.slots.includes('gap')).toBe(true)
      }
      for (const floor of tower.floors.slice(0, 3)) {
        expect(floor.slots.some(slot => slot === 'danger' || slot === 'blink') || !!floor.sweeper).toBe(false)
      }
    }
  })

  it('ramps danger and narrows the opening as sections descend', () => {
    const tower = generateTower(12345)
    const countDanger = (start: number, end: number) => tower.floors.slice(start, end).reduce((total, floor) => total + floor.slots.filter(slot => slot === 'danger' || slot === 'blink').length, 0)
    const earlyGap = tower.floors.slice(0, 10).reduce((n, floor) => n + floor.slots.filter(slot => slot === 'gap').length, 0)
    const lateGap = tower.floors.slice(-10).reduce((n, floor) => n + floor.slots.filter(slot => slot === 'gap').length, 0)
    expect(countDanger(TOTAL_FLOORS - 10, TOTAL_FLOORS)).toBeGreaterThan(countDanger(0, 10) * 2)
    expect(earlyGap).toBeGreaterThan(lateGap)
    expect(tower.floors.some(floor => floor.sweeper)).toBe(true)
    expect(tower.floors.some(floor => floor.blink)).toBe(true)
    expect(stageOf(0)).toBe(0)
    expect(stageOf(STAGE_FLOORS[0])).toBe(1)
  })

  it('makes opening width and hazard rate respond to difficulty settings', () => {
    const seed = 4097
    const easy = { ...DEFAULT_CONFIG.gameplay, gapScale: 1.2, hazardScale: 0.65 }
    const hard = { ...DEFAULT_CONFIG.gameplay, gapScale: 0.65, hazardScale: 1.55 }
    const a = generateTower(seed, easy)
    const b = generateTower(seed, hard)
    const gapTotal = (tower: ReturnType<typeof generateTower>) => tower.floors.reduce((n, floor) => n + floor.slots.filter(slot => slot === 'gap').length, 0)
    const dangerTotal = (tower: ReturnType<typeof generateTower>) => tower.floors.reduce((n, floor) => n + floor.slots.filter(slot => slot === 'danger' || slot === 'blink').length, 0)
    expect(gapTotal(a)).toBeGreaterThan(gapTotal(b))
    expect(dangerTotal(b)).toBeGreaterThan(dangerTotal(a))
  })

  it('aims the collision probe at a gap and wraps angle error along the short arc', () => {
    const tower = generateTower(9)
    const floor = tower.floors[12]
    const gapCount = floor.slots.filter(slot => slot === 'gap').length
    const gapCenter = floor.offset + (gapCount / 2) * SLOT_ANGLE
    expect(probe(floor, gapCenter, 0).kind).toBe('gap')
    expect(Math.abs(angleDiff(0.01, Math.PI * 2 - 0.01))).toBeCloseTo(0.02, 3)
  })
})
