import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { SaveData, SaveStore } from '../engine/save'
import type { BoardData } from '../game/records'

export type Screen = 'boot' | 'title' | 'hud' | 'results'
export type Modal = 'pause' | 'board' | 'settings' | 'share'
export type PopupKind = 'score' | 'combo' | 'near' | 'smash' | 'stage' | 'danger' | 'best' | 'target'

export type Handlers = Record<string, (el: HTMLElement) => void>

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor"/></svg>'
const ICON_LEFT = '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_RIGHT = '<svg viewBox="0 0 24 24" width="40" height="40"><path d="m9 4 8 8-8 8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const BALL_LOGO = '<svg viewBox="0 0 64 64" class="logo-ball" aria-hidden="true"><ellipse cx="32" cy="56" rx="18" ry="5" fill="#1b1838" opacity=".35"/><circle cx="35" cy="29" r="20" fill="#1b1838"/><circle cx="31" cy="25" r="20" fill="#fff7e8"/><path d="M19 17 31 9l10 7-9 8Z" fill="#ffffff"/><path d="M31 45 17 34l5-12 10 2Z" fill="#e8dcc6"/></svg>'

export class UI {
  readonly root: HTMLElement
  screen: Screen = 'boot'
  modal: Modal | null = null
  private modalStack: Modal[] = []
  private els: Record<string, HTMLElement> = {}
  private popupLayer!: HTMLElement
  private countTimer = 0
  private lastFocus: HTMLElement | null = null

