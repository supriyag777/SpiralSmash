import { describe, expect, it } from 'vitest'
import { TOTAL_FLOORS } from '../src/game/rules'
import { BALL_RADIUS, GRAVITY, ROT_SPEED, Sim, floorY } from '../src/game/sim'
import { SLOT_ANGLE, angleDiff, dailySeed, generateTower, probe, type Tower } from '../src/game/level'

type Skill = { name: string; delay: number; care: number; speed: number; aimError: number }
const NOVICE: Skill = { name: 'novice', delay: 0.22, care: 0.55, speed: 0.75, aimError: 0.25 }
const REGULAR: Skill = { name: 'regular', delay: 0.14, care: 0.85, speed: 0.9, aimError: 0.12 }
const EXPERT: Skill = { name: 'expert', delay: 0.06, care: 0.99, speed: 1, aimError: 0.04 }

function rngFor(seed: number) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
}

/** Simulated player steers for the current safe gap with bounded reaction delay/error. */
function play(tower: Tower, skill: Skill, seed: number) {
  const sim = new Sim(tower)
  const random = rngFor(seed)
  const dt = 1 / 60
  const history: number[] = []
  let firstScoreAt = -1
  let aimOffset = 0
  let aimFloor = -1
  let cause = ''
  while (!sim.over && sim.time < 180) {
    if (sim.floor !== aimFloor) {
      aimFloor = sim.floor
      aimOffset = (random() - 0.5) * skill.aimError * 2
    }
    let turn = 0
    if (sim.floor < TOTAL_FLOORS) {
      const spec = tower.floors[sim.floor]
      const gaps = spec.slots.filter(slot => slot === 'gap').length
      const gapCenter = spec.offset + (gaps / 2) * SLOT_ANGLE + aimOffset
      const diff = angleDiff(gapCenter, sim.ballAngle)
      // Ball angle is -phi, so positive rotation moves the ball's angle the other way.
      turn = Math.abs(diff) < 0.05 ? 0 : -Math.max(-1, Math.min(1, diff / (0.25 + skill.delay * 2))) * skill.speed
      const distance = sim.y - BALL_RADIUS - floorY(sim.floor)
      const discriminant = sim.vy * sim.vy + 2 * GRAVITY * distance
      const timeToFloor = (sim.vy + Math.sqrt(Math.max(0, discriminant))) / GRAVITY
      if (timeToFloor < 0.35 && random() < skill.care) {
        const choices = [turn, 0, -turn].filter((value, index, all) => all.indexOf(value) === index)
        for (const choice of choices) {
          const prediction = sim.ballAngle - choice * ROT_SPEED * Math.min(timeToFloor, 0.3)
          if (probe(spec, prediction, sim.time + timeToFloor).kind === 'gap' || probe(spec, prediction, sim.time + timeToFloor).kind === 'safe') {
            turn = choice
            break
          }
        }
      }
    }
    history.push(turn)
    const delayed = history[Math.max(0, history.length - 1 - Math.round(skill.delay / dt))]
    for (const event of sim.step(dt, delayed, 0)) if (event.type === 'death') cause = `${event.cause}@stage-${tower.floors[event.floor].stage}`
    if (firstScoreAt < 0 && sim.score > 0) firstScoreAt = sim.time
  }
  return { cause, score: sim.score, floors: sim.floors, time: sim.time, over: sim.over, firstScoreAt, bestChain: sim.bestChain, smashes: sim.smashes }
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const report: string[] = []

describe('simulated multi-run playtest and balance report', () => {
  for (const skill of [NOVICE, REGULAR, EXPERT]) {
    it(`${skill.name}: plays 60 seeded towers with readable starts and short, fair outcomes`, () => {
      const runs = [] as ReturnType<typeof play>[]
      for (let index = 0; index < 60; index += 1) {
        const date = `2026-10-${String((index % 28) + 1).padStart(2, '0')}`
        const tower = generateTower(dailySeed(date) ^ (index * 2654435761))
        const result = play(tower, skill, index + 1)
        runs.push(result)
        expect(result.time).toBeLessThan(180)
        expect(result.floors).toBeGreaterThanOrEqual(0)
        expect(result.floors).toBeLessThanOrEqual(TOTAL_FLOORS)
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThan(20_000)
        if (result.floors > 0) expect(result.score).toBeGreaterThan(0)
      }
      const scoredStarts = runs.map(run => run.firstScoreAt).filter(time => time >= 0)
      const winCount = runs.filter(run => run.over === 'won').length
      const meanRun = runs.reduce((sum, run) => sum + run.time, 0) / runs.length
      report.push(`${skill.name}: median ${median(runs.map(run => run.floors))} floors · ${median(runs.map(run => run.time)).toFixed(1)}s median / ${meanRun.toFixed(1)}s mean · ${winCount}/60 clears · first score ${median(scoredStarts).toFixed(1)}s · max chain ${Math.max(...runs.map(run => run.bestChain))} · ${runs.reduce((sum, run) => sum + run.smashes, 0)} smashes`)
      expect(scoredStarts.length).toBeGreaterThan(50)
      expect(median(scoredStarts)).toBeLessThan(10)
      expect(median(runs.map(run => run.time))).toBeLessThan(45)
      if (skill === NOVICE) expect(winCount).toBeLessThan(60)
      if (skill === REGULAR) expect(winCount).toBeGreaterThan(0)
    })
  }

  it('prints the 180-run difficulty-tuning report', () => { console.log(`\n${report.join('\n')}`) })
})
