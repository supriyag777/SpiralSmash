import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { CONFIG } from './config'
import { TOTAL_FLOORS } from './rules'
import { Fx } from './fx'
import { generateTower, type Tower } from './level'
import { BALL_RADIUS, Sim, floorY, type SimEvent } from './sim'
import { BALL, DANGER, THEMES, type Theme } from './theme'
import { RING_INNER, RING_OUTER, TowerView } from './tower'

export type Mode = 'title' | 'playing' | 'paused' | 'ended'
export type RunKind = 'daily' | 'practice'

export type RunResult = {
  kind: RunKind
  seed: number
  seedDay: string
  score: number
  floors: number
  durationMs: number
  outcome: 'dead' | 'won'
  bestChain: number
  smashes: number
  nearMisses: number
  stage: number
}

export type GameEvents = {
  /** Floating text near the ball. kind styles it. */
  popup: (text: string, kind: 'score' | 'combo' | 'near' | 'smash' | 'stage' | 'danger' | 'best' | 'target') => void
  flash: (color: string, strength: number) => void
  smashMode: (on: boolean) => void
  chain: (chain: number) => void
  stage: (stage: number, theme: Theme) => void
  scored: (score: number) => void
  end: (run: RunResult) => void
  startRequest: () => void
}

const BALL_ORBIT = (RING_INNER + RING_OUTER) / 2
const TRAIL = 14

