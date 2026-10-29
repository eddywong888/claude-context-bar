import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Breakdown, ContextFill, GitInfo, GroupTag, Limit, RunningTool, UsageSample } from '../types'

const fill = atom({ plugin: 'context-bar', key: 'fill' } as const, null)
const compactAt = atom({ plugin: 'context-bar', key: 'compactAt' } as const, null)
const limits = atom({ plugin: 'context-bar', key: 'limits' } as const, [])
const startedAt = atom({ plugin: 'context-bar', key: 'startedAt' } as const, null)
const now = atom({ plugin: 'context-bar', key: 'now' } as const, 0)
const running = atom({ plugin: 'context-bar', key: 'running' } as const, [])
const agents = atom({ plugin: 'context-bar', key: 'agents' } as const, [])
const lastTurnMs = atom({ plugin: 'context-bar', key: 'lastTurnMs' } as const, null)
const turnStartedAt = atom({ plugin: 'context-bar', key: 'turnStartedAt' } as const, null)
const warned = atom({ plugin: 'context-bar', key: 'warned' } as const, false)
const isHidden = atom({ plugin: 'context-bar', key: 'isHidden' } as const, false)
const resetNoticed = atom({ plugin: 'context-bar', key: 'resetNoticed' } as const, null)
const git = atom({ plugin: 'context-bar', key: 'git' } as const, null)
const gitAt = atom({ plugin: 'context-bar', key: 'gitAt' } as const, null)
const breakdown = atom({ plugin: 'context-bar', key: 'breakdown' } as const, null)
const autoCompactOn = atom({ plugin: 'context-bar', key: 'autoCompactOn' } as const, false)
const modelInUse = atom({ plugin: 'context-bar', key: 'modelInUse' } as const, null)
const fiveHist = atom({ plugin: 'context-bar', key: 'fiveHist' } as const, [])
const tokHist = atom({ plugin: 'context-bar', key: 'tokHist' } as const, [])
const lastGrowth = atom({ plugin: 'context-bar', key: 'lastGrowth' } as const, null)
const costUsd = atom({ plugin: 'context-bar', key: 'costUsd' } as const, null)
const toolsTurn = atom({ plugin: 'context-bar', key: 'toolsTurn' } as const, 0)
const toolsTotal = atom({ plugin: 'context-bar', key: 'toolsTotal' } as const, 0)
const stepsByModel = atom({ plugin: 'context-bar', key: 'stepsByModel' } as const, {})
const themeName = atom({ plugin: 'context-bar', key: 'themeName' } as const, 'meadow')
const soundOn = atom({ plugin: 'context-bar', key: 'soundOn' } as const, true)
const tickOwner = atom({ plugin: 'context-bar', key: 'tickOwner' } as const, null)
const place = atom({ plugin: 'context-bar', key: 'place' } as const, null)

const CONTEXT_PANE = 'context-bar-context'
const USAGE_PANE = 'context-bar-usage'
const WIDTH = 12
/** Cells in the Fable gauge. */
const SMOOTH = 8
const COMPACT_WARN = 85
/** With early compaction on, the conversation compacts at this share of the way to auto-compact. */
const EARLY_COMPACT_AT = 90
const ACTIVE = ['pending', 'running', 'waiting']
/** Tools that can change files, after which the git status is read again. */
const WRITERS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit']
/** Git is read at most this often after tool calls; every turn end reads it regardless. */
const GIT_EVERY_MS = 5000

