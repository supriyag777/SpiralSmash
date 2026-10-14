import * as THREE from 'three'
import { SLOTS, SLOT_ANGLE, blinkActive, type FloorSpec, type Tower } from './level'
import { DANGER, DANGER_DARK, THEMES } from './theme'

export const FLOOR_SPACING = 3.3
export const PLATFORM_THICKNESS = 0.5
export const PILLAR_RADIUS = 0.85
export const RING_INNER = 0.8
export const RING_OUTER = 2.75
/** Floors built ahead of / kept behind the ball. */
const AHEAD = 12
const BEHIND = 2

export const floorTop = (index: number) => -index * FLOOR_SPACING

type Vec = [number, number, number]

/**
 * Append a flat-shaded ring sector [a0, a1] (angles measured from +z toward +x, matching
 * Object3D.rotation.y) to position/color arrays. Top faces get the full color, walls are baked
 * darker for a crisp low-poly read without extra lights.
 */
export function pushSector(pos: number[], col: number[], a0: number, a1: number, r0: number, r1: number, yTop: number, h: number, base: THREE.Color, segs = 2, center?: Vec) {
  const top = base
  const side = base.clone().multiplyScalar(0.72)
  const bottom = base.clone().multiplyScalar(0.5)
  const [cx, cy, cz] = center ?? [0, 0, 0]
  const p = (r: number, a: number, y: number): Vec => [r * Math.sin(a) - cx, y - cy, r * Math.cos(a) - cz]
  const tri = (a: Vec, b: Vec, d: Vec, color: THREE.Color) => {
    pos.push(...a, ...b, ...d)
    for (let i = 0; i < 3; i += 1) col.push(color.r, color.g, color.b)
  }
  const quad = (a: Vec, b: Vec, d: Vec, e: Vec, color: THREE.Color) => {
    tri(a, b, d, color)
    tri(a, d, e, color)
  }
  const yb = yTop - h
  for (let i = 0; i < segs; i += 1) {
    const s0 = a0 + ((a1 - a0) * i) / segs
    const s1 = a0 + ((a1 - a0) * (i + 1)) / segs
    // top (counter-clockwise seen from above → normal +y)
    quad(p(r0, s0, yTop), p(r1, s0, yTop), p(r1, s1, yTop), p(r0, s1, yTop), top)
    quad(p(r0, s0, yb), p(r0, s1, yb), p(r1, s1, yb), p(r1, s0, yb), bottom)
    quad(p(r1, s0, yTop), p(r1, s0, yb), p(r1, s1, yb), p(r1, s1, yTop), side)
    quad(p(r0, s1, yTop), p(r0, s1, yb), p(r0, s0, yb), p(r0, s0, yTop), side)
  }
  quad(p(r0, a0, yTop), p(r0, a0, yb), p(r1, a0, yb), p(r1, a0, yTop), side)
  quad(p(r1, a1, yTop), p(r1, a1, yb), p(r0, a1, yb), p(r0, a1, yTop), side)
}

