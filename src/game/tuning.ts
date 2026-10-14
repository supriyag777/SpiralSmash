import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_ACTION' | 'NEXT_RUN'
type Boundary = 'jump' | 'dash' | 'run'
type Section = keyof typeof CONFIG
type Control = {
  id: string
  type: 'number'
  category: string
  label: string
  description: string
  unit: string
  default: number
  min: number
  max: number
  step: number
  applyMode: Mode
  integrity: 'COSMETIC' | 'GAMEPLAY'
}
type Binding = { control: Control; boundary?: Boundary; read(): number; write(value: number): void }

const bindings: Binding[] = []
function number<S extends Section>(section: S, key: keyof (typeof CONFIG)[S] & string, label: string, min: number, max: number, step: number, unit: string, boundary?: Boundary): void {
  const values = CONFIG[section] as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as Record<string, number>
  const cosmetic = section === 'camera' || section === 'fx'
  bindings.push({
    control: Object.freeze({
      id: `${section}.${key}`,
      type: 'number',
      category: section === 'gameplay' ? 'Drop & difficulty' : section === 'camera' ? 'Camera' : 'Impact FX',
      label,
      description: boundary === 'run' ? 'Applies when the next run starts.' : boundary ? 'Applies at the next action boundary.' : 'Updates this preview immediately.',
      unit,
      default: defaults[key],
      min,
      max,
      step,
      applyMode: boundary === 'run' ? 'NEXT_RUN' : boundary ? 'NEXT_ACTION' : 'LIVE',
      integrity: cosmetic ? 'COSMETIC' : 'GAMEPLAY',
    }),
    boundary,
    read: () => values[key],
    write: value => { values[key] = value },
  })
}

number('gameplay', 'rotationSpeed', 'Tower rotation speed', 2.4, 6.4, 0.2, 'rad/s')
number('gameplay', 'bounceSpeed', 'Bounce launch speed', 8, 15, 0.5, 'm/s', 'run')
number('gameplay', 'terminalSpeed', 'Maximum fall speed', 18, 40, 1, 'm/s', 'run')
number('gameplay', 'gapScale', 'Opening width', 0.65, 1.2, 0.05, '×', 'run')
number('gameplay', 'hazardScale', 'Hazard frequency', 0.65, 1.55, 0.05, '×', 'run')
number('gameplay', 'smashThreshold', 'Falls to charge smash', 2, 5, 1, 'platforms', 'run')
number('camera', 'fov', 'Camera field of view', 44, 64, 1, '°')
number('camera', 'distance', 'Camera distance', 8, 14, 0.5, 'm')
number('camera', 'follow', 'Camera follow speed', 3, 16, 1, '')
number('fx', 'debrisDensity', 'Shatter debris', 0.5, 1.5, 0.05, '×')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested: Record<string, number> = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
const gameplayModified = () => bindings.some(binding => binding.control.integrity === 'GAMEPLAY' && binding.read() !== binding.control.default)
let unranked = false

const valid = (values: Record<string, number>) =>
  values['gameplay.terminalSpeed'] > values['gameplay.bounceSpeed'] &&
  values['gameplay.gapScale'] >= 0.65 && values['gameplay.hazardScale'] >= 0.65

export const tuning = {
  get unranked(): boolean { return unranked },
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (!entries.length || entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    const candidate = { ...requested, ...patch } as Record<string, number>
    const nextActive = this.read().active
    for (const [id, value] of entries) if (byId.get(id)!.control.applyMode === 'LIVE') nextActive[id] = value
    if (!valid(candidate) || !valid(nextActive)) throw new Error('Conflicting game values')
    requested = candidate
    for (const [id, value] of entries) if (byId.get(id)!.control.applyMode === 'LIVE') byId.get(id)!.write(value)
    unranked ||= gameplayModified()
  },
  activate(boundary: Boundary): void {
    for (const binding of bindings) if (binding.boundary === boundary) binding.write(requested[binding.control.id])
    unranked = boundary === 'run' ? gameplayModified() : unranked || gameplayModified()
  },
}