export const kilo = (n: number) =>
  n >= 999_500 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`

export const pctText = (p: number) => (p < 10 ? p.toFixed(1) : String(Math.round(p * 10) / 10))

export type Palette = {
  stops: [number, number, number][]
  track: string
  trackDots: string
  notch: string
  /** The gauges' characters: filled and empty cells, 5h dots, mini cells, the warning line. */
  glyphs: { fill: string; empty: string; dotOn: string; dotOff: string; miniOn: string; miniOff: string; marker: string }
  /** How the band's labels (Context, 5h, Fable) are dressed. */
  deco: (label: string) => string
  /** Ink for those labels; absent, the surface's dim text. */
  labelInk?: string
  /** The skin's surface for the band and panels; absent, the app's own look. */
  surface?: Surface
}

/** Background, text inks and panel border that dress the band and panels (mods cannot change the font). */
export type Surface = {
  bg: string
  ink: string
  faint: string
  border: 'single' | 'double' | 'round' | 'bold' | 'dashed' | 'classic'
  borderColor: string
  /** Labels in italic. */
  italic?: boolean
  /** A light tray under the app's own buttons, which keep their light-theme ink; dark skins need one. */
  tray?: string
  /** Stand-ins for the app's status colours that read on this backdrop. */
  tones?: Partial<Record<Tone, string>>
}

export type Tone = 'suggestion' | 'warning' | 'error' | 'claude'

const PLAIN_GLYPHS = { fill: '█', empty: '░', dotOn: '●', dotOff: '○', miniOn: '▰', miniOff: '▱', marker: '┃' }

export const THEMES: Record<string, Palette> = {
  // Green to amber to red: the data-semantic default.
  meadow: {
    stops: [
      [0x11, 0x7a, 0x2e],
      [0xb3, 0x6b, 0x00],
      [0xb3, 0x1d, 0x28],
    ],
    track: '#c9ced6',
    trackDots: '#9aa1ab',
    notch: '#8a5a1f',
    glyphs: PLAIN_GLYPHS,
    deco: label => label,
  },
  // Teal to indigo to magenta: pressure as deepening water, no red at all.
  ocean: {
    stops: [
      [0x0e, 0x74, 0x90],
      [0x4f, 0x46, 0xe5],
      [0xbe, 0x18, 0x5d],
    ],
    track: '#b6c2cf',
    trackDots: '#8da0b3',
    notch: '#1e3a5f',
    glyphs: PLAIN_GLYPHS,
    deco: label => label,
    surface: { bg: '#e8f3f7', ink: '#0b3a4a', faint: '#5b7c8a', border: 'round', borderColor: '#9cc3d3' },
  },
  // Old gold to burnt orange to crimson: warm from the first cell.
  ember: {
    stops: [
      [0x9a, 0x7b, 0x0a],
      [0xc2, 0x41, 0x0c],
      [0x9f, 0x12, 0x39],
    ],
    track: '#cfc8bd',
    trackDots: '#aaa08f',
    notch: '#4a3728',
    glyphs: PLAIN_GLYPHS,
    deco: label => label,
    surface: { bg: '#fbefe3', ink: '#3d2416', faint: '#8a6a55', border: 'round', borderColor: '#e0b48f' },
  },
  // Green phosphor terminal: one hue, brightening as it fills, prompt-style labels.
  hermes: {
    stops: [
      [0x3f, 0xb8, 0x68],
      [0x7d, 0xdc, 0x6a],
      [0xd4, 0xf5, 0x7a],
    ],
    track: '#3d5a44',
    trackDots: '#5f8a68',
    notch: '#9ef01a',
    glyphs: { fill: '█', empty: '·', dotOn: '●', dotOff: '·', miniOn: '█', miniOff: '·', marker: '│' },
    deco: label => `>${label.toLowerCase()}`,
    labelInk: '#7ddc6a',
    surface: { bg: '#0c1a10', ink: '#9be564', faint: '#8cc79a', border: 'single', borderColor: '#2fb45a', tray: '#d4eadb', tones: { suggestion: '#7fd8f0', warning: '#f2d16b', error: '#ff7b7b', claude: '#f7a96b' } },
  },
  // One ink, no colour: shade carries the reading.
  mono: {
    stops: [
      [0x9a, 0xa0, 0xa6],
      [0x5f, 0x63, 0x68],
      [0x20, 0x21, 0x24],
    ],
    track: '#d7d9dc',
    trackDots: '#b9bdc2',
    notch: '#202124',
    glyphs: { fill: '▓', empty: '░', dotOn: '◉', dotOff: '○', miniOn: '◼', miniOff: '◻', marker: '│' },
    deco: label => label,
    surface: { bg: '#f2f2f3', ink: '#202124', faint: '#6b6f75', border: 'single', borderColor: '#9aa0a6' },
  },
  // Amber CRT: bracketed capitals and phosphor orange.
  retro: {
    stops: [
      [0xd9, 0x9a, 0x1e],
      [0xf2, 0xb1, 0x1a],
      [0xff, 0x6a, 0x1a],
    ],
    track: '#d8cdb8',
    trackDots: '#b8a98a',
    notch: '#7a3b00',
    glyphs: { fill: '█', empty: '.', dotOn: '■', dotOff: '.', miniOn: '█', miniOff: '.', marker: '|' },
    deco: label => `[${label.toUpperCase()}]`,
    labelInk: '#f2b11a',
    surface: { bg: '#1c1306', ink: '#ffb000', faint: '#d6b071', border: 'double', borderColor: '#b36b00', tray: '#f1e2c4', tones: { suggestion: '#ffd27f', warning: '#ffe066', error: '#ff7a5c', claude: '#ffab5c' } },
  },
  // Neon on dark glass: cyan into violet into magenta.
  cyberpunk: {
    stops: [
      [0x22, 0xd3, 0xee],
      [0xa7, 0x7b, 0xff],
      [0xff, 0x4d, 0xb8],
    ],
    track: '#4a4170',
    trackDots: '#7468a6',
    notch: '#f72585',
    glyphs: { fill: '█', empty: '▒', dotOn: '◉', dotOff: '◌', miniOn: '▰', miniOff: '▱', marker: '┊' },
    deco: label => `▸${label}`,
    labelInk: '#22d3ee',
    surface: { bg: '#140c24', ink: '#ece6ff', faint: '#b8aee0', border: 'bold', borderColor: '#f72585', italic: true, tray: '#e2dcf7', tones: { suggestion: '#5ee0f5', warning: '#ffd166', error: '#ff5c9a', claude: '#ffa36b' } },
  },
  // A cup filling: short blocks rise to tall ones, milky caramel darkening to espresso.
  latte: {
    stops: [
      [0xb0, 0x83, 0x4a],
      [0x8b, 0x5a, 0x2b],
      [0x3b, 0x24, 0x16],
    ],
    track: '#e2d6c4',
    trackDots: '#c4ab8c',
    notch: '#6f4e37',
    glyphs: { fill: '▆', empty: '▁', dotOn: '●', dotOff: '○', miniOn: '▆', miniOff: '▁', marker: '│' },
    deco: label => label,
    labelInk: '#8b5a2b',
    surface: { bg: '#f6ede1', ink: '#3b2416', faint: '#8b7058', border: 'round', borderColor: '#c4ab8c', italic: true },
  },
  // A drafting sheet: solid cells on a dashed dimension line, labels set between ticks.
  blueprint: {
    stops: [
      [0x02, 0x84, 0xc7],
      [0x1d, 0x4e, 0xd8],
      [0x1e, 0x1b, 0x4b],
    ],
    track: '#c3d4e6',
    trackDots: '#7fa3c8',
    notch: '#0b3d91',
    glyphs: { fill: '▮', empty: '┄', dotOn: '◆', dotOff: '◇', miniOn: '▮', miniOff: '▯', marker: '╎' },
    deco: label => `┤${label}├`,
    labelInk: '#1d4ed8',
    surface: { bg: '#eaf2fb', ink: '#0b2a5b', faint: '#6a86ab', border: 'dashed', borderColor: '#7fa3c8' },
  },
  // A brush stroke: a heavy line over a hairline, slate wash into ink, sealed in vermilion when full.
  sumi: {
    stops: [
      [0x7c, 0x8a, 0x9e],
      [0x2b, 0x34, 0x45],
      [0xc0, 0x39, 0x2b],
    ],
    track: '#d9dcdf',
    trackDots: '#aab1ba',
    notch: '#c0392b',
    glyphs: { fill: '━', empty: '─', dotOn: '●', dotOff: '◦', miniOn: '━', miniOff: '─', marker: '┃' },
    deco: label => label.toLowerCase(),
    labelInk: '#2b3445',
    surface: { bg: '#f5f3ee', ink: '#1f2430', faint: '#7c8a9e', border: 'single', borderColor: '#c0392b', italic: true },
  },
}

export const THEME_NAMES = Object.keys(THEMES)

/** A skin name THEMES holds itself, never an inherited key such as "constructor". */
export const isTheme = (name: unknown): name is string => typeof name === 'string' && Object.hasOwn(THEMES, name)

const paletteOf = (name: string): Palette => (isTheme(name) ? THEMES[name]! : THEMES['meadow']!)

/** Text props for a skin's plain and faint text; without a surface, the app's own. */
export const inksOf = (pal: Palette) => {
  const sf = pal.surface
  return {
    plain: { color: sf?.ink },
    faint: sf === undefined ? { dimColor: true } : { color: sf.faint },
    /** The band's backdrop. */
    band: { backgroundColor: sf?.bg, paddingX: sf === undefined ? 0 : 1 },
    /** A status colour as this skin draws it. */
    tone: (key: string) => sf?.tones?.[key as Tone] ?? key,
    /** Under the app's buttons: the skin's tray, if it has one. */
    tray: { backgroundColor: sf?.tray, paddingX: sf?.tray === undefined ? 0 : 1 },
    /** A panel's backdrop and border. */
    pane: { backgroundColor: sf?.bg, borderStyle: sf?.border, borderColor: sf?.borderColor, flexGrow: sf === undefined ? undefined : 1 },
  }
}

/** The gauge colour at a position from 0 (calm) to 1 (full), in the palette's ramp. */
export const gradientAt = (t: number, pal: Palette = THEMES['meadow']!) => {
  const STOPS = pal.stops
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const a = STOPS[i] ?? STOPS[0]!
  const b = STOPS[i + 1] ?? a
  const f = x - i
  const hex = (k: 0 | 1 | 2) => Math.round(a[k] + (b[k] - a[k]) * f).toString(16).padStart(2, '0')
  return `#${hex(0)}${hex(1)}${hex(2)}`
}

/** One gradient cell per character of `text`, coloured by its place among `of` cells. */
export const gradientCells = (text: string, start: number, of: number, pal?: Palette) =>
  [...text].map((ch, i) => ({ ch, color: gradientAt(of <= 1 ? 0 : (start + i) / (of - 1), pal) }))

const MINI = 5

/** A five-cell gauge: lit cells (▰ for bars, ● for dots) and the unlit rest. */
export const mini = (percent: number, lit: string, unlit: string) => {
  const f = Math.min(MINI, Math.max(0, Math.ceil((percent / 100) * MINI)))
  return { filled: lit.repeat(f), empty: unlit.repeat(MINI - f) }
}

/** Where the early-warning line sits on the context bar, as a share of the window. */
export const WARN_AT = 75


/**
 * The context gauge: lit cells in the gradient, the rest as a light stippled
 * track, and a thin marker set between two cells at `warnPercent`, so it adds
 * a line rather than taking a cell. The bar shows only the warning line;
 * the auto-compact point is reported in text.
 */
export const trackCells = (percent: number, width: number, warnPercent: number | null, pal: Palette = THEMES['meadow']!) => {
  const lit = Math.min(width, Math.max(0, Math.ceil(((percent - 1e-9) / 100) * width)))
  const warn = warnPercent === null ? -1 : Math.min(width, Math.max(0, Math.round((warnPercent / 100) * width)))
  const out: { ch: string; color: string; dim?: boolean }[] = []
  for (let i = 0; i <= width; i++) {
    if (i === warn) out.push({ ch: pal.glyphs.marker, color: pal.notch })
    if (i === width) break
    out.push(
      i < lit
        ? { ch: pal.glyphs.fill, color: gradientAt(width <= 1 ? 0 : i / (width - 1), pal) }
        : { ch: pal.glyphs.empty, color: pal.trackDots, dim: true },
    )
  }
  return out
}