export function geometryFrom(pos: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

export type FloorView = {
  spec: FloorSpec
  group: THREE.Group
  blinkMat?: THREE.MeshStandardMaterial
  sweeperPivot?: THREE.Object3D
  broken: boolean
  decals: THREE.Mesh[]
}

const SEAM = 0.018

export class TowerView {
  readonly root = new THREE.Group()
  private views = new Map<number, FloorView>()
  private readonly floorMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0.02 })
  private readonly dangerMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, emissive: new THREE.Color(DANGER), emissiveIntensity: 0.45 })
  private readonly pillarMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 })
  private readonly base: THREE.Group
  private tower: Tower
  private coreModel?: THREE.Object3D
  shadows = true

  constructor(tower: Tower, coreModel?: THREE.Object3D) {
    this.tower = tower
    this.coreModel = coreModel
    this.base = this.buildBase()
    this.root.add(this.base)
  }

  setCoreModel(model: THREE.Object3D): void {
    for (const view of this.views.values()) this.dispose(view)
    this.views.clear()
    this.coreModel = model
  }

  setTower(tower: Tower): void {
    for (const v of this.views.values()) this.dispose(v)
    this.views.clear()
    this.tower = tower
  }

  view(index: number): FloorView | undefined {
    return this.views.get(index)
  }

  /** Keep a window of floors around `current` built; dispose the rest. */
  ensure(current: number): void {
    const lo = Math.max(0, current - BEHIND)
    const hi = Math.min(this.tower.floors.length - 1, current + AHEAD)
    for (const [i, v] of this.views) {
      if (i < lo || i > hi) {
        this.dispose(v)
        this.views.delete(i)
      }
    }
    for (let i = lo; i <= hi; i += 1) if (!this.views.has(i)) this.views.set(i, this.build(this.tower.floors[i]))
  }

  /** Animate blinking hazards and sweepers. */
  update(time: number): void {
    for (const v of this.views.values()) {
      if (v.broken) continue
      if (v.blinkMat && v.spec.blink) {
        const on = blinkActive(v.spec, time)
        const { period, phase, duty } = v.spec.blink
        const u = ((time + phase) % period) / period
        // Telegraph: flicker during the last 22% of the "off" window before turning on.
        const warn = !on && u > 1 - 0.22
        const flick = warn && Math.floor(time * 14) % 2 === 0
        const theme = THEMES[v.spec.stage]
        v.blinkMat.color.set(on ? DANGER : flick ? '#ff9fb2' : theme.safeAlt)
        v.blinkMat.emissive.set(on ? DANGER : '#000000')
        v.blinkMat.emissiveIntensity = on ? 0.55 : 0
        void duty
      }
      if (v.sweeperPivot && v.spec.sweeper) v.sweeperPivot.rotation.y = v.spec.sweeper.start + v.spec.sweeper.speed * time
    }
  }

  markBroken(index: number): FloorView | undefined {
    const v = this.views.get(index)
    if (!v || v.broken) return undefined
    v.broken = true
    v.group.visible = false
    return v
  }

  /** Paint a small splat where the ball bounced (tower-frame angle). */
  splat(index: number, towerAngle: number, hex: string): void {
    const v = this.views.get(index)
    if (!v || v.broken) return
    const g = new THREE.CircleGeometry(0.28 + Math.random() * 0.08, 7)
    g.rotateX(-Math.PI / 2)
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.55, depthWrite: false }))
    const local = towerAngle - v.spec.offset
    const r = (RING_INNER + RING_OUTER) / 2 + 0.05
    m.position.set(r * Math.sin(local), floorTop(v.spec.index) + 0.012, r * Math.cos(local))
    m.rotation.y = Math.random() * 3
    v.group.add(m)
    v.decals.push(m)
    if (v.decals.length > 5) {
      const old = v.decals.shift()!
      old.removeFromParent()
      old.geometry.dispose()
      ;(old.material as THREE.Material).dispose()
    }
  }

  private build(spec: FloorSpec): FloorView {
    const group = new THREE.Group()
    group.rotation.y = spec.offset
    const theme = THEMES[spec.stage]
    const y = floorTop(spec.index)
    const safePos: number[] = []
    const safeCol: number[] = []
    const dPos: number[] = []
    const dCol: number[] = []
    const bPos: number[] = []
    const bCol: number[] = []
    const safeA = new THREE.Color(theme.safe)
    const safeB = new THREE.Color(theme.safeAlt)
    const danger = new THREE.Color(DANGER)
    const dangerDark = new THREE.Color(DANGER_DARK)
    const white = new THREE.Color('#ffffff')
    for (let s = 0; s < SLOTS; s += 1) {
      const kind = spec.slots[s]
      if (kind === 'gap') continue
      const a0 = s * SLOT_ANGLE + SEAM
      const a1 = (s + 1) * SLOT_ANGLE - SEAM
      if (kind === 'safe') pushSector(safePos, safeCol, a0, a1, RING_INNER, RING_OUTER, y, PLATFORM_THICKNESS, s % 2 ? safeA : safeB)
      else if (kind === 'danger') {
        // Raised, striped hazard: a thicker red block with a dark core stripe.
        pushSector(dPos, dCol, a0, a1, RING_INNER, RING_OUTER, y + 0.1, PLATFORM_THICKNESS + 0.1, danger)
        pushSector(dPos, dCol, a0 + 0.02, a1 - 0.02, RING_INNER + 0.9, RING_INNER + 1.15, y + 0.13, 0.05, dangerDark)
      } else pushSector(bPos, bCol, a0, a1, RING_INNER, RING_OUTER, y + 0.05, PLATFORM_THICKNESS + 0.05, white)
    }
    const add = (pos: number[], col: number[], mat: THREE.Material) => {
      if (!pos.length) return undefined
      const mesh = new THREE.Mesh(geometryFrom(pos, col), mat)
      mesh.castShadow = false
      mesh.receiveShadow = this.shadows
      group.add(mesh)
      return mesh
    }
    add(safePos, safeCol, this.floorMat)
    add(dPos, dCol, this.dangerMat)
    let blinkMat: THREE.MeshStandardMaterial | undefined
    if (bPos.length) {
      blinkMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.45, color: theme.safeAlt })
      add(bPos, bCol, blinkMat)
    }
    let sweeperPivot: THREE.Object3D | undefined
    if (spec.sweeper) {
      sweeperPivot = new THREE.Object3D()
      const pos: number[] = []
      const col: number[] = []
      pushSector(pos, col, 0, spec.sweeper.width, RING_INNER + 0.05, RING_OUTER + 0.12, y + 0.34, 0.3, danger, 3)
      pushSector(pos, col, 0.03, spec.sweeper.width - 0.03, RING_OUTER + 0.1, RING_OUTER + 0.2, y + 0.3, 0.22, dangerDark, 3)
      const blade = new THREE.Mesh(geometryFrom(pos, col), this.dangerMat)
      blade.castShadow = this.shadows
      sweeperPivot.add(blade)
      // The pivot lives in the floor frame; its rotation is the sweeper angle relative to the floor.
      group.add(sweeperPivot)
    }
    // The generated art is decorative only; rings, collision, gaps and hazards stay procedural.
    if (this.coreModel) {
      const pillar = this.coreModel.clone(true)
      const bounds = new THREE.Box3().setFromObject(pillar)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      const scale = Math.min((FLOOR_SPACING * 0.76) / Math.max(size.y, 0.1), (PILLAR_RADIUS * 1.9) / Math.max(size.x, size.z, 0.1))
      pillar.scale.setScalar(scale)
      pillar.position.set(-center.x * scale, y - FLOOR_SPACING * 0.2 - center.y * scale, -center.z * scale)
      pillar.traverse(object => { object.userData.sharedAsset = true })
      this.root.add(pillar)
      group.userData.pillar = pillar
    } else {
      // Original procedural core: low-poly, palette-matched fallback.
      const pPos: number[] = []
      const pCol: number[] = []
      const band = new THREE.Color(theme.pillarBand)
      const body = new THREE.Color(theme.pillar)
      const seg = 10
      for (let k = 0; k < seg; k += 1) {
        const a0 = (k / seg) * Math.PI * 2
        const a1 = ((k + 1) / seg) * Math.PI * 2
        pushSector(pPos, pCol, a0, a1, 0.01, PILLAR_RADIUS, y + 0.3, FLOOR_SPACING * 0.72, body, 1)
        pushSector(pPos, pCol, a0, a1, 0.01, PILLAR_RADIUS + 0.04, y - FLOOR_SPACING * 0.42 + 0.3, FLOOR_SPACING * 0.28, band, 1)
      }
      const pillar = new THREE.Mesh(geometryFrom(pPos, pCol), this.pillarMat)
      pillar.receiveShadow = this.shadows
      this.root.add(pillar)
      group.userData.pillar = pillar
    }
    this.root.add(group)
    return { spec, group, blinkMat, sweeperPivot, broken: false, decals: [] }
  }

  private buildBase(): THREE.Group {
    const g = new THREE.Group()
    const index = this.tower.floors.length
    const y = floorTop(index)
    const pos: number[] = []
    const col: number[] = []
    const gold = new THREE.Color('#ffd35c')
    const cream = new THREE.Color('#fff1dc')
    for (let k = 0; k < 16; k += 1) {
      const a0 = (k / 16) * Math.PI * 2
      const a1 = ((k + 1) / 16) * Math.PI * 2
      pushSector(pos, col, a0, a1, 0.01, RING_OUTER + 0.6, y, 1.2, k % 2 ? gold : cream, 1)
      pushSector(pos, col, a0, a1, RING_OUTER + 0.3, RING_OUTER + 0.9, y + 0.35, 0.35, k % 2 ? cream : gold, 1)
    }
    const mesh = new THREE.Mesh(geometryFrom(pos, col), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, emissive: new THREE.Color('#ffb020'), emissiveIntensity: 0.15 }))
    mesh.receiveShadow = true
    g.add(mesh)
    return g
  }

  /** Rebuild the base under a new tower length. */
  resetBase(): void {
    this.base.removeFromParent()
    this.base.traverse(o => (o as THREE.Mesh).geometry?.dispose())
    const b = this.buildBase()
    ;(this as unknown as { base: THREE.Group }).base = b
    this.root.add(b)
  }

  private dispose(v: FloorView): void {
    const pillar = v.group.userData.pillar as THREE.Object3D | undefined
    pillar?.removeFromParent()
    if (pillar && !pillar.userData.sharedAsset) (pillar as THREE.Mesh).geometry?.dispose()
    v.group.removeFromParent()
    v.group.traverse(o => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
    })
    v.blinkMat?.dispose()
    for (const d of v.decals) (d.material as THREE.Material).dispose()
  }
}
