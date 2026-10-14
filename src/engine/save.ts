/** Versioned device-local save, migrated from the supplied game's existing game3d.save namespace. */
export type Locale = 'en' | 'zh-CN'
export type Quality = 'low' | 'medium' | 'high'
export type RunKind = 'daily' | 'practice'
export type ScoreEntry = { name: string; score: number; seconds: number; at: number; day?: string; mode?: RunKind; floors?: number; chain?: number }
export type SaveData = {
  version: 1
  locale: Locale | ''
  musicVolume: number
  sfxVolume: number
  muted: boolean
  sensitivity: number
  invertY: boolean
  quality: Quality
  reducedMotion: boolean
  tutorialDone: boolean
  playerName: string
  leaderboard: ScoreEntry[]
  best: number
  dailyDay: string
  dailyBest: number
  plays: number
}

export const SAVE_KEY = 'game3d.save'
export const LEADERBOARD_SIZE = 10

export function defaultSave(): SaveData {
  return {
    version: 1, locale: '', musicVolume: 0.7, sfxVolume: 0.8, muted: false,
    sensitivity: 1, invertY: false, quality: 'high', reducedMotion: false,
    tutorialDone: false, playerName: '', leaderboard: [], best: 0, dailyDay: '', dailyBest: 0, plays: 0,
  }
}

const clamp01 = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
const nonNegInt = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(1e7, Math.floor(value)) : 0

export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let value: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    value = parsed as Record<string, unknown>
  } catch {
    return base
  }
  if (value.version !== 1) return base
  const board = Array.isArray(value.leaderboard) ? value.leaderboard : []
  return {
    version: 1,
    locale: value.locale === 'en' || value.locale === 'zh-CN' ? value.locale : '',
    musicVolume: clamp01(value.musicVolume, base.musicVolume),
    sfxVolume: clamp01(value.sfxVolume, base.sfxVolume),
    muted: value.muted === true,
    sensitivity: typeof value.sensitivity === 'number' && value.sensitivity >= 0.2 && value.sensitivity <= 3 ? value.sensitivity : base.sensitivity,
    invertY: value.invertY === true,
    quality: value.quality === 'low' || value.quality === 'medium' || value.quality === 'high' ? value.quality : base.quality,
    reducedMotion: value.reducedMotion === true,
    tutorialDone: value.tutorialDone === true,
    playerName: typeof value.playerName === 'string' && value.playerName.trim() ? value.playerName.trim().slice(0, 16) : base.playerName,
    leaderboard: board
      .filter((entry): entry is ScoreEntry => !!entry && typeof entry === 'object' && typeof (entry as ScoreEntry).name === 'string' && Number.isFinite((entry as ScoreEntry).score))
      .map(entry => ({
        name: entry.name.slice(0, 16),
        score: Math.max(0, Math.floor(entry.score)),
        seconds: Number.isFinite(entry.seconds) ? Math.max(0, entry.seconds) : 0,
        at: Number.isFinite(entry.at) ? entry.at : 0,
        ...(typeof entry.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.day) ? { day: entry.day } : {}),
        ...(entry.mode === 'daily' || entry.mode === 'practice' ? { mode: entry.mode } : {}),
        ...(Number.isFinite(entry.floors) ? { floors: Math.max(0, Math.floor(entry.floors!)) } : {}),
        ...(Number.isFinite(entry.chain) ? { chain: Math.max(0, Math.floor(entry.chain!)) } : {}),
      }))
      .sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.at - b.at)
      .slice(0, LEADERBOARD_SIZE),
    best: nonNegInt(value.best),
    dailyDay: typeof value.dailyDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dailyDay) ? value.dailyDay : '',
    dailyBest: nonNegInt(value.dailyBest),
    plays: nonNegInt(value.plays),
  }
}

export function insertScore(board: ScoreEntry[], entry: ScoreEntry): { board: ScoreEntry[]; rank: number } {
  const next = [...board, entry].sort((a, b) => b.score - a.score || a.seconds - b.seconds || a.at - b.at).slice(0, LEADERBOARD_SIZE)
  return { board: next, rank: next.indexOf(entry) }
}

export class SaveStore {
  data: SaveData

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try { raw = this.storage?.getItem(SAVE_KEY) ?? null } catch { raw = null }
    this.data = parseSave(raw)
  }

  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch }
    try { this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data)) } catch { /* In-memory play remains available when storage is denied. */ }
  }
}