/** The hidden view's five-cell gauge: ▰ lit in the gradient, ▱ unlit. */
export const miniCells = (percent: number, pal: Palette = THEMES['meadow']!) => {
  const { filled, empty } = mini(percent, pal.glyphs.miniOn, pal.glyphs.miniOff)
  return [...gradientCells(filled, 0, MINI, pal), ...[...empty].map(ch => ({ ch, color: pal.track }))]
}

/** Five dots for the 5h window: lit ones in the gradient, the rest as rings. */
export const dotCells = (percent: number, pal: Palette = THEMES['meadow']!) => {
  const { filled, empty } = mini(percent, pal.glyphs.dotOn, pal.glyphs.dotOff)
  return [...gradientCells(filled, 0, MINI, pal), ...[...empty].map(ch => ({ ch, color: pal.track }))]
}

export const isFable = (kind: string) => /fable/i.test(kind)

export const turnLength = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** Splits "1d11h52m" into number and unit runs, so the units can be drawn bold. */
export const unitRuns = (text: string) =>
  (text.match(/\d+|\D+/g) ?? []).map(run => ({ run, unit: !/^\d/.test(run) }))

/** The reset countdown: blue while usage is easy, warning colours as the limit nears. */
export const countdownColor = (percent: number): Tone =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'suggestion'

/** Session age as "12m", "1h15m" or, past a day, "1d11h52m". */
export const duration = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(m / 1440)}d${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}m`
}

/** Whole minutes as "12m", "2h05m" or, past a day, "2d 22h". */
export const minutesText = (m: number) =>
  m < 60 ? `${m}m` : m < 24 * 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`

/** Time until an ISO reset moment, as "2h05m" or "12m"; null when unknown or past. */
export const resetIn = (resetsAt: string | undefined, nowMs: number) => {
  if (resetsAt === undefined || nowMs === 0) return null
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at) || at <= nowMs) return null
  return minutesText(Math.ceil((at - nowMs) / 60000))
}

