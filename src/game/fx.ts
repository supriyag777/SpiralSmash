import * as THREE from 'three'
import { Physics, RAPIER } from '../engine/physics'
import { SLOTS, SLOT_ANGLE, type FloorSpec } from './level'
import { PILLAR_RADIUS, PLATFORM_THICKNESS, RING_INNER, RING_OUTER, floorTop, geometryFrom, pushSector } from './tower'
import { DANGER, THEMES } from './theme'

type Shard = { mesh: THREE.Mesh; body: RAPIER.RigidBody; age: number; life: number }
type Ring = { mesh: THREE.Mesh; age: number; life: number; grow: number }

const MAX_SPARKS = 480
const MID_R = (RING_INNER + RING_OUTER) / 2

/**
 * Juice: platform shards are real Rapier rigid bodies (they tumble and bounce off the pillar),
 * sparks are one additive point cloud, and shockwave rings mark smashes.
 */
export class Fx {
  readonly group = new THREE.Group()
  private physics = new Physics(-26)
  private shards: Shard[] = []
  private rings: Ring[] = []
  private geoCache = new Map<string, THREE.BufferGeometry>()
  private shardMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 })
  private hotMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, emissive: new THREE.Color(DANGER), emissiveIntensity: 0.5 })
  private sparkPos = new Float32Array(MAX_SPARKS * 3)
  private sparkCol = new Float32Array(MAX_SPARKS * 3)
  private sparkBase = new Float32Array(MAX_SPARKS * 3)
  private sparkVel = new Float32Array(MAX_SPARKS * 3)
  private sparkLife = new Float32Array(MAX_SPARKS)
  private sparkAge = new Float32Array(MAX_SPARKS)
  private sparkNext = 0
  private sparks: THREE.Points
  /** Scales shard/spark counts with the quality tier. */
  density = 1

  constructor() {
    // The pillar is a static collider so shards ricochet off it instead of passing through.
    this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(400, PILLAR_RADIUS).setTranslation(0, -390, 0).setRestitution(0.3))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3))
    this.sparks = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    )
    this.sparks.frustumCulled = false
    this.sparkPos.fill(-9999)
    this.group.add(this.sparks)
  }

  private wedge(hex: string): THREE.BufferGeometry {
    let g = this.geoCache.get(hex)
    if (!g) {
      const pos: number[] = []
      const col: number[] = []
      const half = SLOT_ANGLE / 2 - 0.02
      pushSector(pos, col, -half, half, RING_INNER, RING_OUTER, 0, PLATFORM_THICKNESS, new THREE.Color(hex), 2, [0, -PLATFORM_THICKNESS / 2, MID_R])
      g = geometryFrom(pos, col)
      this.geoCache.set(hex, g)
    }
    return g
  }

  /**
   * Break a floor into tumbling wedges. `towerAngle` is the tower rotation at the moment of the
   * break so pieces start exactly where the slots were drawn. `power` 1 = passed, 2 = smashed.
   */
  shatterFloor(spec: FloorSpec, towerAngle: number, power: number): void {
    const theme = THEMES[spec.stage]
    const y = floorTop(spec.index)
    const step = this.density < 0.75 ? 2 : 1
    for (let s = 0; s < SLOTS; s += step) {
      const kind = spec.slots[s]
      if (kind === 'gap') continue
      const hot = kind === 'danger' || kind === 'blink'
      const hex = hot ? DANGER : s % 2 ? theme.safe : theme.safeAlt
      const a = towerAngle + spec.offset + (s + 0.5) * SLOT_ANGLE
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
      const mesh = new THREE.Mesh(this.wedge(hex), hot ? this.hotMat : this.shardMat)
      mesh.position.set(dir.x * MID_R, y - PLATFORM_THICKNESS / 2, dir.z * MID_R)
      mesh.rotation.y = a
      mesh.castShadow = false
      this.group.add(mesh)
      const body = this.physics.addDynamic(mesh, RAPIER.ColliderDesc.cuboid(0.34, PLATFORM_THICKNESS / 2, 0.9).setRestitution(0.35).setDensity(1), 0.25)
      body.setRotation(mesh.quaternion, true)
      this.physics.snap(body)
      const out = (2.6 + Math.random() * 3.2) * power
      const up = power > 1 ? 3 + Math.random() * 2.5 : -2.2 + Math.random() * 1.6
      body.setLinvel({ x: dir.x * out, y: up, z: dir.z * out }, true)
      body.setAngvel({ x: (Math.random() - 0.5) * 9, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 9 }, true)
      this.shards.push({ mesh, body, age: 0, life: power > 1 ? 1.1 + Math.random() * 0.5 : 0.75 + Math.random() * 0.35 })
    }
    // Hard cap on simultaneously simulated shards.
    while (this.shards.length > 90) this.removeShard(this.shards[0])
    const burst = Math.round((power > 1 ? 70 : 26) * this.density)
    this.burst(new THREE.Vector3(0, y, MID_R), burst, power > 1 ? '#fff2b0' : theme.safeAlt, power > 1 ? 9 : 5)
    if (power > 1) this.ring(new THREE.Vector3(0, y + 0.05, 0), '#ffe38a', 1.0, 3.2)
  }

  /** Ball explosion on death. */
  shatterBall(at: THREE.Vector3): void {
    const n = Math.round(10 * Math.max(0.6, this.density))
    const geo = new THREE.IcosahedronGeometry(0.12, 0)
    for (let i = 0; i < n; i += 1) {
      const mesh = new THREE.Mesh(geo, this.hotMat)
      mesh.position.copy(at)
      this.group.add(mesh)
      const body = this.physics.addDynamic(mesh, RAPIER.ColliderDesc.ball(0.12).setRestitution(0.5), 0.2)
      const a = Math.random() * Math.PI * 2
      body.setLinvel({ x: Math.cos(a) * 5, y: 3 + Math.random() * 5, z: Math.sin(a) * 5 }, true)
      this.shards.push({ mesh, body, age: 0, life: 1.6 })
    }
    this.burst(at, Math.round(90 * this.density), DANGER, 8)
    this.burst(at, Math.round(40 * this.density), '#ffffff', 5)
    this.ring(at.clone().setY(at.y - 0.3), DANGER, 0.2, 2.2)
  }

  burst(at: THREE.Vector3, count: number, hex: string, speed: number): void {
    const c = new THREE.Color(hex)
    for (let n = 0; n < count; n += 1) {
      const i = this.sparkNext
      this.sparkNext = (this.sparkNext + 1) % MAX_SPARKS
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const v = speed * (0.35 + Math.random() * 0.65)
      this.sparkPos[i * 3] = at.x + (Math.random() - 0.5) * 1.5
      this.sparkPos[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.3
      this.sparkPos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 1.5
      this.sparkVel[i * 3] = Math.sin(phi) * Math.cos(theta) * v
      this.sparkVel[i * 3 + 1] = Math.abs(Math.cos(phi)) * v * 0.9 + 1
      this.sparkVel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * v
      this.sparkBase[i * 3] = c.r
      this.sparkBase[i * 3 + 1] = c.g
      this.sparkBase[i * 3 + 2] = c.b
      this.sparkLife[i] = 0.45 + Math.random() * 0.5
      this.sparkAge[i] = 0
    }
  }

  ring(at: THREE.Vector3, hex: string, from: number, to: number): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 20),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(at)
    mesh.scale.setScalar(from)
    this.group.add(mesh)
    this.rings.push({ mesh, age: 0, life: 0.45, grow: to })
  }

  /** Fixed-step physics for shards. */
  step(dt: number): void {
    if (this.shards.length) this.physics.step(dt)
  }

  /** Per-frame visuals (interpolated shards, sparks, rings). */
  update(dt: number, alpha: number): void {
    this.physics.sync(alpha)
    for (const s of [...this.shards]) {
      s.age += dt
      const k = s.age / s.life
      if (k > 0.7) s.mesh.scale.setScalar(Math.max(0.01, 1 - (k - 0.7) / 0.3))
      if (k >= 1) this.removeShard(s)
    }
    for (let i = 0; i < MAX_SPARKS; i += 1) {
      if (this.sparkLife[i] <= 0) continue
      this.sparkAge[i] += dt
      const k = this.sparkAge[i] / this.sparkLife[i]
      if (k >= 1) {
        this.sparkLife[i] = 0
        this.sparkPos[i * 3 + 1] = -9999
        continue
      }
      this.sparkVel[i * 3 + 1] -= 14 * dt
      for (let a = 0; a < 3; a += 1) {
        this.sparkPos[i * 3 + a] += this.sparkVel[i * 3 + a] * dt
        this.sparkCol[i * 3 + a] = this.sparkBase[i * 3 + a] * (1 - k)
      }
    }
    this.sparks.geometry.attributes.position.needsUpdate = true
    this.sparks.geometry.attributes.color.needsUpdate = true
    for (const r of [...this.rings]) {
      r.age += dt
      const k = r.age / r.life
      r.mesh.scale.setScalar(THREE.MathUtils.lerp(r.mesh.scale.x, r.grow, 1 - Math.exp(-dt * 12)))
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k)
      if (k >= 1) {
        r.mesh.removeFromParent()
        r.mesh.geometry.dispose()
        ;(r.mesh.material as THREE.Material).dispose()
        this.rings.splice(this.rings.indexOf(r), 1)
      }
    }
  }

  private removeShard(s: Shard): void {
    this.physics.removeBody(s.body)
    s.mesh.removeFromParent()
    this.shards.splice(this.shards.indexOf(s), 1)
  }

  clear(): void {
    for (const s of [...this.shards]) this.removeShard(s)
    this.sparkLife.fill(0)
    this.sparkPos.fill(-9999)
    for (const r of this.rings) r.mesh.removeFromParent()
    this.rings = []
  }
}
