/** Unified, frame-sampled input for keyboard, pointer drag, gamepad and landscape touch controls. */
export type Action = 'jump' | 'sprint' | 'dash' | 'pause' | 'confirm' | 'select' | 'back' | 'interact' | 'navUp' | 'navDown' | 'navLeft' | 'navRight' | 'share'
export type InputMethod = 'keyboard' | 'mouse' | 'gamepad' | 'touch'

const KEY_BINDINGS: Record<Action, string[]> = {
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], dash: ['KeyF', 'KeyJ'], pause: ['Escape', 'KeyP'],
  confirm: ['Space'], select: ['Enter', 'NumpadEnter'], back: ['Backspace'], interact: ['KeyE'],
  navUp: ['ArrowUp', 'KeyW'], navDown: ['ArrowDown', 'KeyS'], navLeft: ['ArrowLeft', 'KeyA'], navRight: ['ArrowRight', 'KeyD'], share: ['KeyC'],
}
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }
const PAD_BINDINGS: Record<Action, number[]> = {
  jump: [0], sprint: [4, 10], dash: [2, 5, 7], pause: [9], confirm: [], select: [0], back: [1], interact: [3],
  navUp: [12], navDown: [13], navLeft: [14], navRight: [15], share: [],
}

export class Input {
  readonly move = { x: 0, y: 0 }
  readonly look = { x: 0, y: 0 }
  /** Signed left/right tower turn in [-1, 1]. */
  turn = 0
  method: InputMethod = 'keyboard'
  sensitivity = 1
  invertY = false

  private keys = new Set<string>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private touchMove = { x: 0, y: 0 }
  private touchTurn = 0
  private touchButtons = new Set<Action>()
  private padPrev = new Set<Action>()
  private listeners: Array<() => void> = []
  private pointerId: number | null = null
  private pointerX = 0
  private drag = 0

  constructor(canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', event => {
      const typing = (event.target as HTMLElement | null)?.matches?.('input, textarea, [contenteditable="true"]')
      if (typing) return
      if (!event.repeat) {
        this.keys.add(event.code)
        this.method = 'keyboard'
        for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) if (codes.includes(event.code)) this.pressed_.add(action)
      }
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
    })
    on(window, 'keyup', event => this.keys.delete(event.code))
    on(window, 'blur', () => { this.keys.clear(); this.pointerId = null; this.touchTurn = 0 })
    on(canvas, 'pointerdown', event => {
      if (event.button !== 0 || event.target !== canvas) return
      this.pointerId = event.pointerId
      this.pointerX = event.clientX
      this.method = event.pointerType === 'touch' ? 'touch' : 'mouse'
      try { canvas.setPointerCapture(event.pointerId) } catch { /* pointer capture is optional */ }
    })
    on(canvas, 'pointermove', event => {
      if (this.pointerId !== event.pointerId) return
      this.drag += event.clientX - this.pointerX
      this.pointerX = event.clientX
      if (event.pointerType === 'touch') this.method = 'touch'
    })
    const release = (event: PointerEvent) => { if (this.pointerId === event.pointerId) this.pointerId = null }
    on(canvas, 'pointerup', release)
    on(canvas, 'pointercancel', release)
  }

  lockPointer(): void { /* Drag-to-turn is intentional; no pointer lock needed. */ }
  unlockPointer(): void { this.pointerId = null }

  setTouchMove(x: number, y: number): void {
    this.method = 'touch'
    this.touchMove.x = x
    this.touchMove.y = y
  }

  setTouchTurn(direction: number): void {
    this.method = 'touch'
    this.touchTurn = Math.max(-1, Math.min(1, direction))
  }

  addTouchLook(dx: number, _dy: number): void {
    this.method = 'touch'
    this.drag += dx
  }

  setTouchButton(action: Action, down: boolean): void {
    this.method = 'touch'
    if (down && !this.touchButtons.has(action)) this.pressed_.add(action)
    if (down) this.touchButtons.add(action)
    else this.touchButtons.delete(action)
  }

  /** Sample continuous sources once per rendered frame. */
  update(): void {
    const down = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (down(MOVE_KEYS.right) ? 1 : 0) - (down(MOVE_KEYS.left) ? 1 : 0)
    let y = (down(MOVE_KEYS.up) ? 1 : 0) - (down(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) if (down(codes)) this.held_.add(action)
    for (const action of this.touchButtons) this.held_.add(action)
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) { x = this.touchMove.x; y = this.touchMove.y }
    const pad = navigator.getGamepads?.().find(gamepad => gamepad?.connected)
    if (pad) {
      const dead = (value: number) => Math.abs(value) < 0.18 ? 0 : Math.sign(value) * (Math.abs(value) - 0.18) / 0.82
      const lx = dead(pad.axes[0] ?? 0)
      const ly = dead(pad.axes[1] ?? 0)
      const rx = dead(pad.axes[2] ?? 0)
      const active = lx !== 0 || ly !== 0 || rx !== 0 || pad.buttons.some(button => button.pressed)
      if (active) this.method = 'gamepad'
      if (lx !== 0) x = lx
      else if (rx !== 0) x = rx
      if (ly !== 0) y = -ly
      const now = new Set<Action>()
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) if (buttons.some(index => pad.buttons[index]?.pressed)) now.add(action)
      for (const action of now) {
        this.held_.add(action)
        if (!this.padPrev.has(action)) this.pressed_.add(action)
      }
      this.padPrev = now
    } else this.padPrev.clear()
    if (this.touchTurn !== 0) { x = this.touchTurn; this.method = 'touch' }
    const length = Math.hypot(x, y)
    this.turn = Math.max(-1, Math.min(1, x))
    this.move.x = length > 1 ? x / length : x
    this.move.y = length > 1 ? y / length : y
  }

  held(action: Action): boolean { return this.held_.has(action) }
  pressed(action: Action): boolean { return this.pressed_.has(action) }
  consume(action: Action): boolean { return this.pressed_.delete(action) }
  takeLook(): { x: number; y: number } {
    const output = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.look.x = 0
    this.look.y = 0
    return output
  }
  /** Returns pointer/touch drag in radians and clears the accumulated delta. */
  takeDrag(): number {
    const output = this.drag * 0.006 * this.sensitivity
    this.drag = 0
    return output
  }
  endFrame(): void { this.pressed_.clear(); this.look.x = 0; this.look.y = 0 }
  dispose(): void { for (const off of this.listeners) off(); this.listeners = [] }
}
