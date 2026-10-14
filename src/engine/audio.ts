/** Self-contained Web Audio mixer; the game uses original synthesized cues, not downloaded music. */
export type Sfx = 'pickup' | 'jump' | 'land' | 'hurt' | 'ui' | 'win' | 'lose' | 'dash' | 'start' | 'bounce' | 'pass' | 'near' | 'smashOn' | 'smash' | 'stage' | 'death' | 'best'

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private musicTimer = 0
  private musicOn = false
  private buffers = new Map<string, AudioBuffer>()
  stage = 0
  intensity = 0

  constructor() {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) throw new Error('Web Audio is unavailable in this browser.')
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
  }

  unlock(): void { if (this.ctx.state === 'suspended') void this.ctx.resume() }
  setVolumes(music: number, sfx: number, muted = false): void {
    const time = this.ctx.currentTime
    this.music.gain.setTargetAtTime(muted ? 0 : Math.max(0, Math.min(1, music)) * 0.55, time, 0.05)
    this.sfx.gain.setTargetAtTime(muted ? 0 : Math.max(0, Math.min(1, sfx)) * 0.8, time, 0.05)
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url)
    if (cached) return cached
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not load audio (${response.status}).`)
    const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer())
    this.buffers.set(url, buffer)
    return buffer
  }
  playBuffer(buffer: AudioBuffer, bus: 'music' | 'sfx' = 'sfx', loop = false): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = loop
    source.connect(bus === 'music' ? this.music : this.sfx)
    source.start()
    return source
  }

  play(name: Sfx, accent = 0): void {
    if (this.ctx.state !== 'running') return
    const now = this.ctx.currentTime
    const tone = (start: number, end: number, duration: number, type: OscillatorType, volume: number, delay = 0) => {
      const oscillator = this.ctx.createOscillator()
      const envelope = this.ctx.createGain()
      oscillator.type = type
      oscillator.frequency.setValueAtTime(start, now + delay)
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(end, 20), now + delay + duration)
      envelope.gain.setValueAtTime(0.0001, now + delay)
      envelope.gain.exponentialRampToValueAtTime(volume, now + delay + 0.012)
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration)
      oscillator.connect(envelope).connect(this.sfx)
      oscillator.start(now + delay)
      oscillator.stop(now + delay + duration + 0.05)
    }
    const heat = Math.min(8, Math.max(0, accent))
    switch (name) {
      case 'pickup': tone(880, 1320, 0.12, 'triangle', 0.3); tone(1320, 1760, 0.15, 'sine', 0.2, 0.05); break
      case 'jump':
      case 'bounce': tone(190 + heat * 15, 360 + heat * 35, 0.105, 'sine', 0.19); break
      case 'land': tone(150, 72, 0.1, 'sine', 0.23); break
      case 'hurt':
      case 'death': tone(220, 68, 0.34, 'sawtooth', 0.25); tone(128, 62, 0.42, 'triangle', 0.18, 0.03); break
      case 'ui': tone(660, 720, 0.065, 'triangle', 0.16); break
      case 'dash': tone(430, 190, 0.16, 'sawtooth', 0.09); break
      case 'start': tone(310, 620, 0.12, 'triangle', 0.22); tone(620, 880, 0.15, 'sine', 0.16, 0.07); break
      case 'pass': tone(500 + heat * 86, 850 + heat * 105, 0.12, 'triangle', 0.24); tone(740 + heat * 70, 1050 + heat * 110, 0.16, 'sine', 0.12, 0.04); break
      case 'near': tone(260, 780, 0.18, 'triangle', 0.22); break
      case 'smashOn': tone(180, 390, 0.24, 'sawtooth', 0.21); tone(90, 70, 0.31, 'sine', 0.18, 0.02); break
      case 'smash': tone(92, 52, 0.38, 'sawtooth', 0.28); tone(740, 260, 0.21, 'triangle', 0.16, 0.035); break
      case 'stage': [523, 659, 784].forEach((f, index) => tone(f, f * 1.015, 0.23, 'triangle', 0.17, index * 0.075)); break
      case 'best': [660, 880, 1320].forEach((f, index) => tone(f, f * 1.01, 0.2, 'sine', 0.16, index * 0.065)); break
      case 'win': [523, 659, 784, 1047].forEach((f, index) => tone(f, f * 1.01, 0.28, 'triangle', 0.21, index * 0.105)); break
      case 'lose': [392, 330, 262].forEach((f, index) => tone(f, f * 0.98, 0.34, 'sine', 0.2, index * 0.14)); break
    }
  }

  startMusic(): void {
    if (this.musicOn) return
    this.musicOn = true
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 261.6, 329.6]]
    let bar = 0
    const schedule = () => {
      if (!this.musicOn) return
      const time = this.ctx.currentTime + 0.05
      const chord = chords[(bar + this.stage) % chords.length]
      const excitement = Math.max(0, Math.min(1, this.intensity))
      for (const frequency of chord) {
        for (const detune of [-6, 6]) {
          const oscillator = this.ctx.createOscillator()
          const envelope = this.ctx.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency / 2 * (1 + this.stage * 0.012)
          oscillator.detune.value = detune
          envelope.gain.setValueAtTime(0.0001, time)
          envelope.gain.linearRampToValueAtTime(0.033 + excitement * 0.014, time + 1.2)
          envelope.gain.linearRampToValueAtTime(0.0001, time + 4.2)
          oscillator.connect(envelope).connect(this.music)
          oscillator.start(time)
          oscillator.stop(time + 4.4)
        }
      }
      bar += 1
      this.musicTimer = window.setTimeout(schedule, 3600)
    }
    schedule()
  }
  stopMusic(): void { this.musicOn = false; clearTimeout(this.musicTimer) }
}
