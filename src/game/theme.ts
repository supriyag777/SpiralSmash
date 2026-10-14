import * as THREE from 'three'

export type Theme = {
  id: string
  sky: string
  skyLow: string
  fog: string
  safe: string
  safeAlt: string
  pillar: string
  pillarBand: string
  accent: string
}

/** One theme per stage; the palette swaps each time a stage is cleared. */
export const THEMES: Theme[] = [
  { id: 'tangerine', sky: '#3a2c7a', skyLow: '#1d1745', fog: '#2a2160', safe: '#ffb347', safeAlt: '#ffc76e', pillar: '#5b47b8', pillarBand: '#7662d6', accent: '#ffd35c' },
  { id: 'mint', sky: '#0f4a5c', skyLow: '#08232e', fog: '#0c3947', safe: '#3fe0ae', safeAlt: '#76f2cb', pillar: '#1d6f86', pillarBand: '#2a90a8', accent: '#7ef9ff' },
  { id: 'grape', sky: '#3a1760', skyLow: '#170828', fog: '#2a1047', safe: '#b18cff', safeAlt: '#cdb2ff', pillar: '#57308f', pillarBand: '#7447b0', accent: '#ff9bf5' },
  { id: 'lemon', sky: '#123a73', skyLow: '#08183a', fog: '#0f2d5c', safe: '#ffe45c', safeAlt: '#fff29a', pillar: '#2b58ad', pillarBand: '#4677cf', accent: '#8fd3ff' },
  { id: 'lagoon', sky: '#1b1a3d', skyLow: '#0a0a1c', fog: '#16153a', safe: '#4fc3ff', safeAlt: '#8cdcff', pillar: '#a93d6b', pillarBand: '#c95a88', accent: '#ffb3c8' },
  { id: 'aurora', sky: '#0f0f24', skyLow: '#040410', fog: '#0c0c20', safe: '#ffd35c', safeAlt: '#ffe79a', pillar: '#2d2d78', pillarBand: '#4545a3', accent: '#9effa0' },
]

export const DANGER = '#ff2d55'
export const DANGER_DARK = '#9e0f33'
export const BALL = '#fff7e8'

const c = new THREE.Color()
export function color(hex: string): THREE.Color {
  return c.set(hex).clone()
}
