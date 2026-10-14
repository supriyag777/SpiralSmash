import './styles/main.css'
import { Assets } from './engine/assets'
import { Audio } from './engine/audio'
import { I18n, resolveLocale } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { initPhysics } from './engine/physics'
import { Renderer, suggestQuality } from './engine/renderer'
import { insertScore, SAVE_KEY, SaveStore, type Locale, type Quality, type ScoreEntry } from './engine/save'
import { boardDay, STAGE_FLOORS, TOTAL_FLOORS } from './game/rules'
import { Game, type RunKind, type RunResult } from './game/game'
import { dailySeed } from './game/level'
import { THEMES } from './game/theme'
import { challengeUrl, cleanName, copyText, drawCard, readChallenge } from './game/share'
import type { BoardData } from './game/records'
import { UI } from './ui/ui'

const LOCAL_ID = 'this-device'
const modelUrls = import.meta.glob('../assets/models/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
let bootUI: UI | undefined

async function boot(): Promise<void> {
  const save = new SaveStore()
  if (!safeGet(SAVE_KEY)) save.update({ quality: suggestQuality() })
  const i18n = new I18n(resolveLocale(save.data.locale, navigator.languages))
  const canvas = document.getElementById('game') as HTMLCanvasElement
  const input = new Input(canvas)
  input.sensitivity = save.data.sensitivity
  const audio = new Audio()
  const handlers: Record<string, (el: HTMLElement) => void> = { retry: () => window.location.reload() }
  const ui = new UI(i18n, save, input, handlers)
  bootUI = ui
  ui.bootProgress(0.12)
  await initPhysics()
  ui.bootProgress(0.55)
  const renderer = new Renderer(canvas, save.data.quality)
  let activateTuning: () => boolean = () => false
  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'),
      import('./game/tuning'),
    ])
    await registerGameTuning(tuning)
    activateTuning = () => { tuning.activate('run'); return tuning.unranked }
  }
  ui.bootProgress(0.85)
  if (!save.data.playerName) save.update({ playerName: `${i18n.locale === 'zh-CN' ? '玩家' : 'Player'}${Math.floor(1000 + Math.random() * 9000)}` })

  let game!: Game
  let loop!: GameLoop
  let day = boardDay()
  let lastKind: RunKind = 'daily'
  let lastRun: RunResult | null = null
  let lastWasBest = false
  let activeRunUnranked = false
  let lastRecordAt = 0
  let resultsTimer = 0
  let shareUrl = ''
  let shareBlob: Blob | null = null
  const challenge = readChallenge()
  const target = () => challenge ? { name: challenge.name, score: challenge.score } : null
  const applyVolumes = () => audio.setVolumes(save.data.musicVolume, save.data.sfxVolume, save.data.muted)
  applyVolumes()

  const boardData = (period: 'today' | 'all'): BoardData => {
    const rows = save.data.leaderboard.filter(entry => period === 'all' || (entry.mode === 'daily' && entry.day === day))
    const entries = rows.slice(0, 10).map((entry, index) => ({
      rank: index + 1,
      playerId: LOCAL_ID,
      displayName: entry.name || save.data.playerName,
      score: entry.score,
    }))
    const me = entries.find(entry => entry.playerId === LOCAL_ID)
    return { entries, myRank: me ? { rank: me.rank, score: me.score } : null }
  }

  const refreshTitle = (): void => {
    ui.setTitle({ day, best: save.data.best, todayBest: save.data.dailyDay === day ? save.data.dailyBest : 0, challenge: target() })
    ui.setTitleTop(boardData('today'), false, LOCAL_ID)
  }

  const startRun = (kind: RunKind): void => {
    audio.unlock()
    audio.startMusic()
    window.clearTimeout(resultsTimer)
    lastKind = kind
    lastRun = null
    ui.clearPopups()
    if (ui.modal) ui.closeModal()
    activeRunUnranked = activateTuning()
    game.personalBest = save.data.best
    if (kind === 'daily') {
      day = boardDay()
      game.start('daily', dailySeed(day), day)
    } else game.start('practice', (Math.random() * 2 ** 32) >>> 0, '')
    ui.show('hud')
    ui.touchHint(save.data.plays < 2 && document.body.classList.contains('is-touch'))
    loop.resetAccumulator()
  }

  const toTitle = (): void => {
    window.clearTimeout(resultsTimer)
    if (ui.modal) ui.closeModal()
    ui.clearPopups()
    day = boardDay()
    game.toTitle('daily', dailySeed(day), day)
    refreshTitle()
    ui.show('title')
  }

  const showResults = (run: RunResult): void => {
    lastRun = run
    const previousBest = save.data.best
    lastWasBest = !activeRunUnranked && run.score > previousBest && run.score > 0
    const at = lastRecordAt = Date.now()
    const row: ScoreEntry = {
      name: save.data.playerName,
      score: run.score,
      seconds: run.durationMs / 1000,
      at,
      mode: run.kind,
      ...(run.kind === 'daily' ? { day: run.seedDay } : {}),
      floors: run.floors,
      chain: run.bestChain,
    }
    if (activeRunUnranked) {
      save.update({ plays: save.data.plays + 1 })
      ui.setOnline(`<p class="muted">${i18n.t('results.unranked')}</p>`)
    } else {
      const leaderboard = insertScore(save.data.leaderboard, row).board
      const dailyDay = run.kind === 'daily' ? run.seedDay : save.data.dailyDay
      const dailyBest = run.kind === 'daily'
        ? Math.max(save.data.dailyDay === run.seedDay ? save.data.dailyBest : 0, run.score)
        : save.data.dailyBest
      save.update({ plays: save.data.plays + 1, best: Math.max(previousBest, run.score), dailyDay, dailyBest, leaderboard })
      ui.setOnline(`<p class="muted">${i18n.t('results.localSaved')}</p>`)
    }
    const t = i18n.t.bind(i18n)
    let note = ''
    const peer = target()
    if (peer) note = run.score > peer.score
      ? t('results.targetBeat', { name: peer.name || t('challenge.anon'), score: peer.score })
      : t('results.targetMiss', { name: peer.name || t('challenge.anon'), score: peer.score, diff: peer.score - run.score })
    else if (activeRunUnranked) note = t('results.unranked')
    else if (!lastWasBest && previousBest > 0 && previousBest - run.score <= Math.max(40, previousBest * 0.15)) note = t('results.nearBest', { diff: previousBest - run.score })
    const display = () => ui.showResults({
      won: run.outcome === 'won', score: run.score, newBest: lastWasBest,
      floors: run.floors, chain: run.bestChain, smashes: run.smashes,
      seconds: run.durationMs / 1000, note, name: save.data.playerName, showName: true,
    })
    // The crash remains visible for a beat; Space can restart during that beat.
    resultsTimer = window.setTimeout(display, run.outcome === 'won' ? 1200 : 650)
  }

  game = new Game(renderer, input, audio, {
    popup: (text, kind) => ui.popup(text, kind, game.ballScreen()),
    flash: (color, strength) => strength > 0.02 && ui.flash(color, strength),
    smashMode: on => ui.smashMode(on),
    chain: n => ui.chain(n),
    stage: (stage, theme) => ui.stageBanner(stage, theme.accent),
    scored: () => undefined,
    end: showResults,
    startRequest: () => { if (ui.screen === 'title' && !ui.modal) startRun('daily') },
  })
  game.setQuality(save.data.quality)
  game.reducedMotion = save.data.reducedMotion
  game.personalBest = save.data.best
  game.targetScore = challenge?.score ?? 0

  // Load original generated gameplay meshes in the background; the procedural game is playable first.
  const assetLoader = new Assets()
  for (const [path, url] of Object.entries(modelUrls)) {
    const isCore = path.endsWith('spiral-smash-core.glb') || path.endsWith('spiral-smash-core-retry.glb')
    const isOrb = path.endsWith('spiral-smash-orb.glb')
    if (!isCore && !isOrb) continue
    void assetLoader.gltf(url).then(gltf => {
      if (isCore) game.setCoreModel(gltf.scene)
      if (isOrb) game.setPlayerModel(gltf.scene)
    }).catch(error => console.warn(`Optional ${isCore ? 'tower core' : 'orb'} model did not load; using procedural visuals.`, error))
  }

  function openShare(): void {
    if (!lastRun) return
    const run = lastRun
    const t = i18n.t.bind(i18n)
    const theme = THEMES[Math.min(run.stage, THEMES.length - 1)]
    shareUrl = challengeUrl(run.score, save.data.playerName, run.kind === 'daily' ? run.seedDay : null)
    const display = getComputedStyle(document.documentElement).getPropertyValue('--display') || 'sans-serif'
    void drawCard({
      title: t('title.name'), sub: t('title.sub'), score: run.score,
      modeLine: run.kind === 'daily' ? t('share.cardDaily', { day: run.seedDay }) : t('share.cardPractice'),
      rankLine: null,
      statsLine: t('share.cardStats', { floors: run.floors, chain: run.bestChain, sec: Math.round(run.durationMs / 1000) }),
      call: t('share.cardCall'), scan: t('share.cardScan'), url: shareUrl,
      name: save.data.playerName,
      colors: { sky: theme.sky, low: theme.skyLow, safe: theme.safe, safeAlt: theme.safeAlt, accent: theme.accent },
      display,
    }).then(({ blob, url }) => {
      shareBlob = blob
      const file = new File([blob], 'spiral-smash.png', { type: 'image/png' })
      ui.setShare(url, shareUrl, !!navigator.canShare?.({ files: [file] }))
      ui.openModal('share')
    }).catch(error => {
      console.error('Could not make a share card', error)
      ui.toast(i18n.t('share.copyFail'))
    })
  }

  async function copyChallenge(): Promise<void> {
    if (!lastRun) return
    const t = i18n.t.bind(i18n)
    shareUrl = challengeUrl(lastRun.score, save.data.playerName, lastRun.kind === 'daily' ? lastRun.seedDay : null)
    const copied = await copyText(`${t('share.text', { score: lastRun.score })} ${shareUrl}`)
    ui.toast(t(copied ? 'share.copied' : 'share.copyFail'), ui.modal === 'share' ? 'share' : 'results')
  }

  const openBoard = (period: 'today' | 'all'): void => {
    if (ui.modal !== 'board') ui.openModal('board')
    ui.setBoard(period, boardData(period), LOCAL_ID)
  }

  const pause = (): void => {
    if (game.mode !== 'playing') return
    game.pause()
    ui.openModal('pause')
  }
  const resume = (): void => {
    if (ui.modal) ui.closeModal()
    game.resume()
    loop.resetAccumulator()
  }

  Object.assign(handlers, {
    daily: () => startRun('daily'),
    practice: () => startRun('practice'),
    restart: () => startRun(lastKind),
    title: () => toTitle(),
    pause: () => pause(),
    resume: () => resume(),
    board: () => openBoard('today'),
    boardToday: () => openBoard('today'),
    boardAll: () => openBoard('all'),
    settings: () => ui.openModal('settings'),
    share: () => openShare(),
    copy: () => void copyChallenge(),
    systemShare: () => {
      if (!shareBlob || !lastRun) return
      const file = new File([shareBlob], 'spiral-smash.png', { type: 'image/png' })
      void navigator.share?.({ files: [file], text: `${i18n.t('share.text', { score: lastRun.score })} ${shareUrl}` }).catch(() => undefined)
    },
    closeModal: () => {
      if (ui.modal === 'pause') resume()
      else ui.closeModal()
    },
    lang: (element: HTMLElement) => {
      const locale = element.dataset.value as Locale
      save.update({ locale })
      i18n.set(locale)
      refreshTitle()
    },
    quality: (element: HTMLElement) => {
      save.update({ quality: element.dataset.value as Quality })
      game.setQuality(save.data.quality)
      ui.syncSettings(save.data)
    },
    toggle: (element: HTMLElement) => {
      const key = element.dataset.value as 'muted' | 'reducedMotion'
      save.update({ [key]: !save.data[key] })
      game.reducedMotion = save.data.reducedMotion
      applyVolumes()
      ui.syncSettings(save.data)
    },
  })

  ui.onSetting((key, value) => {
    save.update({ [key]: value })
    input.sensitivity = save.data.sensitivity
    applyVolumes()
  })
  ui.nameForm(raw => {
    const name = cleanName(raw) || save.data.playerName
    save.update({ playerName: name })
    if (lastRun && !activeRunUnranked) {
      const leaderboard = save.data.leaderboard.map(entry => entry.at === lastRecordAt ? { ...entry, name } : entry)
      save.update({ leaderboard })
    }
    ui.nameSaved()
    refreshTitle()
  })

  function routeActions(): void {
    const typing = (document.activeElement as HTMLElement | null)?.matches?.('input:not([readonly]), textarea, [contenteditable="true"]')
    if (input.consume('pause')) {
      if (ui.modal === 'pause') resume()
      else if (ui.modal) handlers.closeModal(document.body)
      else if (ui.screen === 'hud') pause()
    }
    if (input.consume('back')) {
      if (ui.modal) handlers.closeModal(document.body)
      else if (ui.screen === 'results') toTitle()
    }
    if (ui.screen !== 'hud' || ui.modal) {
      if (input.consume('navUp') || input.consume('navLeft')) ui.nav(-1)
      if (input.consume('navDown') || input.consume('navRight')) ui.nav(1)
      if (input.consume('select') && !typing) ui.select()
    }
    if (input.consume('share') && ui.screen === 'results' && !ui.modal) openShare()
    if (input.consume('confirm') && !typing) {
      if (ui.modal === 'pause') resume()
      else if (!ui.modal && ui.screen === 'title') startRun('daily')
      else if (!ui.modal && (ui.screen === 'results' || (ui.screen === 'hud' && game.mode === 'ended'))) startRun(lastKind)
    }
    if (ui.screen === 'hud' && game.mode === 'ended' && input.consume('select')) startRun(lastKind)
  }

  loop = new GameLoop({
    step: dt => { input.update(); routeActions(); game.step(dt) },
    render: (alpha, frameSeconds) => {
      input.update()
      routeActions()
      game.attractStarts = ui.screen === 'title' && !ui.modal
      game.render(alpha, frameSeconds)
      loop.paused = game.mode === 'paused'
      if (ui.screen === 'hud') {
        const sim = game.sim
        ui.setHud({ score: sim.score, best: save.data.best, stage: sim.stage, stages: STAGE_FLOORS.length, depth: sim.floors / TOTAL_FLOORS, practice: game.kind === 'practice', target: target() })
      }
      input.endFrame()
    },
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause() })
  const firstGesture = () => { audio.unlock(); audio.startMusic() }
  window.addEventListener('pointerdown', firstGesture, { once: true })
  window.addEventListener('keydown', firstGesture, { once: true })

  ui.bootProgress(1)
  day = boardDay()
  game.toTitle('daily', dailySeed(day), day)
  refreshTitle()
  ui.show('title')
  input.update()
  loop.start()
  ;(window as unknown as { __spiral: unknown; __helix: unknown }).__spiral = { game, ui, save, input }
  ;(window as unknown as { __spiral: unknown; __helix: unknown }).__helix = { game, ui, save, input }
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

void boot().catch(error => {
  console.error(error)
  if (bootUI) bootUI.showBootError(String((error as Error)?.message ?? error))
  else {
    const root = document.getElementById('ui')
    if (root) {
      root.textContent = `Could not start Spiral Smash. ${String((error as Error)?.message ?? error).replace(/[<>&]/g, '')}`
      root.className = 'fatal'
    }
  }
})
