export type GameplayConfig = {
  gravity: number
  bounceSpeed: number
  terminalSpeed: number
  rotationSpeed: number
  gapScale: number
  hazardScale: number
  smashThreshold: number
}

export type GameConfig = {
  gameplay: GameplayConfig
  camera: { fov: number; distance: number; follow: number }
  fx: { debrisDensity: number }
}

export const DEFAULT_CONFIG: Readonly<GameConfig> = Object.freeze({
  gameplay: Object.freeze({ gravity: 34, bounceSpeed: 11.5, terminalSpeed: 27, rotationSpeed: 4.4, gapScale: 1, hazardScale: 1, smashThreshold: 3 }),
  camera: Object.freeze({ fov: 52, distance: 10.5, follow: 9 }),
  fx: Object.freeze({ debrisDensity: 1 }),
})

/** Mutable game-owned values, consumed directly by the simulation and camera. */
export const CONFIG: GameConfig = {
  gameplay: { ...DEFAULT_CONFIG.gameplay },
  camera: { ...DEFAULT_CONFIG.camera },
  fx: { ...DEFAULT_CONFIG.fx },
}
