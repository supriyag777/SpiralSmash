import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'
import { generateTower } from '../src/game/level'
import { Sim } from '../src/game/sim'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))

afterEach(() => {
  tuning.apply(defaults)
  tuning.activate('run')
})

describe('registered game-owned Tweak controls', () => {
  it('validates every submitted control before committing, without exposing unsupported gravity', () => {
    const before = tuning.read()
    expect(tuning.controls.some(control => control.id === 'gameplay.gravity')).toBe(false)
    for (const patch of [
      { 'gameplay.rotationSpeed': 8 },
      { 'gameplay.rotationSpeed': 4.41 },
      { unknown: 3 },
      { 'camera.fov': Number.POSITIVE_INFINITY },
      { 'gameplay.rotationSpeed': 5, 'camera.distance': 999 },
    ]) expect(() => tuning.apply(patch)).toThrow()
    expect(tuning.read()).toEqual(before)
    expect(DEFAULT_CONFIG.gameplay.rotationSpeed).toBe(4.4)
  })

  it('updates actual consumers at the declared live and next-run boundaries', () => {
    tuning.activate('run')
    tuning.apply({ 'gameplay.rotationSpeed': 5.2, 'gameplay.gapScale': 0.7, 'gameplay.hazardScale': 1.4 })
    expect(CONFIG.gameplay.rotationSpeed).toBe(5.2)
    expect(CONFIG.gameplay.gapScale).toBe(1)
    expect(tuning.unranked).toBe(true)
    tuning.activate('run')
    expect(CONFIG.gameplay.gapScale).toBe(0.7)
    expect(CONFIG.gameplay.hazardScale).toBe(1.4)

    const sim = new Sim(generateTower(55), CONFIG.gameplay)
    sim.step(1 / 60, 1, 0)
    expect(sim.phi).toBeGreaterThan(0)
    const tower = generateTower(55, CONFIG.gameplay)
    expect(tower.floors[40].slots.filter(slot => slot === 'gap').length).toBeLessThanOrEqual(2)
  })

  it('keeps cosmetics ranked, but latches gameplay changes until a fresh default run', () => {
    tuning.activate('run')
    tuning.apply({ 'camera.fov': 58, 'fx.debrisDensity': 1.25 })
    expect(tuning.unranked).toBe(false)
    tuning.apply({ 'gameplay.hazardScale': 1.3 })
    expect(tuning.unranked).toBe(false)
    tuning.activate('run')
    expect(tuning.unranked).toBe(true)
    tuning.apply(defaults)
    expect(tuning.unranked).toBe(true)
    tuning.activate('run')
    expect(tuning.unranked).toBe(false)
    expect(CONFIG.gameplay.hazardScale).toBe(DEFAULT_CONFIG.gameplay.hazardScale)
  })
})