export class Game {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 200)
  mode: Mode = 'title'
  reducedMotion = false
  kind: RunKind = 'daily'
  seedDay = ''
  /** Allow a rotate input on the title screen to start the run (off while menus are open). */
  attractStarts = true
  personalBest = 0
  targetScore = 0
  sim!: Sim
  private tower!: Tower
  private towerView!: TowerView
  private fx = new Fx()
  private ball: THREE.Group
  private fallbackBall!: THREE.Mesh
  private modelMaterials: THREE.MeshStandardMaterial[] = []
  private ballMat: THREE.MeshStandardMaterial
  private trail: THREE.InstancedMesh
  private trailPts: THREE.Vector3[] = []
  private sky: THREE.Mesh
  private decor = new THREE.Group()
  private hemi: THREE.HemisphereLight
  private sun: THREE.DirectionalLight
  private camY = 0
  private camFocus = 0
  private qualityFactor = 1
  private shake = 0
  private fovKick = 0
  private squash = 0
  private hitstop = 0
  private slowmo = 0
  private themeFrom: Theme = THEMES[0]
  private themeTo: Theme = THEMES[0]
  private themeT = 1
  private deathTimer = -1
  private bestAnnounced = false
  private targetAnnounced = false
  private skyColors!: THREE.BufferAttribute
  private skyY!: Float32Array
  private seed = 0
  private lastRenderedFloor = -1

  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly audio: Audio, private readonly events: GameEvents, private coreModel?: THREE.Object3D) {
    this.scene.fog = new THREE.Fog(THEMES[0].fog, 14, 46)
    this.hemi = new THREE.HemisphereLight('#ffffff', THEMES[0].skyLow, 1.35)
    this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.1)
    this.sun.castShadow = true
    this.sun.shadow.camera.left = -4
    this.sun.shadow.camera.right = 4
    this.sun.shadow.camera.top = 4
    this.sun.shadow.camera.bottom = -4
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 30
    this.sun.shadow.bias = -0.002
    this.scene.add(this.sun, this.sun.target)

    this.ballMat = new THREE.MeshStandardMaterial({ color: BALL, flatShading: true, roughness: 0.3, emissive: new THREE.Color('#ff6a00'), emissiveIntensity: 0 })
    this.ball = new THREE.Group()
    this.fallbackBall = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_RADIUS, 1), this.ballMat)
    this.fallbackBall.castShadow = true
    this.ball.add(this.fallbackBall)
    this.scene.add(this.ball)
    this.trail = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(BALL_RADIUS, 0),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
      TRAIL,
    )
    this.trail.frustumCulled = false
    this.scene.add(this.trail)

    this.sky = this.buildSky()
    this.scene.add(this.sky)
    this.buildDecor()
    this.scene.add(this.decor)
    this.scene.add(this.fx.group)
    this.setQuality('high')
    this.newRun('daily', 0, '')
  }

  /** Replace the fallback orb once its original GLB has loaded; gameplay never waits for art. */
  setPlayerModel(source: THREE.Object3D): void {
    const model = source.clone(true)
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const scale = (BALL_RADIUS * 2) / Math.max(size.x, size.y, size.z, 0.01)
    model.scale.setScalar(scale)
    model.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
    this.modelMaterials = []
    model.traverse(object => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => {
        const copy = material.clone()
        if ((copy as THREE.MeshStandardMaterial).isMeshStandardMaterial) this.modelMaterials.push(copy as THREE.MeshStandardMaterial)
        return copy
      })
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0]
    })
    this.fallbackBall.visible = false
    this.ball.add(model)
  }

  /** Optional core-model hook; the generated art never owns the ring/collision geometry. */
  setCoreModel(source: THREE.Object3D): void {
    this.coreModel = source
    if (this.towerView) {
      this.towerView.setCoreModel(source)
      this.towerView.ensure(this.sim.floor)
    }
  }

  /** Build (or rebuild) the tower for a seed and park the ball on the first floor. */
  newRun(kind: RunKind, seed: number, seedDay: string): void {
    this.kind = kind
    this.seedDay = seedDay
    this.seed = seed
    this.tower = generateTower(seed, CONFIG.gameplay)
    if (this.towerView) this.towerView.setTower(this.tower)
    else {
      this.towerView = new TowerView(this.tower, this.coreModel)
      this.scene.add(this.towerView.root)
    }
    this.fx.clear()
    this.sim = new Sim(this.tower, CONFIG.gameplay)
    this.towerView.ensure(0)
    this.lastRenderedFloor = 0
    this.camFocus = this.sim.y - 1.4
    this.camY = this.camFocus
    this.themeFrom = this.themeTo = THEMES[0]
    this.themeT = 1
    this.applyTheme(THEMES[0])
    this.audio.stage = 0
    this.deathTimer = -1
    this.bestAnnounced = false
    this.targetAnnounced = false
    this.trailPts = []
    this.ball.visible = true
    this.ball.scale.setScalar(1)
    this.events.smashMode(false)
    this.events.chain(0)
  }

  start(kind: RunKind, seed: number, seedDay: string): void {
    this.newRun(kind, seed, seedDay)
    this.mode = 'playing'
    this.audio.intensity = 1
    this.audio.play('start')
  }

  toTitle(kind: RunKind, seed: number, seedDay: string): void {
    this.newRun(kind, seed, seedDay)
    this.mode = 'title'
    this.audio.intensity = 0
  }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused'
  }

  resume(): void {
    if (this.mode === 'paused') this.mode = 'playing'
  }

  setQuality(q: Quality): void {
    this.renderer.applyQuality(q)
    const shadows = q !== 'low'
    this.sun.castShadow = shadows
    this.sun.shadow.mapSize.set(this.renderer.shadowMapSize, this.renderer.shadowMapSize)
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null
    this.qualityFactor = q === 'low' ? 0.5 : q === 'medium' ? 0.8 : 1
    this.fx.density = this.qualityFactor * CONFIG.fx.debrisDensity
    this.decor.visible = q !== 'low'
    if (this.towerView) this.towerView.shadows = shadows
  }

  /** One fixed simulation step. */
  step(dt: number): void {
    if (this.mode === 'paused') return
    this.fx.step(dt)
    if (this.hitstop > 0) {
      this.hitstop -= dt
      return
    }
    let scale = 1
    if (this.slowmo > 0) {
      this.slowmo -= dt
      scale = 0.35
    }
    if (this.mode === 'title') {
      // Attract: the ball bounces on the first floor; any rotate input starts the run.
      const drag = this.input.takeDrag()
      if (this.attractStarts && (this.input.turn !== 0 || Math.abs(drag) > 0.01)) {
        this.events.startRequest()
        if ((this.mode as Mode) === 'playing') this.sim.phi += drag
        return
      }
      this.sim.step(dt, 0, 0)
      return
    }
    if (this.mode === 'ended') {
      this.sim.step(dt, 0, 0)
      if (this.deathTimer > 0) this.deathTimer -= dt
      return
    }
    const drag = this.input.takeDrag()
    const events = this.sim.step(dt * scale, this.input.turn, drag)
    for (const e of events) this.handle(e)
  }

  private handle(e: SimEvent): void {
    const s = this.sim
    const motion = this.reducedMotion ? 0.35 : 1
    switch (e.type) {
      case 'bounce': {
        this.squash = 1
        this.audio.play('bounce', e.floor)
        this.towerView.splat(e.floor, s.ballAngle, THEMES[this.tower.floors[e.floor].stage].accent)
        this.fx.burst(new THREE.Vector3(0, floorY(e.floor) + 0.05, BALL_ORBIT), Math.round(6 * this.fx.density), '#ffffff', 2.2)
        this.events.chain(0)
        if (e.points > 0) {
          this.audio.play('near')
          this.events.popup(`+${e.points}`, 'near')
          this.events.flash('#ffe36e', 0.25 * motion)
          this.slowmo = 0.12
          this.shake = Math.max(this.shake, 0.08 * motion)
        }
        break
      }
      case 'pass': {
        const v = this.towerView.markBroken(e.floor)
        if (v) this.fx.shatterFloor(v.spec, s.phi, 1)
        this.audio.play('pass', e.chain)
        this.events.popup(e.chain > 1 ? `+${e.points} ×${Math.min(e.chain, 8)}` : `+${e.points}`, e.chain > 1 ? 'combo' : 'score')
        this.events.chain(e.chain)
        this.shake = Math.max(this.shake, (0.05 + 0.03 * e.chain) * motion)
        if (e.chain >= 2) this.events.flash(THEMES[this.sim.stage].accent, Math.min(0.12 + e.chain * 0.05, 0.35) * motion)
        break
      }
      case 'smashOn':
        this.audio.play('smashOn')
        this.audio.intensity = 2
        this.events.smashMode(true)
        break
      case 'smash': {
        const v = this.towerView.markBroken(e.floor)
        if (v) this.fx.shatterFloor(v.spec, s.phi, 2)
        this.audio.play('smash')
        this.audio.intensity = 1
        this.events.smashMode(false)
        this.events.chain(0)
        this.events.popup(`+${e.points}`, 'smash')
        this.events.flash('#ffffff', 0.6 * motion)
        this.shake = Math.max(this.shake, 0.45 * motion)
        this.fovKick = 1
        this.hitstop = 0.06
        break
      }
      case 'stage': {
        this.audio.play('stage')
        this.events.popup(`+${e.points}`, 'stage')
        const next = Math.min(e.stage + 1, THEMES.length - 1)
        if (e.stage + 1 < THEMES.length) {
          this.themeFrom = this.currentTheme()
          this.themeTo = THEMES[next]
          this.themeT = 0
          this.audio.stage = next
          this.events.stage(next, THEMES[next])
        }
        break
      }
      case 'death': {
        this.audio.play('death')
        this.audio.intensity = 0
        this.fx.shatterBall(this.ball.position.clone())
        this.ball.visible = false
        this.events.flash(DANGER, 0.55 * motion)
        this.events.popup('', 'danger')
        this.shake = 0.5 * motion
        this.slowmo = 0.35
        this.finish('dead')
        break
      }
      case 'win':
        this.audio.play('win')
        this.audio.intensity = 0
        this.events.popup(`+${e.points}`, 'stage')
        this.events.flash('#ffe38a', 0.5 * motion)
        for (let i = 0; i < 4; i += 1) this.fx.burst(new THREE.Vector3((Math.random() - 0.5) * 4, floorY(TOTAL_FLOORS) + 1 + i, (Math.random() - 0.5) * 4), 60, ['#ffd35c', '#7ef9ff', '#ff9bf5', '#9effa0'][i], 9)
        this.finish('won')
        break
    }
    if (e.type !== 'bounce' || e.points) this.events.scored(this.sim.score)
    if (this.personalBest > 0 && !this.bestAnnounced && this.sim.score > this.personalBest) {
      this.bestAnnounced = true
      this.audio.play('best')
      this.events.popup('', 'best')
    }
    if (this.targetScore > 0 && !this.targetAnnounced && this.sim.score > this.targetScore) {
      this.targetAnnounced = true
      this.audio.play('best')
      this.events.popup('', 'target')
    }
  }

  private finish(outcome: 'dead' | 'won'): void {
    this.mode = 'ended'
    this.events.smashMode(false)
    const s = this.sim
    this.events.end({
      kind: this.kind,
      seed: this.seed,
      seedDay: this.seedDay,
      score: s.score,
      floors: s.floors,
      durationMs: Math.floor(s.time * 1000),
      outcome,
      bestChain: s.bestChain,
      smashes: s.smashes,
      nearMisses: s.nearMisses,
      stage: s.stage,
    })
  }

  private currentTheme(): Theme {
    return this.themeTo
  }

  render(alpha: number, frameSeconds: number): void {
    const s = this.sim
    const dt = frameSeconds
    this.fx.density = this.qualityFactor * CONFIG.fx.debrisDensity
    const phi = s.prevPhi + (s.phi - s.prevPhi) * alpha
    const y = s.prevY + (s.y - s.prevY) * alpha
    this.towerView.root.rotation.y = phi
    this.fx.group.rotation.y = 0
    if (s.floor !== this.lastRenderedFloor) {
      this.towerView.ensure(s.floor)
      this.lastRenderedFloor = s.floor
    }
    this.towerView.update(s.time)
    this.fx.update(dt, alpha)

    // Ball squash & stretch.
    this.squash = Math.max(0, this.squash - dt * 7)
    const stretch = Math.min(0.35, Math.abs(s.vy) / 60)
    const sq = this.squash * 0.35
    this.ball.scale.set(1 + sq - stretch * 0.4, 1 - sq + stretch, 1 + sq - stretch * 0.4)
    this.ball.position.set(0, y - sq * BALL_RADIUS * 0.5, BALL_ORBIT)
    this.ball.rotation.x -= s.vy * dt * 0.4
    const smash = s.smash && this.mode === 'playing'
    this.ballMat.emissiveIntensity += ((smash ? 1.4 : 0) - this.ballMat.emissiveIntensity) * Math.min(1, dt * 10)
    this.ballMat.color.set(smash ? '#ffd29a' : BALL)
    for (const material of this.modelMaterials) {
      material.emissive.set(smash ? '#ffb94d' : '#000000')
      material.emissiveIntensity += ((smash ? 1.4 : 0) - material.emissiveIntensity) * Math.min(1, dt * 10)
    }

    // Trail while falling fast or in smash mode.
    const showTrail = this.ball.visible && (s.vy < -9 || smash)
    this.trailPts.unshift(this.ball.position.clone())
    if (this.trailPts.length > TRAIL) this.trailPts.pop()
    const m = new THREE.Matrix4()
    const trailMat = this.trail.material as THREE.MeshBasicMaterial
    trailMat.color.set(smash ? '#ff8a3c' : this.themeTo.accent)
    for (let i = 0; i < TRAIL; i += 1) {
      const p = this.trailPts[i] ?? this.ball.position
      const k = showTrail ? 1 - i / TRAIL : 0
      m.compose(p, new THREE.Quaternion(), new THREE.Vector3(k * 0.9, k * 1.2, k * 0.9))
      this.trail.setMatrixAt(i, m)
    }
    this.trail.instanceMatrix.needsUpdate = true

    // Camera: follow the lowest point the ball reached (never bob up with bounces).
    this.camFocus = Math.min(this.camFocus, y - 1.4)
    this.camY += (this.camFocus - this.camY) * (1 - Math.exp(-dt * CONFIG.camera.follow))
    const aspect = this.camera.aspect || 1.6
    const dist = aspect < 1 ? CONFIG.camera.distance * Math.pow(1 / aspect, 0.75) : CONFIG.camera.distance
    this.shake = Math.max(0, this.shake - dt * 1.8)
    const sh = this.shake * this.shake * 2.2
    this.camera.position.set((Math.random() - 0.5) * sh, this.camY + 5.4 + (Math.random() - 0.5) * sh, dist)
    this.camera.lookAt(0, this.camY - 0.6, 0)
    this.fovKick = Math.max(0, this.fovKick - dt * 3)
    const fov = CONFIG.camera.fov + (smash ? 5 : 0) + this.fovKick * 6
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 8)
      this.camera.updateProjectionMatrix()
    }
    this.sun.position.set(4, this.camY + 9, 7)
    this.sun.target.position.set(0, this.camY - 1, 0)
    this.sky.position.set(0, this.camY, 0)

    // Theme cross-fade after each stage.
    if (this.themeT < 1) {
      this.themeT = Math.min(1, this.themeT + dt / 1.2)
      this.applyTheme(this.themeTo, this.themeFrom, this.themeT)
    }
    this.updateDecor(dt)
    this.renderer.render(this.scene, this.camera)
  }

  /** Screen position of the ball in CSS percent, for popups. */
  ballScreen(): { x: number; y: number } {
    const v = this.ball.position.clone().project(this.camera)
    return { x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100 }
  }

  private buildSky(): THREE.Mesh {
    const g = new THREE.SphereGeometry(80, 16, 12)
    const n = g.attributes.position.count
    this.skyColors = new THREE.BufferAttribute(new Float32Array(n * 3), 3)
    this.skyY = new Float32Array(n)
    for (let i = 0; i < n; i += 1) this.skyY[i] = g.attributes.position.getY(i) / 80
    g.setAttribute('color', this.skyColors)
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
  }

  private applyTheme(to: Theme, from: Theme = to, t = 1): void {
    const mix = (a: string, b: string) => new THREE.Color(a).lerp(new THREE.Color(b), t)
    const top = mix(from.sky, to.sky)
    const low = mix(from.skyLow, to.skyLow)
    const fog = mix(from.fog, to.fog)
    const c = new THREE.Color()
    for (let i = 0; i < this.skyY.length; i += 1) {
      c.copy(low).lerp(top, THREE.MathUtils.smoothstep(this.skyY[i], -0.6, 0.7))
      this.skyColors.setXYZ(i, c.r, c.g, c.b)
    }
    this.skyColors.needsUpdate = true
    ;(this.scene.fog as THREE.Fog).color.copy(fog)
    this.hemi.groundColor.copy(low)
    this.decor.children.forEach((o, i) => ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.copy(mix(i % 2 ? from.accent : from.safe, i % 2 ? to.accent : to.safe)))
  }

  private buildDecor(): void {
    const geos = [new THREE.OctahedronGeometry(0.5, 0), new THREE.TetrahedronGeometry(0.6, 0), new THREE.IcosahedronGeometry(0.45, 0)]
    for (let i = 0; i < 36; i += 1) {
      const mesh = new THREE.Mesh(geos[i % 3], new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.5, transparent: true, opacity: 0.55 }))
      this.placeDecor(mesh, (Math.random() - 0.5) * 50)
      mesh.userData.spin = (Math.random() - 0.5) * 1.2
      this.decor.add(mesh)
    }
  }

  private placeDecor(mesh: THREE.Object3D, dy: number): void {
    const a = Math.random() * Math.PI * 2
    const r = 9 + Math.random() * 14
    mesh.position.set(Math.sin(a) * r, this.camY + dy, Math.cos(a) * r - 6)
    mesh.scale.setScalar(0.6 + Math.random() * 1.6)
  }

  private updateDecor(dt: number): void {
    if (!this.decor.visible) return
    for (const o of this.decor.children) {
      o.rotation.x += o.userData.spin * dt
      o.rotation.y += o.userData.spin * dt * 0.7
      o.position.y += dt * 0.4
      if (o.position.y > this.camY + 25) this.placeDecor(o, -25 + Math.random() * -3)
      if (o.position.y < this.camY - 30) this.placeDecor(o, 20 + Math.random() * 5)
    }
  }
}