/** `claude-opus-5-5` → `Opus 5.5`; anything else is shown as given. */
export const modelName = (id: string) => {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  if (m === null) return id
  const family = m[1] ?? ''
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${m[2]}.${m[3]}`
}

/** A rate-limit window's name as the usage panel shows it. */
export const limitName = (kind: string) =>
  kind === 'five_hour'
    ? 'Current session (5h)'
    : kind === 'seven_day'
      ? 'Weekly'
      : kind === 'spend_limit'
        ? 'Spend limit'
        : isFable(kind)
          ? 'Fable (weekly)'
          : kind.replace(/_/g, ' ')

/** Readings older than this no longer count as the recent pace. */
const STALE_MS = 10 * 60000

/**
 * Minutes until the 5h limit is used up at the recent pace, from samples at
 * least two minutes apart; null when flat, falling or too few samples.
 */
export const minutesToLimit = (hist: UsageSample[], nowMs: number): number | null => {
  const last = hist[hist.length - 1]
  const first = hist.find(s => last !== undefined && last.at - s.at >= 2 * 60000) ?? hist[0]
  if (first === undefined || last === undefined || last.at - first.at < 2 * 60000) return null
  const perMs = (last.percent - first.percent) / (last.at - first.at)
  if (perMs <= 0 || last.percent >= 100) return null
  // A pace whose newest reading is old says nothing about now.
  if (nowMs - last.at > STALE_MS) return null
  const left = Math.ceil((100 - last.percent) / perMs / 60000) + Math.round((last.at - nowMs) / 60000)
  return left > 0 ? left : null
}

/** The forecast line, only when the limit would land before the reset at the recent pace. */
export const forecast = (hist: UsageSample[], resetsAt: string | undefined, nowMs: number): string | null => {
  const left = minutesToLimit(hist, nowMs)
  if (left === null) return null
  const reset = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (Number.isNaN(reset) || nowMs + left * 60000 >= reset) return null
  return `limit in ~${minutesText(left)}`
}

/** Rough turns to the auto-compact point at the average growth of the last turns. */
export const turnsLeft = (hist: number[], threshold: number | null): number | null => {
  if (threshold === null || hist.length < 3) return null
  const first = hist[0]
  const last = hist[hist.length - 1]
  if (first === undefined || last === undefined) return null
  const per = (last - first) / (hist.length - 1)
  if (per <= 0 || last >= threshold) return null
  return Math.max(1, Math.round((threshold - last) / per))
}

/** Share of the way to auto-compaction, or null when it is off or unknown. */
export const compactPercent = (tokens: number, threshold: number | null) =>
  threshold === null || threshold <= 0 ? null : Math.min(100, Math.round((tokens / threshold) * 100))

/** Hides what looks like a credential: bearer tokens, key=value secrets, and long token-like runs. */
export const maskSecrets = (text: string) =>
  text
    .replace(/(bearer|token|basic)\s+\S+/gi, '$1 ••••')
    .replace(/((?:api[_-]?key|token|secret|password|passwd|pwd)\s*[=:]\s*)\S+/gi, '$1••••')
    .replace(/\b(?:sk|pk|ghp|gho|ghs|xox[abprs]|AKIA)[-_A-Za-z0-9]{8,}/g, '••••')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, '••••')

/** $4.12, or $0.0042 for very small sums. */
export const usd = (n: number) => (n >= 0.1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '$0')

export const detailOf = (input: Record<string, unknown>) => {
  for (const key of ['command', 'file_path', 'pattern', 'description', 'url', 'query', 'prompt']) {
    const v = input[key]
    if (typeof v === 'string' && v.length > 0) {
      const line = maskSecrets(v.split('\n')[0] ?? v)
      return line.length > 40 ? `${line.slice(0, 39)}…` : line
    }
  }
  return undefined
}

/** Adds a 5h reading to the pace history; a falling one means the window reset, so the pace starts over. */
async function recordFive($: EngineInterface, at: number, percent: number) {
  await update($, fiveHist, hist => {
    const prev = hist[hist.length - 1]
    if (prev !== undefined && prev.percent > percent) return [{ at, percent }]
    return [...hist, { at, percent }].slice(-30)
  })
}

async function refreshThreshold($: EngineInterface) {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  const t = b !== undefined && b.isAutoCompactEnabled ? b.autoCompactThreshold ?? null : null
  const rows: Breakdown | null =
    b === undefined
      ? null
      : {
          rows: b.categories.map(c => ({
            name: c.name,
            tokens: c.tokens,
            color: c.color,
            isDeferred: c.isDeferred,
            kind: c.kind,
          })),
          total: b.totalTokens,
          max: b.rawMaxTokens,
          model: b.model,
        }
  await Promise.all([update($, compactAt, () => t), update($, breakdown, () => rows)])
}

/** A 5h reading whose reset moment has passed belongs to the old window: show it as empty. */
export const clearPassedResets = (list: Limit[], nowMs: number): Limit[] =>
  list.map(l => (l.kind === 'five_hour' && hasReset(l.resetsAt, nowMs) ? { ...l, percent: 0 } : l))

/**
 * True from a compaction or /clear until the next reply. Until then the usage
 * figures are still the last reply's (or absent), so the fill is read from the
 * /context breakdown instead, which measures the conversation as it is now.
 */
let contextShrank = false

/** After a compaction or /clear, wherever it came from: estimate the fill and redraw. */
async function afterShrink($: EngineInterface) {
  contextShrank = true
  await refreshThreshold($).catch(() => {})
  await refreshUsage($, { checkWindow: false }).catch(() => {})
}

/** The fill from the usage figures, or from the breakdown while those are stale or absent. */
export const fillFrom = (
  context: { tokens?: number; percent?: number; window: number },
  breakdownTotal: number | null,
  preferBreakdown: boolean,
): ContextFill | null => {
  const pct = (tokens: number) => (context.window > 0 ? Math.round((tokens / context.window) * 1000) / 10 : 0)
  if (breakdownTotal !== null && (preferBreakdown || context.tokens === undefined)) {
    return { percent: pct(breakdownTotal), tokens: breakdownTotal, window: context.window, estimated: true }
  }
  if (context.tokens === undefined) return null
  return { percent: context.window > 0 ? pct(context.tokens) : context.percent ?? 0, tokens: context.tokens, window: context.window }
}

async function refreshUsage($: EngineInterface, opts: { checkWindow: boolean } = { checkWindow: true }) {
  const [plain, at, prev] = await Promise.all([$.session.usage(), $.clock.now(), read($, fill)])
  // Ask for the breakdown only when the plain figures cannot be trusted; it costs more.
  const usage = contextShrank || plain.context.tokens === undefined ? await $.session.usage({ breakdown: 'summary' }).catch(() => plain) : plain
  const { context } = usage
  const filled = fillFrom(context, context.breakdown?.totalTokens ?? null, contextShrank)
  const nextLimits: Limit[] = clearPassedResets(
    usage.rateLimits.map(l => ({ kind: l.kind, percent: Math.round(l.percentUsed), resetsAt: l.resetsAt })),
    at,
  )
  await Promise.all([
    update($, fill, () => filled),
    // A response without rate-limit headers reports none; keep the last reading.
    update($, limits, prev => (nextLimits.length > 0 ? nextLimits : prev)),
    update($, startedAt, () => usage.startedAt),
    update($, now, () => at),
    // A reading without a cost keeps the last one, as the limits write does.
    update($, costUsd, prev => usage.cost?.usd ?? prev),
  ])

  const fiveNow = nextLimits.find(l => l.kind === 'five_hour')
  if (fiveNow !== undefined) await recordFive($, at, fiveNow.percent)

  await checkReset($, at)

  // A new window (model or setting change) moves the auto-compact point.
  if (opts.checkWindow && filled !== null && prev !== null && prev.window !== filled.window) await refreshThreshold($)

  const threshold = await read($, compactAt)
  const pct = filled === null ? null : compactPercent(filled.tokens, threshold)
  const isHigh = pct !== null && pct >= COMPACT_WARN
  let crossed = false
  await update($, warned, was => {
    crossed = isHigh && !was
    return isHigh
  })
  if (crossed) $.ui.toast(`Context ${pct}% of the way to auto-compact`)
}

/** Whether a reset moment has passed by `nowMs`. */
export const hasReset = (resetsAt: string | undefined, nowMs: number) => {
  if (resetsAt === undefined || nowMs === 0) return false
  const at = Date.parse(resetsAt)
  return !Number.isNaN(at) && nowMs >= at
}

/** Once the 5h window's reset time passes: a toast, once per window, and the gauge back to zero. */
async function checkReset($: EngineInterface, nowMs: number) {
  const five = (await read($, limits)).find(l => l.kind === 'five_hour')
  if (five === undefined || five.resetsAt === undefined || !hasReset(five.resetsAt, nowMs)) return
  const resetsAt = five.resetsAt
  let isNew = false
  await update($, resetNoticed, was => {
    isNew = was !== resetsAt
    return resetsAt
  })
  // A reading from before the reset is stale: show the new window as empty.
  await update($, limits, list => clearPassedResets(list, nowMs))
  if (isNew) $.ui.toast('Your 5-hour usage limit has reset')
}

/** Picks up the Hide/Show choice, which another session may have changed. */
async function syncHidden($: EngineInterface) {
  const stored = await $.store.get('isHidden')
  await update($, isHidden, () => stored === true)
}

async function openContext($: EngineInterface) {
  const [opened] = await Promise.all([
    $.ui.open({ id: CONTEXT_PANE, title: 'Context', focus: true }),
    refreshThreshold($).catch(() => {}),
  ])
  if (!opened.isPlaced) {
    // No room for the panel here: say the headline figure instead.
    const f = await read($, fill)
    $.ui.toast(f === null ? 'No context reading yet' : `Context ${pctText(f.percent)}% (${kilo(f.tokens)}/${kilo(f.window)})`)
  }
}

async function openUsage($: EngineInterface) {
  const [opened] = await Promise.all([
    $.ui.open({ id: USAGE_PANE, title: 'Usage', focus: true }),
    refreshUsage($).catch(() => {}),
  ])
  if (!opened.isPlaced) {
    const [ls, t] = await Promise.all([read($, limits), read($, now)])
    const five = ls.find(l => l.kind === 'five_hour')
    const left = five === undefined ? null : resetIn(five.resetsAt, t)
    $.ui.toast(
      five === undefined ? 'No usage reading yet' : `5h limit ${five.percent}% used${left !== null ? `, resets in ${left}` : ''}`,
    )
  }
}

/** Rings the completion sound (castle-mod's done.wav) when it is turned on. */
async function ringDone($: EngineInterface) {
  try {
    if (await read($, soundOn)) await $.audio.play({ asset: 'sounds/done.wav' })
  } catch {
    // No player on this platform, or the clip could not play.
  }
}

async function toggleSound($: EngineInterface) {
  const enabled = await update($, soundOn, was => !was)
  await $.store.set('soundOn', enabled).catch(() => {})
  if (enabled) ringDone($).catch(() => {})
}

async function syncSound($: EngineInterface) {
  const stored = await $.store.get('soundOn')
  await update($, soundOn, () => stored !== false)
}

async function toggleAutoCompact($: EngineInterface) {
  const enabled = await update($, autoCompactOn, was => !was)
  await $.store.set('autoCompactOn', enabled).catch(() => {})
  $.ui.toast(enabled ? `Will compact at ${EARLY_COMPACT_AT}% of the way to auto-compact` : 'Early compaction off')
}

async function syncAutoCompact($: EngineInterface) {
  const stored = await $.store.get('autoCompactOn')
  await update($, autoCompactOn, () => stored === true)
}

/** True while early compaction runs, so the session.compact hook leaves the refresh to it. */
let selfCompacting = false

/** True from scheduling an early compaction until it settles, so overlapping turns schedule one at most. */
let earlyPending = false

/**
 * Compacts by running /compact as if typed. $.session.compact is not available
 * in a desktop (SDK) session, and the command queues until the session is idle.
 */
async function runCompact($: EngineInterface) {
  await $.command.run({ command: 'compact', args: '' })
}

/**
 * The panel and bar buttons. While Claude works, /compact waits for the turn
 * to end and its promise can settle first, so then the toast says it is queued
 * rather than claiming it is done; the session.compact hook refreshes the figures.
 */
async function compactNow($: EngineInterface) {
  const busy = (await read($, turnStartedAt).catch(() => null)) !== null
  $.ui.toast(busy ? 'Compact queued: it runs when Claude finishes this turn' : 'Compacting the conversation…')
  try {
    await runCompact($)
    await afterShrink($)
    if (!busy) $.ui.toast('Compacted')
  } catch (err) {
    $.ui.toast(`Compact failed: ${String(err)}`)
  }
}

/**
 * With early compaction on, compacts once the context is nearly at the
 * auto-compact point. The toggle is turned off before the attempt and turned
 * back on only when compaction succeeded and actually lowered the context, so
 * a failing or ineffective compaction cannot retry every turn; and only when
 * nobody flipped the stored setting while it ran, so a mid-run choice stands.
 */
/** How far toward auto-compaction the context is, or null when unknown. */
async function earlyPercent($: EngineInterface) {
  const [f, threshold] = await Promise.all([read($, fill), read($, compactAt)])
  return { pct: f === null ? null : compactPercent(f.tokens, threshold), threshold }
}

async function maybeCompactEarly($: EngineInterface) {
  if (earlyPending || !(await read($, autoCompactOn))) return
  const { pct } = await earlyPercent($)
  if (pct === null || pct < EARLY_COMPACT_AT) return
  earlyPending = true
  await update($, autoCompactOn, () => false)
  // A command cannot run inside the turn that is ending; start it a moment after.
  $.clock.after(500, () => {
    compactEarly($)
      .catch(() => {})
      .finally(() => {
        earlyPending = false
      })
  })
}

async function compactEarly($: EngineInterface) {
  // A turn begun during the delay would queue /compact behind it, and the check
  // below would read the figures before it ran: leave it to that turn's end.
  // Recheck the rest too: the figures may have dropped, the setting been switched off.
  const { pct, threshold } = await earlyPercent($)
  const busy = (await read($, turnStartedAt)) !== null
  const wanted = (await $.store.get('autoCompactOn').catch(() => false)) === true
  if (busy || !wanted || pct === null || pct < EARLY_COMPACT_AT) {
    await syncAutoCompact($)
    return
  }
  $.ui.toast(`Context ${pct}% of the way to auto-compact: compacting now`)
  let helped = false
  try {
    // Refresh here rather than in the session.compact hook, which a mod's own call may skip;
    // the flag keeps the hook from refreshing a second time.
    selfCompacting = true
    try {
      await runCompact($)
    } finally {
      selfCompacting = false
    }
    contextShrank = true
    await refreshThreshold($).catch(() => {})
    await refreshUsage($, { checkWindow: false })
    const after = await read($, fill)
    const pctAfter = after === null ? null : compactPercent(after.tokens, threshold)
    helped = pctAfter !== null && pctAfter < EARLY_COMPACT_AT
    $.ui.toast(helped ? 'Compacted' : 'Compacted, but the context is still nearly full; early compaction is off')
  } catch (err) {
    $.ui.toast(`Compact failed: ${String(err)}; early compaction is off`)
  }
  if (helped && (await $.store.get('autoCompactOn').catch(() => true)) !== false) {
    await update($, autoCompactOn, () => true)
  } else if (!helped) {
    await $.store.set('autoCompactOn', false).catch(() => {})
  }
}

/** Switches to a named theme and remembers it across sessions. */
async function setTheme($: EngineInterface, name: string) {
  await update($, themeName, () => name)
  await $.store.set('themeName', name).catch(() => {})
}

async function syncTheme($: EngineInterface) {
  const stored = await $.store.get('themeName')
  await update($, themeName, () => (isTheme(stored) ? stored : 'meadow'))
}

async function toggleHidden($: EngineInterface) {
  const hidden = await update($, isHidden, was => !was)
  await $.store.set('isHidden', hidden).catch(() => {})
}

/** Folder names longer than this are cut on the bar, so it stays on one line; the panel shows the whole path. */
const FOLDER_CHARS = 12

/** Cuts text to n characters, ending in … when cut. */
export const clip = (text: string, n: number) => ([...text].length <= n ? text : `${[...text].slice(0, n - 1).join('')}…`)

/** The name the bar shows for a folder: its last part, or the project's for a worktree under .claude/worktrees. */
export const folderOf = (path: string) => {
  const parts = path.replace(/\/+$/, '').split('/')
  const wt = parts.lastIndexOf('worktrees')
  const at = wt > 1 && parts[wt - 1] === '.claude' ? wt - 2 : parts.length - 1
  return parts[at] || path
}

/** The group tied to this folder or the nearest folder above it, so subfolders and worktrees share it. */
export const groupFor = (path: string, groups: Record<string, GroupTag>): GroupTag | null => {
  let best: string | null = null
  for (const key of Object.keys(groups)) {
    if ((path === key || path.startsWith(`${key}/`)) && (best === null || key.length > best.length)) best = key
  }
  return best === null ? null : groups[best]!
}

/** Reads "🟦 sites / ops" as a mark and a name; a first word with no letters or digits is the mark. */
export const parseGroup = (text: string): GroupTag | null => {
  const words = text.trim().split(/\s+/).filter(w => w !== '')
  if (words.length === 0) return null
  const [first, ...rest] = words
  if (!/[\p{L}\p{N}]/u.test(first!)) return rest.length === 0 ? null : { mark: first!, name: rest.join(' ') }
  return { mark: '📁', name: words.join(' ') }
}

const isGroupTag = (v: unknown): v is GroupTag =>
  typeof v === 'object' && v !== null && typeof (v as GroupTag).mark === 'string' && typeof (v as GroupTag).name === 'string'

async function storedGroups($: EngineInterface): Promise<Record<string, GroupTag>> {
  const stored = await $.store.get('groups').catch(() => null)
  if (typeof stored !== 'object' || stored === null) return {}
  return Object.fromEntries(Object.entries(stored).filter(([, v]) => isGroupTag(v))) as Record<string, GroupTag>
}

/** Reads the session's folder with pwd and the group the user tied it to. */
async function refreshPlace($: EngineInterface) {
  const res = await $.process.run(['pwd'], { timeoutMs: 2000 })
  const path = res.exitCode === 0 ? res.stdout.trim() : ''
  if (path === '') return
  const groups = await storedGroups($)
  await update($, place, () => ({ path, folder: folderOf(path), group: groupFor(path, groups) }))
}

/** Ties the session's folder (and the folders under it) to a group, or unties it when tag is null. */
async function setGroup($: EngineInterface, path: string, tag: GroupTag | null) {
  const groups = await storedGroups($)
  if (tag === null) delete groups[path]
  else groups[path] = tag
  await $.store.set('groups', groups)
  await refreshPlace($)
}

/** Reads `git status --porcelain=v2 --branch`: the branch, files changed, and commits ahead/behind. */
export const parseGitStatus = (out: string): GitInfo | null => {
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  let changed = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m !== null) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (/^[12u?] /.test(line)) changed += 1
  }
  if (branch === null) return null
  return { branch: branch === '(detached)' ? 'detached' : branch, changed, ahead, behind }
}

async function refreshGit($: EngineInterface) {
  // --no-optional-locks: never take .git/index.lock, so a git command running alongside never fails.
  const res = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], {
    timeoutMs: 3000,
  })
  const status = res.exitCode === 0 ? parseGitStatus(res.stdout) : null
  const at = await $.clock.now()
  await Promise.all([update($, git, () => status), update($, gitAt, () => at)])
}

/** Reads git after a file-changing tool, at most once per GIT_EVERY_MS. */
async function refreshGitSoon($: EngineInterface) {
  const [at, last] = await Promise.all([$.clock.now(), read($, gitAt)])
  if (last !== null && at - last < GIT_EVERY_MS) return
  await refreshGit($)
}

async function refreshAgents($: EngineInterface) {
  const list = await $.agent.list()
  const names = list.filter(a => ACTIVE.includes(a.status)).map(a => a.name ?? a.type)
  await update($, agents, () => names)
}

async function tick($: EngineInterface, me: string, timer: { cancel: () => void }) {
  // A reload starts a newer tick; the older one stops itself.
  if ((await read($, tickOwner)) !== me) return timer.cancel()
  const at = await $.clock.now()
  await update($, now, () => at)
  await checkReset($, at)
  const five = (await read($, limits)).find(l => l.kind === 'five_hour')
  if (five !== undefined) await recordFive($, at, five.percent)
}

async function startTick($: EngineInterface) {
  const me = `${await $.clock.now()}-${Math.random()}`
  await update($, tickOwner, () => me)
  const timer = $.clock.every(30000, () => {
    tick($, me, timer).catch(() => {})
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'contextbar', description: 'Context bar: show, hide, sound and early compaction' }).catch(() => {})
    await Promise.all([
      refreshThreshold($)
        .then(() => refreshUsage($, { checkWindow: false }))
        .catch(() => {}),
      startTick($).catch(() => {}),
      refreshGit($).catch(() => {}),
      refreshPlace($).catch(() => {}),
      syncHidden($).catch(() => {}),
      syncSound($).catch(() => {}),
      syncAutoCompact($).catch(() => {}),
      syncTheme($).catch(() => {}),
    ])
    return result
  })

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const id = e.tool_use_id ?? `${e.tool}-${Math.random()}`
    if (isMain) {
      const entry: RunningTool = { id, tool: e.tool, detail: detailOf(e as Record<string, unknown>) }
      await Promise.allSettled([
        update($, running, list => [...list, entry]),
        update($, toolsTurn, n => n + 1),
        update($, toolsTotal, n => n + 1),
      ])
    } else {
      await update($, toolsTotal, n => n + 1).catch(() => {})
    }
    try {
      return await next(e)
    } finally {
      // Work a hook leaves unawaited does not land once it returns, so this is
      // awaited, kept to what changed: usage for main-loop calls, agents for subagents'.
      if (isMain) {
        await Promise.allSettled([
          update($, running, list => list.filter(r => r.id !== id)),
          refreshUsage($),
          WRITERS.includes(e.tool) ? refreshGitSoon($) : Promise.resolve(),
        ])
      } else {
        await Promise.allSettled([
          refreshAgents($),
          WRITERS.includes(e.tool) ? refreshGitSoon($) : Promise.resolve(),
        ])
      }
    }
  })

  on('command.run', { command: 'contextbar' }, async ($, e) => {
    const want = e.args.trim().toLowerCase().split(/\s+/).join(' ')
    if (want === 'hide' || want === 'show') {
      await update($, isHidden, () => want === 'hide')
      await $.store.set('isHidden', want === 'hide').catch(() => {})
      return { text: want === 'hide' ? 'Context bar collapsed.' : 'Context bar expanded.' }
    }
    if (want === 'sound on' || want === 'sound off') {
      const enabled = want === 'sound on'
      await update($, soundOn, () => enabled)
      await $.store.set('soundOn', enabled).catch(() => {})
      return { text: enabled ? 'Completion sound on.' : 'Completion sound off.' }
    }
    if (want === 'early on' || want === 'early off') {
      const enabled = want === 'early on'
      await update($, autoCompactOn, () => enabled)
      await $.store.set('autoCompactOn', enabled).catch(() => {})
      return { text: enabled ? `Will compact at ${EARLY_COMPACT_AT}% of the way to auto-compact.` : 'Early compaction off.' }
    }
    if (want.startsWith('theme')) {
      const asked = want.slice('theme'.length).trim()
      if (isTheme(asked)) {
        await setTheme($, asked)
        return { text: `Theme: ${asked}.` }
      }
      if (asked === '') {
        const current = await read($, themeName)
        return { text: `Theme: ${current}. Themes: ${THEME_NAMES.join(', ')}.` }
      }
      return { text: `No theme called “${asked}”. Themes: ${THEME_NAMES.join(', ')}.` }
    }
    if (want === 'group' || want.startsWith('group ')) {
      // The raw text, since the name keeps the case the user typed.
      const asked = e.args.trim().slice('group'.length).trim()
      await refreshPlace($).catch(() => {})
      const here = await read($, place)
      if (here === null) return { text: "Couldn't read this session's folder." }
      if (asked === '') {
        return {
          text: [
            `Folder: ${here.path}`,
            here.group === null ? 'Group: none' : `Group: ${here.group.mark} ${here.group.name}`,
            'Set it with /contextbar group 🟦 name, or remove it with /contextbar group off.',
          ].join('\n'),
        }
      }
      if (asked.toLowerCase() === 'off') {
        await setGroup($, here.path, null)
        return { text: `${here.folder} is no longer tied to a group.` }
      }
      const tag = parseGroup(asked)
      if (tag === null) return { text: 'Give the group a name after its mark, e.g. /contextbar group 🟦 sites / ops' }
      await setGroup($, here.path, tag)
      return { text: `${here.folder} and its subfolders now show ${tag.mark} ${tag.name}.` }
    }
    const [hidden, sound, early] = await Promise.all([read($, isHidden), read($, soundOn), read($, autoCompactOn)])
    return {
      text: [
        ...(want !== '' ? [`Didn't understand “${want}”.`] : []),
        `Context bar: ${hidden ? 'collapsed' : 'expanded'} · sound ${sound ? 'on' : 'off'} · early compact ${early ? 'on' : 'off'}`,
        'Usage: /contextbar show | hide | sound on | sound off | early on | early off | theme <name> | group <mark> <name>',
      ].join('\n'),
    }
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = typeof e.effort === 'number' ? String(e.effort) : e.effort
      await update($, modelInUse, () => ({ model: e.model, effort })).catch(() => {})
      await update($, stepsByModel, by => ({ ...by, [e.model]: (by[e.model] ?? 0) + 1 })).catch(() => {})
    }
    return yield* next(e)
  })

  // Any compaction (a panel button, /compact, auto-compaction) refreshes the figures.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && !selfCompacting) await afterShrink($)
    return result
  })

  // A typed /compact or /clear. Another plugin may pass session.compact on past
  // this mod's hook, so the command is watched too.
  on('command.run', { command: 'compact' }, async ($, e, next) => {
    const result = await next(e)
    await afterShrink($)
    return result
  })
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    const result = await next(e)
    await afterShrink($)
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      contextShrank = false
      const at = await $.clock.now().catch(() => null)
      if (at !== null) await update($, turnStartedAt, () => at).catch(() => {})
      await update($, toolsTurn, () => 0).catch(() => {})
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await refreshAgents($).catch(() => {})
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      const at = await $.clock.now().catch(() => null)
      let begun: number | null = null
      await update($, turnStartedAt, was => {
        begun = was
        return null
      }).catch(() => {})
      const ms = at !== null && begun !== null ? at - begun : null
      await Promise.allSettled([
        ms !== null ? update($, lastTurnMs, () => ms) : Promise.resolve(null),
        update($, running, () => []),
        // The threshold is read fresh here, so refreshUsage need not re-check the window.
        refreshThreshold($).then(() => refreshUsage($, { checkWindow: false })),
        refreshGit($),
        refreshAgents($),
        syncHidden($),
        syncSound($),
        syncTheme($),
      ])
      if (e.reason === 'answer') ringDone($).catch(() => {})
      const f2 = await read($, fill).catch(() => null)
      if (f2 !== null) {
        const hist = await update($, tokHist, old => [...old, f2.tokens].slice(-8)).catch(() => [] as number[])
        const prev = hist[hist.length - 2]
        await update($, lastGrowth, () => (prev !== undefined ? f2.tokens - prev : null)).catch(() => {})
      }
      await syncAutoCompact($).catch(() => {})
      await maybeCompactEarly($).catch(() => {})
    } else {
      await refreshAgents($).catch(() => {})
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const [f, threshold, ls, start, t, tools, turnMs, active, hidden, repo, growth, themed, here] = await Promise.all([
      read($, fill),
      read($, compactAt),
      read($, limits),
      read($, startedAt),
      read($, now),
      read($, running),
      read($, lastTurnMs),
      read($, agents),
      read($, isHidden),
      read($, git),
      read($, lastGrowth),
      read($, themeName),
      read($, place),
    ])
    const act = tools[tools.length - 1] ?? null

    const percent = f?.percent ?? 0
    // Estimated from the breakdown after a compaction, until the next reply.
    const approx = f?.estimated === true ? '~' : ''
    const toCompact = f === null ? null : compactPercent(f.tokens, threshold)
    const elapsed = start === null || t === 0 ? null : duration(t - start)

    const showWork = e.props.isWorking || active.length > 0
    const five = ls.find(l => l.kind === 'five_hour')
    const pal = paletteOf(themed)
    const ink = inksOf(pal)

    const withUnits = (text: string, prefix: string) =>
      unitRuns(text).map((r, i) =>
        r.unit ? (
          <Text key={`${prefix}${i}`} bold {...ink.plain}>
            {r.run}
          </Text>
        ) : (
          r.run
        ),
      )
    const label = (text: string) => (
      <Text
        color={pal.labelInk ?? pal.surface?.faint}
        dimColor={pal.labelInk === undefined && pal.surface === undefined}
        italic={pal.surface?.italic}
       
      >
        {pal.deco(text)}
      </Text>
    )
    // Where this session works: the group's mark the user set, then the folder's name.
    const whereGroup = (compact: boolean) =>
      here === null ? (
        label('Context')
      ) : (
        <Box key="where" gap={1}>
          <Text>{here.group?.mark ?? '📁'}</Text>
          {compact ? null : label(clip(here.folder, FOLDER_CHARS))}
        </Box>
      )
    // The app's buttons keep light-theme ink: on a dark skin they sit on its tray.
    const trayed = (button: ReturnType<typeof Button>) => <Box {...ink.tray}>{button}</Box>
    const fiveLeft = five === undefined ? null : resetIn(five.resetsAt, t)
    const fable = ls.filter(l => isFable(l.kind))

    // One cell per glyph, coloured; the gauges are strips of these.
    const cells = (list: { ch: string; color: string; dim?: boolean }[], prefix: string) =>
      list.map((c, i) => (
        <Text key={`${prefix}${i}`} color={c.color} dimColor={c.dim} bold={c.dim !== true}>
          {c.ch}
        </Text>
      ))

    const contextGauge = (width: 'full' | 'mini') =>
      width === 'mini' ? (
        <Box>{cells(miniCells(percent, pal), 'm')}</Box>
      ) : (
        <Box>{cells(trackCells(percent, WIDTH, WARN_AT, pal), 'c')}</Box>
      )

    const fiveGroup =
      five === undefined ? null : (
        <Box key="five" gap={1} alignItems="center">
          {label('5h')}
          <Box>{cells(dotCells(five.percent, pal), 'd')}</Box>
          {trayed(
            <Button key="open-usage" plain dimColor={five.percent < 50} label={`${five.percent}%`} onPress={() => openUsage($)} />,
          )}
          {five.percent >= 80 ? <Text color={ink.tone('error')}>⚠</Text> : null}
          {fiveLeft !== null ? (
            <Text color={ink.tone(countdownColor(five.percent))} bold>
              ↻ {fiveLeft}
            </Text>
          ) : null}
        </Box>
      )

    const gitGroup = (compact: boolean) =>
      repo === null ? null : (
        <Box key="git" gap={1}>
          <Text color={ink.tone('suggestion')} bold>
            ⎇ {repo.branch}
            {compact && repo.changed > 0 ? '*' : ''}
          </Text>
          {!compact && repo.changed > 0 ? (
            <Text color={ink.tone('warning')} bold>
              ✎{repo.changed}
            </Text>
          ) : null}
          {!compact && repo.ahead > 0 ? <Text {...ink.faint}>↑{repo.ahead}</Text> : null}
          {!compact && repo.behind > 0 ? <Text {...ink.faint}>↓{repo.behind}</Text> : null}
        </Box>
      )

    const workGroup = showWork ? (
      <Box key="work" gap={2}>
        {e.props.isWorking ? (
          <Box gap={1}>
            <Text color={ink.tone('claude')} bold>
              ▶ {act === null ? 'thinking…' : act.tool}
            </Text>
            {act?.detail !== undefined ? <Text {...ink.faint}>{act.detail}</Text> : null}
          </Box>
        ) : null}
        {active.length > 0 ? (
          <Text color={ink.tone('suggestion')}>
            ⧉ {active.length}
            {hidden ? '' : ` agent${active.length > 1 ? 's' : ''}: ${active.slice(0, 3).join(', ')}${active.length > 3 ? '…' : ''}`}
          </Text>
        ) : null}
      </Box>
    ) : null

    if (hidden) {
      return (
        <Box flexWrap="wrap" columnGap={2} alignItems="center" {...ink.band}>
          <Box gap={1} alignItems="center">
            {here?.group != null ? whereGroup(true) : null}
            {contextGauge('mini')}
            {trayed(<Button key="open-context" plain label={`${approx}${Math.round(percent)}%`} onPress={() => openContext($)} />)}
          </Box>
          {fiveGroup}
          {gitGroup(true)}
          {workGroup}
          <Box flexGrow={1} />
          {trayed(<Button key="show" label="Show" onPress={() => toggleHidden($)} />)}
        </Box>
      )
    }

    return (
      <Box flexWrap="wrap" columnGap={2} alignItems="center" {...ink.band}>
        <Box gap={1} alignItems="center">
          {whereGroup(false)}
          {contextGauge('full')}
          {trayed(<Button key="open-context" plain label={`${approx}${pctText(percent)}%`} onPress={() => openContext($)} />)}
          {f !== null ? (
            <Text {...ink.faint}>
              ({kilo(f.tokens)}/{kilo(f.window)})
            </Text>
          ) : null}
          {growth !== null && growth > 0 ? <Text {...ink.faint}>+{kilo(growth)}</Text> : null}
        </Box>
        {toCompact !== null && toCompact >= COMPACT_WARN ? (
          <Text color={ink.tone('warning')} bold>
            ⚠ auto-compact {toCompact}%
          </Text>
        ) : null}
        {toCompact === null && percent >= 90 ? (
          <Text color={ink.tone('error')} bold>
            ⚠ nearly full, /compact
          </Text>
        ) : null}
        {fiveGroup}
        {fable.map(l => (
          <Box key={l.kind} gap={1} alignItems="center">
            {label('Fable')}
            <Box>{cells(trackCells(l.percent, SMOOTH, null, pal), `f${l.kind}`)}</Box>
            <Text {...(l.percent >= 80 ? { color: ink.tone('error') } : l.percent < 50 ? ink.faint : ink.plain)}>
              {l.percent}%
            </Text>
          </Box>
        ))}
        {gitGroup(false)}
        {turnMs !== null || elapsed !== null ? (
          <Box gap={1}>
            {turnMs !== null ? <Text {...ink.faint}>L:{withUnits(turnLength(turnMs), 'l')}</Text> : null}
            {elapsed !== null ? <Text {...ink.faint}>Age:{withUnits(elapsed, 'a')}</Text> : null}
          </Box>
        ) : null}
        {workGroup}
        <Box flexGrow={1} />
        {toCompact !== null && toCompact >= 70 ? (
          trayed(<Button key="bar-compact" label="Compact" onPress={() => compactNow($).catch(() => {})} />)
        ) : null}
        {trayed(<Button key="hide" label="Hide" onPress={() => toggleHidden($)} />)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [b, f, threshold, early, inUseModel, hist, nTurn, nTotal, byModel, cost, themed, here] = await Promise.all([
      read($, breakdown),
      read($, fill),
      read($, compactAt),
      read($, autoCompactOn),
      read($, modelInUse),
      read($, tokHist),
      read($, toolsTurn),
      read($, toolsTotal),
      read($, stepsByModel),
      read($, costUsd),
      read($, themeName),
      read($, place),
    ])
    const ink = inksOf(paletteOf(themed))
    const turns = turnsLeft(hist, threshold)
    const max = f?.window ?? b?.max ?? 0
    const used = f?.tokens ?? b?.total ?? 0
    const share = (n: number) => (max > 0 ? (n / max) * 100 : 0)

    const headline = (
      <Box flexDirection="column" marginBottom={1}>
        <Box alignItems="flex-end" gap={1}>
          <Text bold {...ink.plain}>
            {f?.estimated === true ? '~' : ''}
            {pctText(share(used))}%
          </Text>
          <Text {...ink.faint}>
            of {kilo(max)} used
          </Text>
        </Box>
        <Text {...ink.faint}>
          {kilo(used)} tokens
          {inUseModel !== null
            ? ` · ${modelName(inUseModel.model)}${inUseModel.effort !== undefined ? ` (${inUseModel.effort})` : ''}`
            : b !== null
              ? ` · ${modelName(b.model)}`
              : ''}
          {threshold !== null ? ` · auto-compacts at ${kilo(threshold)}` : ''}
          {turns !== null ? ` · ~${turns} turn${turns === 1 ? '' : 's'} to compact` : ''}
          {cost !== null && cost > 0 ? ` · ${usd(cost)} this session` : ''}
        </Text>
        {here !== null ? (
          <Text {...ink.faint}>
            {here.group !== null ? `${here.group.mark} ${here.group.name} · ` : ''}
            {here.path}
          </Text>
        ) : null}
      </Box>
    )

    if (b === null) {
      return (
        <Box flexDirection="column" paddingX={1} {...ink.pane}>
          {headline}
          <Text {...ink.faint}>The breakdown appears after Claude's next reply.</Text>
          <Box gap={2} marginTop={1} {...ink.tray}>
            <Button
              key="ctx-refresh"
              label="Refresh"
              onPress={() =>
                refreshThreshold($)
                  .then(() => refreshUsage($, { checkWindow: false }))
                  .catch(() => {})
              }
            />
          </Box>
        </Box>
      )
    }

    const isSpare = (kind: string) => kind === 'free' || kind === 'buffer'
    const inUse = b.rows.filter(r => !r.isDeferred && !isSpare(r.kind) && r.tokens > 0)
    const spare = b.rows.filter(r => !r.isDeferred && isSpare(r.kind) && r.tokens > 0)
    const later = b.rows.filter(r => r.isDeferred && r.tokens > 0)

    const row = (r: { name: string; tokens: number; color: string }, faint: boolean, showShare: boolean) => (
      <Box key={`${r.name}-${faint}-${showShare}`} gap={1}>
        <Text color={faint ? 'inactive' : ink.tone(r.color)}>{faint ? '○' : '●'}</Text>
        <Box flexGrow={1}>
          <Text {...(faint ? ink.faint : ink.plain)}>{r.name}</Text>
        </Box>
        <Box width={7} justifyContent="flex-end">
          <Text {...ink.faint}>
            {kilo(r.tokens)}
          </Text>
        </Box>
        <Box width={7} justifyContent="flex-end">
          <Text {...(faint ? ink.faint : ink.plain)}>
            {showShare ? `${pctText(share(r.tokens))}%` : ''}
          </Text>
        </Box>
      </Box>
    )

    const section = (title: string, rows: typeof inUse, faint: boolean, showShare: boolean) =>
      rows.length === 0 ? null : (
        <Box key={title} flexDirection="column" marginTop={1}>
          <Text bold {...ink.faint}>
            {title}
          </Text>
          {rows.map(r => row(r, faint, showShare))}
        </Box>
      )

    return (
      <Box flexDirection="column" paddingX={1} {...ink.pane}>
        {headline}
        <Box height={1} width="100%">
          {inUse.map(r => (
            <Box key={`s-${r.name}`} width={`${Math.max(1, Math.round(share(r.tokens)))}%`} height={1} backgroundColor={ink.tone(r.color)} />
          ))}
          <Box flexGrow={1} height={1} backgroundColor="inactive" />
        </Box>
        <Text {...ink.faint}>
          Tools: {nTurn} this turn (main), {nTotal} this session incl. subagents
          {Object.keys(byModel).length > 0
            ? ` · steps: ${Object.entries(byModel)
                .map(([m, n]) => `${modelName(m)} ${n}`)
                .join(', ')}`
            : ''}
        </Text>
        {section('In use', inUse, false, true)}
        {section('Room left', spare, true, true)}
        {section('Loaded when needed', later, true, false)}
        <Box gap={2} marginTop={1} flexWrap="wrap" {...ink.tray}>
          <Button
            key="ctx-refresh"
            hotkey="r"
            label="Refresh"
            onPress={() =>
              refreshThreshold($)
                .then(() => refreshUsage($, { checkWindow: false }))
                .catch(() => {})
            }
          />
          <Button
            key="ctx-compact"
            hotkey="c"
            label="Compact now"
            onPress={() => compactNow($).catch(() => {})}
          />
          <Button
            key="ctx-early"
            label={early ? `Early compact at ${EARLY_COMPACT_AT}%: on` : `Early compact at ${EARLY_COMPACT_AT}%: off`}
            onPress={() => toggleAutoCompact($).catch(() => {})}
          />
          <Button
            key="ctx-copy"
            label="Copy figures"
            onPress={() =>
              $.ui.copy({
                text: [
                  `Context ${pctText(share(used))}% used (${kilo(used)}/${kilo(max)})`,
                  ...inUse.map(r => `${r.name}: ${kilo(r.tokens)} (${pctText(share(r.tokens))}%)`),
                ].join('\n'),
                surface: e.surface,
              })
                .then(() => $.ui.toast('Copied'))
                .catch(() => {})
            }
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: USAGE_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [ls, t, sound, themed, hist5] = await Promise.all([
      read($, limits),
      read($, now),
      read($, soundOn),
      read($, themeName),
      read($, fiveHist),
    ])
    const pal = paletteOf(themed)
    const ink = inksOf(pal)
    // Every skin as a sample gauge on its own backdrop, the current one ticked.
    const skins = (
      <Box flexDirection="column" marginTop={1}>
        <Text bold {...ink.plain}>Skin</Text>
        <Box columnGap={3} flexWrap="wrap" {...ink.tray}>
          {THEME_NAMES.map(name => {
            const sample = THEMES[name]!
            return (
              <Box key={`skin-${name}`} alignItems="center" gap={1}>
                <Box backgroundColor={sample.surface?.bg} paddingX={1}>
                  <Text>
                    {miniCells(60, sample).map((c, i) => (
                      <Text key={`sk-${name}-${i}`} color={c.color}>
                        {c.ch}
                      </Text>
                    ))}
                  </Text>
                </Box>
                <Button
                  key={`usage-skin-${name}`}
                  label={name === themed ? `✓ ${name}` : name}
                  onPress={() => setTheme($, name).catch(() => {})}
                />
              </Box>
            )
          })}
        </Box>
      </Box>
    )
    const controls = (
      <Box gap={2} marginTop={1} flexWrap="wrap" {...ink.tray}>
        <Button key="usage-refresh" hotkey="r" label="Refresh" onPress={() => refreshUsage($).catch(() => {})} />
        <Button key="usage-sound" hotkey="s" label={sound ? 'Sound: on' : 'Sound: off'} onPress={() => toggleSound($).catch(() => {})} />
        <Button key="usage-hide-bar" label="Hide the bar" onPress={() => toggleHidden($).catch(() => {})} />
        <Button
          key="usage-clear"
          label="Clear chat"
          onPress={() => {
            $.ui.toast('Clearing the conversation…')
            $.command.run({ command: 'clear' })
              .then(() => afterShrink($))
              .catch(err => $.ui.toast(`Clear failed: ${String(err)}`))
          }}
        />
      </Box>
    )
    if (ls.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1} {...ink.pane}>
          <Text {...ink.faint}>Your usage appears after Claude's next reply.</Text>
          {controls}
          {skins}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" paddingX={1} gap={1} {...ink.pane}>
        {ls.map(l => {
          const left = resetIn(l.resetsAt, t)
          const mins = l.kind === 'five_hour' ? minutesToLimit(hist5, t) : null
          const warn = l.kind === 'five_hour' ? forecast(hist5, l.resetsAt, t) : null
          const pct = Math.min(100, Math.max(0, l.percent))
          return (
            <Box key={`u-${l.kind}`} flexDirection="column">
              <Text bold {...ink.plain}>{limitName(l.kind)}</Text>
              <Box justifyContent="space-between" alignItems="flex-end">
                <Box alignItems="flex-end" gap={1}>
                  <Text bold color={gradientAt(pct / 100, pal)}>
                    {l.percent}%
                  </Text>
                  <Text {...ink.faint}>used</Text>
                </Box>
                <Text {...(left !== null ? { color: ink.tone(countdownColor(l.percent)) } : ink.faint)}>
                  {left !== null ? `resets in ${left}` : 'reset time not reported'}
                </Text>
              </Box>
              {warn !== null ? (
                <Text color={ink.tone('error')} bold>
                  ⚠ At the recent pace, the {warn} — before the reset
                </Text>
              ) : l.kind !== 'five_hour' ? null : mins !== null ? (
                <Text {...ink.faint}>At the recent pace, the limit lands in ~{minutesText(mins)} — after the reset</Text>
              ) : (
                <Text {...ink.faint}>Pace appears after a few minutes of readings.</Text>
              )}
              <Box height={1} width="100%">
                {pct > 0 ? <Box width={`${Math.max(1, Math.round(pct))}%`} height={1} backgroundColor={gradientAt(pct / 100, pal)} /> : null}
                <Box flexGrow={1} height={1} backgroundColor="inactive" />
              </Box>
            </Box>
          )
        })}
        {ls.every(l => !isFable(l.kind)) ? (
          <Box flexDirection="column">
            <Text bold {...ink.faint}>
              Fable (weekly)
            </Text>
            <Box height={1} width="100%">
              <Box flexGrow={1} height={1} backgroundColor="inactive" />
            </Box>
            <Text {...ink.faint}>Not reported to mods; see Settings → Usage for the real figure.</Text>
          </Box>
        ) : null}
        {controls}
        {skins}
      </Box>
    )
  })
}