  constructor(private readonly i18n: I18n, private readonly save: SaveStore, private readonly input: Input, private readonly handlers: Handlers) {
    this.root = document.getElementById('ui')!
    this.root.innerHTML = this.template()
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach(el => (this.els[el.dataset.el!] = el))
    this.popupLayer = this.els.popups
    this.root.addEventListener('click', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')
      if (!el || el.hasAttribute('disabled')) return
      this.handlers[el.dataset.action!]?.(el)
    })
    this.root.querySelectorAll<HTMLElement>('.modal').forEach(m => m.addEventListener('pointerdown', e => e.stopPropagation()))
    this.bindTouch()
    this.translate()
    i18n.onChange(() => this.translate())
    this.syncSettings(save.data)
    const coarse = matchMedia('(pointer: coarse)').matches
    document.body.classList.toggle('is-touch', coarse)
    if (coarse) this.els.press.firstElementChild!.setAttribute('data-i18n', 'title.pressStartTouch')
    this.translate()
  }

  private template(): string {
    return `
<div class="flash" data-el="flash"></div>
<div class="smash-vignette" data-el="vignette"></div>
<section class="screen screen-boot is-active" data-screen="boot">
  <img class="boot-emblem" src="/favicon.png" alt="Spiral Smash" width="84" height="84" />
  <div class="boot-logo" data-i18n="title.name"></div>
  <div class="boot-bar"><i data-el="bootBar"></i></div>
  <div class="boot-label" data-i18n="boot.loading"></div>
  <div class="boot-error is-hidden" data-el="bootError"><b data-i18n="boot.errorTitle"></b><small data-el="bootErrorText"></small><button class="btn btn-primary btn-small" data-action="retry" data-primary><span data-i18n="boot.retry"></span></button></div>
</section>
<section class="screen screen-title" data-screen="title">
  <div class="title-vignette"></div>
  <div class="title-block">
    <h1 class="logo">${BALL_LOGO}<span class="logo-words"><span class="logo-main outlined" data-i18n="title.name"></span><span class="logo-sub outlined" data-i18n="title.sub"></span></span></h1>
    <p class="tagline" data-i18n="title.tagline"></p>
    <div class="challenge-card is-hidden" data-el="challenge"></div>
    <div class="menu">
      <button class="btn btn-primary btn-big" data-action="daily" data-primary><span data-i18n="title.daily"></span><small data-el="dailyNote"></small></button>
      <div class="menu-row">
        <button class="btn btn-small" data-action="practice"><span data-i18n="title.practice"></span></button>
        <button class="btn btn-small" data-action="board"><span data-i18n="title.board"></span></button>
        <button class="btn btn-small" data-action="settings"><span data-i18n="title.settings"></span></button>
      </div>
    </div>
    <div class="title-stats" data-el="titleStats"></div>
  </div>
  <aside class="title-top" data-el="titleTop"></aside>
  <div class="title-press" data-el="press"><span data-i18n="title.pressStart"></span></div>
  <div class="bottom-bar">
    <div class="prompts">
      <span data-i18n="title.hint"></span>
      <span><kbd class="wide">Space</kbd> <em data-i18n="controls.start"></em></span>
    </div>
  </div>
</section>
<section class="screen screen-hud" data-screen="hud">
  <div class="hud-top">
    <div class="hud-left">
      <div class="hud-pill" data-el="hudStage"></div>
      <div class="hud-pill hud-mode is-hidden" data-el="hudMode" data-i18n="hud.practice"></div>
    </div>
    <div class="hud-center">
      <b class="hud-score outlined" data-el="hudScore">0</b>
      <small class="hud-best" data-el="hudBest"></small>
    </div>
    <div class="hud-right"><button class="hud-btn" data-action="pause" aria-label="pause">${ICON_PAUSE}</button></div>
  </div>
  <div class="hud-target is-hidden" data-el="hudTarget"><span data-el="hudTargetText"></span><i><b data-el="hudTargetBar"></b></i></div>
  <div class="hud-depth"><i><b data-el="hudDepth"></b></i><span class="hud-depth-ball" data-el="hudDepthBall"></span></div>
  <div class="hud-chain outlined" data-el="hudChain"></div>
  <div class="hud-smash" data-el="hudSmash"><b class="outlined" data-i18n="hud.smash"></b><small data-i18n="hud.smashHint"></small></div>
  <div class="stage-banner outlined" data-el="stageBanner"></div>
  <div class="popups" data-el="popups"></div>
  <div class="touch-hint" data-el="touchHint" data-i18n="touch.hint"></div>
  <div class="touch">
    <button class="touch-btn" data-touch="-1" aria-label="left">${ICON_LEFT}</button>
    <button class="touch-btn" data-touch="1" aria-label="right">${ICON_RIGHT}</button>
  </div>
</section>
<section class="screen screen-results" data-screen="results">
  <div class="results-card modal">
    <h2 class="modal-title outlined" data-el="rTitle"></h2>
    <div class="results-score"><b class="outlined" data-el="rScore">0</b><span class="results-best" data-el="rBest" data-i18n="results.newBest"></span></div>
    <div class="results-note" data-el="rNote"></div>
    <dl class="results-stats">
      <div><dt data-i18n="results.floors"></dt><dd data-el="rFloors"></dd></div>
      <div><dt data-i18n="results.chain"></dt><dd data-el="rChain"></dd></div>
      <div><dt data-i18n="results.smashes"></dt><dd data-el="rSmash"></dd></div>
      <div><dt data-i18n="results.time"></dt><dd data-el="rTime"></dd></div>
    </dl>
    <div class="results-online" data-el="rOnline"></div>
    <form class="results-name" data-el="rNameForm">
      <label><span data-i18n="results.name"></span><input data-el="rName" maxlength="16" autocomplete="nickname" enterkeyhint="done" /></label>
      <button type="submit" class="btn btn-small btn-ghost"><span data-el="rNameBtn" data-i18n="results.saveName"></span></button>
    </form>
    <div class="menu menu-row results-actions">
      <button class="btn btn-primary" data-action="restart" data-primary><span><em data-i18n="results.restart"></em> <kbd class="wide">Space</kbd></span></button>
    </div>
    <div class="menu menu-row results-actions-2">
      <button class="btn btn-small" data-action="share"><span data-i18n="results.share"></span></button>
      <button class="btn btn-small" data-action="copy"><span data-i18n="results.copy"></span></button>
      <button class="btn btn-small" data-action="board"><span data-i18n="results.board"></span></button>
      <button class="btn btn-small" data-action="title"><span data-i18n="results.title"></span></button>
    </div>
    <div class="toast" data-el="toast"></div>
  </div>
</section>
<section class="screen screen-modal" data-screen="pause">
  <div class="modal">
    <h2 class="modal-title outlined" data-i18n="pause.title"></h2>
    <div class="menu">
      <button class="btn btn-primary" data-action="resume" data-primary><span data-i18n="pause.resume"></span></button>
      <button class="btn" data-action="restart"><span data-i18n="pause.restart"></span></button>
      <button class="btn" data-action="settings"><span data-i18n="title.settings"></span></button>
      <button class="btn" data-action="title"><span data-i18n="pause.quit"></span></button>
    </div>
  </div>
</section>
<section class="screen screen-modal" data-screen="board">
  <div class="modal modal-wide">
    <h2 class="modal-title outlined" data-i18n="board.title"></h2>
    <div class="seg board-tabs">
      <button data-action="boardToday" data-el="tabToday" aria-pressed="true" data-primary><span data-i18n="board.today"></span></button>
      <button data-action="boardAll" data-el="tabAll" aria-pressed="false"><span data-i18n="board.all"></span></button>
    </div>
    <ol class="board" data-el="boardList"></ol>
    <div class="board-foot" data-el="boardFoot"></div>
    <small class="board-note" data-i18n="board.dayNote"></small>
    <button class="btn btn-small" data-action="closeModal"><span data-i18n="common.close"></span></button>
  </div>
</section>
<section class="screen screen-modal" data-screen="share">
  <div class="modal modal-share">
    <h2 class="modal-title outlined" data-i18n="share.title"></h2>
    <div class="share-preview"><img data-el="shareImg" alt="share card" /></div>
    <input class="share-link" data-el="shareLink" readonly />
    <div class="menu menu-row">
      <a class="btn btn-primary btn-small" data-el="shareDownload" download="spiral-smash.png" data-primary><span data-i18n="share.download"></span></a>
      <button class="btn btn-small is-hidden" data-action="systemShare" data-el="shareSystem"><span data-i18n="share.system"></span></button>
      <button class="btn btn-small" data-action="copy"><span data-i18n="share.copy"></span></button>
      <button class="btn btn-small" data-action="closeModal"><span data-i18n="common.close"></span></button>
    </div>
    <div class="toast" data-el="shareToast"></div>
  </div>
</section>
<section class="screen screen-modal" data-screen="settings">
  <div class="modal modal-wide">
    <h2 class="modal-title outlined" data-i18n="settings.title"></h2>
    <div class="settings-grid">
      <div class="row"><span data-i18n="settings.language"></span><div class="seg"><button data-action="lang" data-value="zh-CN">中文</button><button data-action="lang" data-value="en">English</button></div></div>
      <div class="row"><span data-i18n="settings.quality"></span><div class="seg"><button data-action="quality" data-value="low" data-i18n="settings.quality.low"></button><button data-action="quality" data-value="medium" data-i18n="settings.quality.medium"></button><button data-action="quality" data-value="high" data-i18n="settings.quality.high"></button></div></div>
      <label class="row"><span data-i18n="settings.music"></span><input type="range" min="0" max="1" step="0.05" data-setting="musicVolume" /></label>
      <label class="row"><span data-i18n="settings.sfx"></span><input type="range" min="0" max="1" step="0.05" data-setting="sfxVolume" /></label>
      <label class="row"><span data-i18n="settings.sensitivity"></span><input type="range" min="0.4" max="2" step="0.1" data-setting="sensitivity" /></label>
      <div class="row"><span data-i18n="settings.motion"></span><button class="toggle" data-action="toggle" data-value="reducedMotion"><i></i></button></div>
      <div class="row"><span data-i18n="settings.mute"></span><button class="toggle" data-action="toggle" data-value="muted"><i></i></button></div>
    </div>
    <button class="btn btn-primary btn-small" data-action="closeModal" data-primary><span data-i18n="common.close"></span></button>
  </div>
</section>`
  }

  el(name: string): HTMLElement {
    return this.els[name]
  }

  translate(): void {
    this.root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => (el.textContent = this.i18n.t(el.dataset.i18n!)))
    document.title = this.i18n.locale === 'zh-CN' ? '螺旋冲击 · Spiral Smash' : 'Spiral Smash — Drop. Chain. Smash.'
    this.syncSettings(this.save.data)
  }

  bootProgress(p: number): void {
    this.els.bootBar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, p))})`
  }

  showBootError(message: string): void {
    this.show('boot')
    this.els.bootError.classList.remove('is-hidden')
    this.els.bootErrorText.textContent = message.slice(0, 240)
    this.els.bootBar.parentElement?.classList.add('is-hidden')
    this.els.bootError.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true })
  }

  show(screen: Screen): void {
    this.screen = screen
    this.root.querySelectorAll<HTMLElement>('[data-screen]').forEach(s => {
      const name = s.dataset.screen as Screen | Modal
      const on = name === screen || name === this.modal
      s.classList.toggle('is-active', on)
    })
    if (!this.modal) this.focusPrimary()
  }

  openModal(modal: Modal): void {
    this.lastFocus = document.activeElement as HTMLElement | null
    if (this.modal) this.modalStack.push(this.modal)
    this.modal = modal
    this.show(this.screen)
    this.focusPrimary()
  }

  closeModal(): void {
    this.modal = this.modalStack.pop() ?? null
    this.show(this.screen)
    if (this.lastFocus && this.layer().contains(this.lastFocus)) this.lastFocus.focus({ preventScroll: true })
  }

  /** The element that currently owns keyboard/gamepad focus navigation. */
  private layer(): HTMLElement {
    return this.root.querySelector<HTMLElement>(`[data-screen="${this.modal ?? this.screen}"]`)!
  }

  private focusables(): HTMLElement[] {
    return [...this.layer().querySelectorAll<HTMLElement>('button, a.btn, input:not([readonly])')].filter(el => el.offsetParent !== null && !el.closest('.touch') && !el.hasAttribute('disabled'))
  }

  focusPrimary(): void {
    const layer = this.layer()
    const el = layer.querySelector<HTMLElement>('[data-primary]')
    if (el && this.screen !== 'hud') el.focus({ preventScroll: true })
    else if (this.screen === 'hud' && !this.modal) (document.activeElement as HTMLElement | null)?.blur?.()
  }

  /** Arrow / D-pad focus movement through the active layer. */
  nav(dir: 1 | -1): void {
    const list = this.focusables()
    if (!list.length) return
    const i = list.indexOf(document.activeElement as HTMLElement)
    const next = list[(i + dir + list.length) % list.length] ?? list[0]
    next.focus({ preventScroll: true })
  }

  /** Enter / pad A: click the focused element in the active layer, or the primary action. */
  select(): void {
    const layer = this.layer()
    const active = document.activeElement as HTMLElement | null
    const target = active && layer.contains(active) && active !== document.body ? active : layer.querySelector<HTMLElement>('[data-primary]')
    if (target?.matches('input')) return
    target?.click()
  }

  // ─── Title ────────────────────────────────────────────────────────────
  setTitle(opts: { day: string; best: number; todayBest: number; challenge: { name: string; score: number } | null }): void {
    const t = this.i18n.t.bind(this.i18n)
    this.els.dailyNote.textContent = t('title.dailyNote', { day: opts.day.slice(5) })
    const stats: string[] = []
    if (opts.best > 0) stats.push(`${t('title.best')} <b>${opts.best}</b>`)
    if (opts.todayBest > 0) stats.push(`${t('title.todayBest')} <b>${opts.todayBest}</b>`)
    this.els.titleStats.innerHTML = stats.join('<i>·</i>')
    const c = opts.challenge
    this.els.challenge.classList.toggle('is-hidden', !c)
    if (c) this.els.challenge.innerHTML = `<small>${esc(t('challenge.label'))}</small><b class="outlined">${c.score}</b><span>${esc(t('challenge.banner', { name: c.name || t('challenge.anon'), score: c.score }))} · ${esc(t('challenge.call'))}</span>`
  }

  setTitleTop(data: BoardData | null, error: boolean, myId: string | null): void {
    const t = this.i18n.t.bind(this.i18n)
    const box = this.els.titleTop
    if (error) {
      box.innerHTML = `<h3>${esc(t('title.top'))}</h3><p class="muted">${esc(t('title.offline'))}</p>`
      return
    }
    if (!data) {
      box.innerHTML = `<h3>${esc(t('title.top'))}</h3><p class="muted">${esc(t('board.loading'))}</p>`
      return
    }
    const rows = data.entries.slice(0, 5)
    box.innerHTML = `<h3>${esc(t('title.top'))}</h3>${
      rows.length
        ? `<ol>${rows.map(e => `<li class="${e.playerId === myId ? 'is-me' : ''}"><b>${e.rank}</b><span>${esc(e.displayName)}</span><em>${e.score}</em></li>`).join('')}</ol>`
        : `<p class="muted">${esc(t('title.topEmpty'))}</p>`
    }`
  }

  // ─── HUD ──────────────────────────────────────────────────────────────
  setHud(h: { score: number; best: number; stage: number; stages: number; depth: number; practice: boolean; target: { name: string; score: number } | null }): void {
    const t = this.i18n.t.bind(this.i18n)
    const scoreEl = this.els.hudScore
    if (scoreEl.textContent !== String(h.score)) {
      scoreEl.textContent = String(h.score)
      scoreEl.classList.remove('bump')
      void scoreEl.offsetWidth
      scoreEl.classList.add('bump')
    }
    this.els.hudBest.textContent = h.best > 0 ? t('hud.best', { score: h.best }) : ''
    this.els.hudBest.classList.toggle('is-beaten', h.best > 0 && h.score > h.best)
    this.els.hudStage.textContent = t('hud.stage', { n: h.stage + 1, total: h.stages })
    this.els.hudMode.classList.toggle('is-hidden', !h.practice)
    const d = Math.max(0, Math.min(1, h.depth))
    const depthFill = this.els.hudDepth.querySelector<HTMLElement>('b')
    if (depthFill) depthFill.style.transform = `scaleY(${d})`
    this.els.hudDepthBall.style.top = `${d * 100}%`
    const tg = h.target
    this.els.hudTarget.classList.toggle('is-hidden', !tg)
    if (tg) {
      const done = h.score > tg.score
      this.els.hudTarget.classList.toggle('is-done', done)
      this.els.hudTargetText.textContent = done ? t('hud.targetDone') : `${tg.name ? `${tg.name} · ` : ''}${t('hud.target', { score: tg.score })}`
      this.els.hudTargetBar.style.transform = `scaleX(${Math.min(1, h.score / tg.score)})`
    }
  }

  chain(n: number): void {
    const el = this.els.hudChain
    if (n < 2) {
      el.classList.remove('is-on')
      return
    }
    el.textContent = `×${Math.min(n, 8)} ${this.i18n.t('hud.chain', { n })}`
    el.classList.remove('is-on', 'pop')
    void el.offsetWidth
    el.classList.add('is-on', 'pop')
    el.dataset.level = String(Math.min(n, 6))
  }

  smashMode(on: boolean): void {
    this.els.hudSmash.classList.toggle('is-on', on)
    this.els.vignette.classList.toggle('is-on', on)
  }

  stageBanner(n: number, accent: string): void {
    const el = this.els.stageBanner
    el.textContent = this.i18n.t('stage.banner', { n: n + 1 })
    el.style.color = accent
    el.classList.remove('is-on')
    void el.offsetWidth
    el.classList.add('is-on')
  }

  flash(color: string, strength: number): void {
    const el = this.els.flash
    el.style.background = color
    el.animate([{ opacity: Math.min(0.38, strength * 0.65) }, { opacity: 0 }], { duration: 160 + strength * 260, easing: 'ease-out' })
  }

  popup(text: string, kind: PopupKind, at: { x: number; y: number }): void {
    const t = this.i18n.t.bind(this.i18n)
    const label: Partial<Record<PopupKind, string>> = { near: t('pop.near'), smash: t('pop.smash'), stage: t('pop.stage'), danger: t('pop.danger'), best: t('pop.best'), target: t('pop.target') }
    const el = document.createElement('div')
    el.className = `popup popup-${kind}`
    el.innerHTML = `${label[kind] ? `<small>${esc(label[kind]!)}</small>` : ''}${text ? `<b>${esc(text)}</b>` : ''}`
    const big = kind === 'best' || kind === 'target' || kind === 'danger' || kind === 'stage'
    const x = big ? 50 : at.x + (Math.random() - 0.5) * 6
    const y = big ? 44 : at.y - 6
    el.style.left = `${x}%`
    el.style.top = `${y}%`
    this.popupLayer.appendChild(el)
    window.setTimeout(() => el.remove(), 1300)
    while (this.popupLayer.childElementCount > 8) this.popupLayer.firstElementChild?.remove()
  }

  clearPopups(): void {
    this.popupLayer.innerHTML = ''
    this.chain(0)
    this.smashMode(false)
  }

  // ─── Results ──────────────────────────────────────────────────────────
  showResults(r: { won: boolean; score: number; newBest: boolean; floors: number; chain: number; smashes: number; seconds: number; note: string; name: string; showName: boolean }): void {
    const t = this.i18n.t.bind(this.i18n)
    this.els.rTitle.textContent = t(r.won ? 'results.won' : 'results.dead')
    this.root.querySelector('.screen-results')!.classList.toggle('is-won', r.won)
    this.els.rBest.classList.toggle('is-on', r.newBest)
    this.els.rFloors.textContent = String(r.floors)
    this.els.rChain.textContent = String(r.chain)
    this.els.rSmash.textContent = String(r.smashes)
    this.els.rTime.textContent = t('results.seconds', { n: r.seconds.toFixed(1) })
    this.els.rNote.textContent = r.note
    this.els.rNote.classList.toggle('is-hidden', !r.note)
    ;(this.els.rName as HTMLInputElement).value = r.name
    this.els.rNameForm.classList.toggle('is-hidden', !r.showName)
    this.els.rNameBtn.textContent = t('results.saveName')
    this.els.toast.textContent = ''
    // Count the score up for a satisfying reveal.
    window.clearInterval(this.countTimer)
    const start = performance.now()
    const el = this.els.rScore
    const tick = () => {
      const k = Math.min(1, (performance.now() - start) / 650)
      el.textContent = String(Math.round(r.score * (1 - Math.pow(1 - k, 3))))
      if (k >= 1) window.clearInterval(this.countTimer)
    }
    this.countTimer = window.setInterval(tick, 16)
    tick()
    this.show('results')
  }

  setOnline(html: string): void {
    this.els.rOnline.innerHTML = html
  }

  toast(text: string, where: 'results' | 'share' = 'results'): void {
    const el = where === 'share' ? this.els.shareToast : this.els.toast
    el.textContent = text
    el.classList.remove('is-on')
    void el.offsetWidth
    el.classList.add('is-on')
  }

  nameForm(onSubmit: (name: string) => void): void {
    this.els.rNameForm.addEventListener('submit', e => {
      e.preventDefault()
      onSubmit((this.els.rName as HTMLInputElement).value)
      ;(this.els.rName as HTMLInputElement).blur()
    })
  }

  nameSaved(): void {
    this.els.rNameBtn.textContent = this.i18n.t('results.nameSaved')
  }

  // ─── Board ────────────────────────────────────────────────────────────
  setBoard(period: 'today' | 'all', state: BoardData | 'loading' | 'error', myId: string | null): void {
    const t = this.i18n.t.bind(this.i18n)
    this.els.tabToday.setAttribute('aria-pressed', String(period === 'today'))
    this.els.tabAll.setAttribute('aria-pressed', String(period === 'all'))
    const list = this.els.boardList
    const foot = this.els.boardFoot
    if (state === 'loading' || state === 'error') {
      list.innerHTML = `<li class="board-empty">${esc(t(state === 'loading' ? 'board.loading' : 'board.error'))}</li>`
      foot.textContent = ''
      return
    }
    list.innerHTML = state.entries.length
      ? state.entries.map(e => `<li class="${e.playerId === myId ? 'is-me' : ''}"><b>${e.rank}</b><span class="board-name">${esc(e.displayName)}${e.playerId === myId ? ` <i>${esc(t('board.me'))}</i>` : ''}</span><em>${e.score}</em></li>`).join('')
      : `<li class="board-empty">${esc(t('board.empty'))}</li>`
    foot.textContent = state.myRank ? t('board.myRank', { rank: state.myRank.rank, score: state.myRank.score }) : t('board.noRank')
  }

  // ─── Share ────────────────────────────────────────────────────────────
  setShare(imgUrl: string, link: string, canSystemShare: boolean): void {
    ;(this.els.shareImg as HTMLImageElement).src = imgUrl
    ;(this.els.shareDownload as HTMLAnchorElement).href = imgUrl
    ;(this.els.shareLink as HTMLInputElement).value = link
    this.els.shareSystem.classList.toggle('is-hidden', !canSystemShare)
    this.els.shareToast.textContent = ''
  }

  // ─── Settings ─────────────────────────────────────────────────────────
  syncSettings(d: SaveData): void {
    const locale = this.i18n.locale
    this.root.querySelectorAll<HTMLElement>('[data-action="lang"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === locale)))
    this.root.querySelectorAll<HTMLElement>('[data-action="quality"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === d.quality)))
    this.root.querySelectorAll<HTMLElement>('[data-action="toggle"]').forEach(b => b.setAttribute('aria-pressed', String(!!d[b.dataset.value as 'muted' | 'reducedMotion'])))
    this.root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(inp => (inp.value = String(d[inp.dataset.setting as 'musicVolume' | 'sfxVolume' | 'sensitivity'])))
  }

  onSetting(fn: (key: 'musicVolume' | 'sfxVolume' | 'sensitivity', value: number) => void): void {
    this.root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(inp => inp.addEventListener('input', () => fn(inp.dataset.setting as 'musicVolume' | 'sfxVolume' | 'sensitivity', Number(inp.value))))
  }

  // ─── Touch ────────────────────────────────────────────────────────────
  private bindTouch(): void {
    this.root.querySelectorAll<HTMLElement>('[data-touch]').forEach(btn => {
      const dir = Number(btn.dataset.touch)
      const down = (e: PointerEvent) => {
        e.preventDefault()
        btn.classList.add('is-down')
        document.body.classList.add('is-touch')
        this.input.setTouchTurn(dir)
      }
      const up = () => {
        btn.classList.remove('is-down')
        this.input.setTouchTurn(0)
      }
      btn.addEventListener('pointerdown', down)
      btn.addEventListener('pointerup', up)
      btn.addEventListener('pointercancel', up)
      btn.addEventListener('pointerleave', up)
      btn.addEventListener('contextmenu', e => e.preventDefault())
    })
  }

  touchHint(show: boolean): void {
    this.els.touchHint.classList.toggle('is-on', show)
  }
}
