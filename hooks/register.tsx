import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Breakdown, ContextFill, GitInfo, Limit, RunningTool, UsageSample } from '../types'

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
}

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
  },
  // Green phosphor terminal: one hue, brightening as it fills, prompt-style labels.
  hermes: {
    stops: [
      [0x14, 0x5a, 0x32],
      [0x2f, 0xb4, 0x5a],
      [0x9b, 0xe5, 0x64],
    ],
    track: '#2a2f2a',
    trackDots: '#4a554a',
    notch: '#9ef01a',
    glyphs: { fill: '█', empty: '·', dotOn: '●', dotOff: '·', miniOn: '█', miniOff: '·', marker: '│' },
    deco: label => `>${label.toLowerCase()}`,
    labelInk: '#2fb45a',
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
  },
  // Amber CRT: bracketed capitals and phosphor orange.
  retro: {
    stops: [
      [0x8a, 0x5a, 0x00],
      [0xb3, 0x6b, 0x00],
      [0xe8, 0x5d, 0x04],
    ],
    track: '#d8cdb8',
    trackDots: '#b8a98a',
    notch: '#7a3b00',
    glyphs: { fill: '█', empty: '.', dotOn: '■', dotOff: '.', miniOn: '█', miniOff: '.', marker: '|' },
    deco: label => `[${label.toUpperCase()}]`,
    labelInk: '#b36b00',
  },
  // Neon on dark glass: cyan into violet into magenta.
  cyberpunk: {
    stops: [
      [0x00, 0x9f, 0xb7],
      [0x7c, 0x3a, 0xed],
      [0xd9, 0x00, 0x8f],
    ],
    track: '#3a3f4b',
    trackDots: '#565d6d',
    notch: '#f72585',
    glyphs: { fill: '█', empty: '▒', dotOn: '◉', dotOff: '◌', miniOn: '▰', miniOff: '▱', marker: '┊' },
    deco: label => `▸${label}`,
    labelInk: '#00c2d1',
  },
}

export const THEME_NAMES = Object.keys(THEMES)

const paletteOf = (name: string): Palette => THEMES[name] ?? THEMES['meadow']!

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
  return { on: lit.repeat(f), off: unlit.repeat(MINI - f) }
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
  const { on, off } = mini(percent, pal.glyphs.miniOn, pal.glyphs.miniOff)
  return [...gradientCells(on, 0, MINI, pal), ...[...off].map(ch => ({ ch, color: pal.track }))]
}

/** Five dots for the 5h window: lit ones in the gradient, the rest as rings. */
export const dotCells = (percent: number, pal: Palette = THEMES['meadow']!) => {
  const { on, off } = mini(percent, pal.glyphs.dotOn, pal.glyphs.dotOff)
  return [...gradientCells(on, 0, MINI, pal), ...[...off].map(ch => ({ ch, color: pal.track }))]
}

export const isFable = (kind: string) => /fable/i.test(kind)

export const turnLength = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** The reset countdown: blue while usage is easy, warning colours as the limit nears. */
export const countdownColor = (percent: number) =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'suggestion'

export const duration = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** Time until an ISO reset moment, as "2h05m" or "12m"; null when unknown or past. */
export const resetIn = (resetsAt: string | undefined, nowMs: number) => {
  if (resetsAt === undefined || nowMs === 0) return null
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at) || at <= nowMs) return null
  const m = Math.ceil((at - nowMs) / 60000)
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
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

/**
 * Minutes until the 5h limit is used up at the recent pace, from samples at
 * least two minutes apart; null when flat, falling or too few samples.
 */
export const minutesToLimit = (hist: UsageSample[], nowMs: number): number | null => {
  const last = hist[hist.length - 1]
  const first = hist.find(h => last !== undefined && last.at - h.at >= 2 * 60000) ?? hist[0]
  if (first === undefined || last === undefined || last.at - first.at < 2 * 60000) return null
  const perMs = (last.percent - first.percent) / (last.at - first.at)
  if (perMs <= 0 || last.percent >= 100) return null
  const left = Math.ceil((100 - last.percent) / perMs / 60000) + Math.round((last.at - nowMs) / 60000)
  // Stale samples can date the estimate; never show zero or negative minutes.
  return Math.max(1, left)
}

/** The forecast line, only when the limit would land before the reset at the recent pace. */
export const forecast = (hist: UsageSample[], resetsAt: string | undefined, nowMs: number): string | null => {
  const left = minutesToLimit(hist, nowMs)
  if (left === null) return null
  const reset = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (Number.isNaN(reset) || nowMs + left * 60000 >= reset) return null
  return left <= 60 ? `limit in ~${left}m` : `limit in ~${Math.floor(left / 60)}h${String(left % 60).padStart(2, '0')}m`
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

async function refreshUsage($: EngineInterface, opts: { checkWindow: boolean } = { checkWindow: true }) {
  const [usage, at, prev] = await Promise.all([$.session.usage(), $.clock.now(), read($, fill)])
  const { context } = usage
  const next: ContextFill | null =
    context.percent === undefined || context.tokens === undefined
      ? null
      : {
          percent: context.window > 0 ? Math.round((context.tokens / context.window) * 1000) / 10 : context.percent,
          tokens: context.tokens,
          window: context.window,
        }
  const nextLimits: Limit[] = clearPassedResets(
    usage.rateLimits.map(l => ({ kind: l.kind, percent: Math.round(l.percentUsed), resetsAt: l.resetsAt })),
    at,
  )
  await Promise.all([
    update($, fill, () => next),
    // A response without rate-limit headers reports none; keep the last reading.
    update($, limits, prev => (nextLimits.length > 0 ? nextLimits : prev)),
    update($, startedAt, () => usage.startedAt),
    update($, now, () => at),
    // A reading without a cost keeps the last one, as the limits write does.
    update($, costUsd, prev => usage.cost?.usd ?? prev),
  ])

  const fiveNow = nextLimits.find(l => l.kind === 'five_hour')
  if (fiveNow !== undefined) {
    await update($, fiveHist, hist => {
      const next = [...hist, { at, percent: fiveNow.percent }]
      // A falling reading means the window reset: start the pace over.
      if (next.length >= 2 && (next[next.length - 2]?.percent ?? 0) > fiveNow.percent) return [{ at, percent: fiveNow.percent }]
      return next.slice(-30)
    })
  }

  await checkReset($, at)

  // A new window (model or setting change) moves the auto-compact point.
  if (opts.checkWindow && next !== null && prev !== null && prev.window !== next.window) await refreshThreshold($)

  const threshold = await read($, compactAt)
  const pct = next === null ? null : compactPercent(next.tokens, threshold)
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
  const next = await update($, soundOn, was => !was)
  await $.store.set('soundOn', next).catch(() => {})
  if (next) ringDone($).catch(() => {})
}

async function syncSound($: EngineInterface) {
  const stored = await $.store.get('soundOn')
  await update($, soundOn, () => stored !== false)
}

async function toggleAutoCompact($: EngineInterface) {
  const next = await update($, autoCompactOn, was => !was)
  await $.store.set('autoCompactOn', next).catch(() => {})
  $.ui.toast(next ? `Will compact at ${EARLY_COMPACT_AT}% of the way to auto-compact` : 'Early compaction off')
}

async function syncAutoCompact($: EngineInterface) {
  const stored = await $.store.get('autoCompactOn')
  await update($, autoCompactOn, () => stored === true)
}

/**
 * With early compaction on, compacts once the context is nearly at the
 * auto-compact point. The toggle is turned off before the attempt and turned
 * back on only when compaction succeeded and actually lowered the context, so
 * a failing or ineffective compaction cannot retry every turn; and only when
 * nobody flipped the stored setting while it ran, so a mid-run choice stands.
 */
async function maybeCompactEarly($: EngineInterface) {
  if (!(await read($, autoCompactOn))) return
  const [f, threshold] = await Promise.all([read($, fill), read($, compactAt)])
  const pct = f === null ? null : compactPercent(f.tokens, threshold)
  if (pct === null || pct < EARLY_COMPACT_AT) return
  await update($, autoCompactOn, () => false)
  $.ui.toast(`Context ${pct}% of the way to auto-compact: compacting now`)
  let helped = false
  try {
    await $.session.compact()
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

/** Steps to the next theme and remembers it across sessions. */
async function cycleTheme($: EngineInterface) {
  const next = await update($, themeName, was => {
    const i = THEME_NAMES.indexOf(was)
    return THEME_NAMES[(i + 1) % THEME_NAMES.length] ?? 'meadow'
  })
  await $.store.set('themeName', next).catch(() => {})
  $.ui.toast(`Theme: ${next}`)
}

async function syncTheme($: EngineInterface) {
  const stored = await $.store.get('themeName')
  await update($, themeName, () => (typeof stored === 'string' && stored in THEMES ? stored : 'meadow'))
}

async function toggleHidden($: EngineInterface) {
  const next = await update($, isHidden, was => !was)
  await $.store.set('isHidden', next).catch(() => {})
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
  const next = res.exitCode === 0 ? parseGitStatus(res.stdout) : null
  const at = await $.clock.now()
  await Promise.all([update($, git, () => next), update($, gitAt, () => at)])
}

/** Reads git after a file-changing tool, at most once per GIT_EVERY_MS. */
async function refreshGitSoon($: EngineInterface) {
  const [at, last] = await Promise.all([$.clock.now(), read($, gitAt)])
  if (last !== null && at - last < GIT_EVERY_MS) return
  await refreshGit($)
}

async function refreshAgents($: EngineInterface) {
  const list = await $.agent.list()
  const next = list.filter(a => ACTIVE.includes(a.status)).map(a => a.name ?? a.type)
  await update($, agents, () => next)
}

async function tick($: EngineInterface, me: string, timer: { cancel: () => void }) {
  // A reload starts a newer tick; the older one stops itself.
  if ((await read($, tickOwner)) !== me) return timer.cancel()
  const at = await $.clock.now()
  await update($, now, () => at)
  await checkReset($, at)
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
    await $.command
      .register({ name: 'contextbar', description: 'Context bar: show, hide, sound and early compaction' })
      .catch(() => {})
    await Promise.all([
      refreshThreshold($)
        .then(() => refreshUsage($, { checkWindow: false }))
        .catch(() => {}),
      startTick($).catch(() => {}),
      refreshGit($).catch(() => {}),
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
      if (asked in THEMES) {
        await update($, themeName, () => asked)
        await $.store.set('themeName', asked).catch(() => {})
        return { text: `Theme: ${asked}.` }
      }
      if (asked === '') {
        const current = await read($, themeName)
        return { text: `Theme: ${current}. Themes: ${THEME_NAMES.join(', ')}.` }
      }
      return { text: `No theme called “${asked}”. Themes: ${THEME_NAMES.join(', ')}.` }
    }
    const [hidden, sound, early] = await Promise.all([read($, isHidden), read($, soundOn), read($, autoCompactOn)])
    return {
      text: [
        ...(want !== '' ? [`Didn't understand “${want}”.`] : []),
        `Context bar: ${hidden ? 'collapsed' : 'expanded'} · sound ${sound ? 'on' : 'off'} · early compact ${early ? 'on' : 'off'}`,
        'Usage: /contextbar show | hide | sound on | sound off | early on | early off | theme <name>',
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

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
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
    const [f, threshold, ls, start, t, tools, turnMs, active, hidden, repo, growth, themed] = await Promise.all([
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
    ])
    const act = tools[tools.length - 1] ?? null

    const percent = f?.percent ?? 0
    const toCompact = f === null ? null : compactPercent(f.tokens, threshold)
    const elapsed = start === null || t === 0 ? null : duration(t - start)

    const showWork = e.props.isWorking || active.length > 0
    const five = ls.find(l => l.kind === 'five_hour')
    const pal = paletteOf(themed)

    const label = (text: string) => (
      <Text color={pal.labelInk} dimColor={pal.labelInk === undefined}>
        {pal.deco(text)}
      </Text>
    )
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
          <Button
            key="open-usage"
            plain
            dimColor={five.percent < 50}
            label={`${five.percent}%`}
            onPress={() => openUsage($)}
          />
          {five.percent >= 80 ? <Text color="error">⚠</Text> : null}
          {fiveLeft !== null ? (
            <Text color={countdownColor(five.percent)} bold>
              ↻ {fiveLeft}
            </Text>
          ) : null}
        </Box>
      )

    const gitGroup = (compact: boolean) =>
      repo === null ? null : (
        <Box key="git" gap={1}>
          <Text color="suggestion" bold>
            ⎇ {repo.branch}
            {compact && repo.changed > 0 ? '*' : ''}
          </Text>
          {!compact && repo.changed > 0 ? (
            <Text color="warning" bold>
              ✎{repo.changed}
            </Text>
          ) : null}
          {!compact && repo.ahead > 0 ? <Text dimColor>↑{repo.ahead}</Text> : null}
          {!compact && repo.behind > 0 ? <Text dimColor>↓{repo.behind}</Text> : null}
        </Box>
      )

    const workGroup = showWork ? (
      <Box key="work" gap={2}>
        {e.props.isWorking ? (
          <Box gap={1}>
            <Text color="claude" bold>
              ▶ {act === null ? 'thinking…' : act.tool}
            </Text>
            {act?.detail !== undefined ? <Text dimColor>{act.detail}</Text> : null}
          </Box>
        ) : null}
        {active.length > 0 ? (
          <Text color="suggestion">
            ⧉ {active.length}
            {hidden ? '' : ` agent${active.length > 1 ? 's' : ''}: ${active.slice(0, 3).join(', ')}${active.length > 3 ? '…' : ''}`}
          </Text>
        ) : null}
      </Box>
    ) : null

    if (hidden) {
      return (
        <Box flexWrap="wrap" columnGap={2} alignItems="center">
          <Box gap={1} alignItems="center">
            {contextGauge('mini')}
            <Button key="open-context" plain label={`${Math.round(percent)}%`} onPress={() => openContext($)} />
          </Box>
          {fiveGroup}
          {gitGroup(true)}
          {workGroup}
          <Box flexGrow={1} />
          <Button key="show" label="Show" onPress={() => toggleHidden($)} />
        </Box>
      )
    }

    return (
      <Box flexWrap="wrap" columnGap={2} alignItems="center">
        <Box gap={1} alignItems="center">
          {label('Context')}
          {contextGauge('full')}
          <Button key="open-context" plain label={`${pctText(percent)}%`} onPress={() => openContext($)} />
          {f !== null ? (
            <Text dimColor>
              ({kilo(f.tokens)}/{kilo(f.window)})
            </Text>
          ) : null}
          {growth !== null && growth > 0 ? <Text dimColor>+{kilo(growth)}</Text> : null}
        </Box>
        {toCompact !== null && toCompact >= COMPACT_WARN ? (
          <Text color="warning" bold>
            ⚠ auto-compact {toCompact}%
          </Text>
        ) : null}
        {toCompact === null && percent >= 90 ? (
          <Text color="error" bold>
            ⚠ nearly full, /compact
          </Text>
        ) : null}
        {fiveGroup}
        {fable.map(l => (
          <Box key={l.kind} gap={1} alignItems="center">
            {label('Fable')}
            <Box>{cells(trackCells(l.percent, SMOOTH, null, pal), `f${l.kind}`)}</Box>
            <Text dimColor={l.percent < 50} color={l.percent >= 80 ? 'error' : undefined}>
              {l.percent}%
            </Text>
          </Box>
        ))}
        {gitGroup(false)}
        {turnMs !== null || elapsed !== null ? (
          <Box gap={1}>
            {turnMs !== null ? <Text dimColor>L:{turnLength(turnMs)}</Text> : null}
            {elapsed !== null ? <Text dimColor>Total:{elapsed}</Text> : null}
          </Box>
        ) : null}
        {workGroup}
        <Box flexGrow={1} />
        {toCompact !== null && toCompact >= 70 ? (
          <Button
            key="bar-compact"
            label="Compact"
            onPress={() => {
              $.ui.toast('Compacting the conversation…')
              $.session
                .compact()
                .then(() => $.ui.toast('Compacted'))
                .catch(err => $.ui.toast(`Compact failed: ${String(err)}`))
            }}
          />
        ) : null}
        <Button key="hide" label="Hide" onPress={() => toggleHidden($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [b, f, threshold, early, inUseModel, hist, nTurn, nTotal, byModel, cost] = await Promise.all([
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
    ])
    const turns = turnsLeft(hist, threshold)
    const max = f?.window ?? b?.max ?? 0
    const used = f?.tokens ?? b?.total ?? 0
    const share = (n: number) => (max > 0 ? (n / max) * 100 : 0)

    const headline = (
      <Box flexDirection="column" marginBottom={1}>
        <Box alignItems="flex-end" gap={1}>
          <Text bold>
            {pctText(share(used))}%
          </Text>
          <Text dimColor>
            of {kilo(max)} used
          </Text>
        </Box>
        <Text dimColor>
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
      </Box>
    )

    if (b === null) {
      return (
        <Box flexDirection="column" paddingX={1}>
          {headline}
          <Text dimColor>The breakdown appears after Claude's next reply.</Text>
          <Box gap={2} marginTop={1}>
            <Button key="ctx-refresh" label="Refresh" onPress={() => refreshThreshold($).catch(() => {})} />
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
        <Text color={faint ? 'inactive' : r.color}>{faint ? '○' : '●'}</Text>
        <Box flexGrow={1}>
          <Text dimColor={faint}>{r.name}</Text>
        </Box>
        <Box width={7} justifyContent="flex-end">
          <Text dimColor>
            {kilo(r.tokens)}
          </Text>
        </Box>
        <Box width={7} justifyContent="flex-end">
          <Text dimColor={faint}>
            {showShare ? `${pctText(share(r.tokens))}%` : ''}
          </Text>
        </Box>
      </Box>
    )

    const section = (title: string, rows: typeof inUse, faint: boolean, showShare: boolean) =>
      rows.length === 0 ? null : (
        <Box key={title} flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            {title}
          </Text>
          {rows.map(r => row(r, faint, showShare))}
        </Box>
      )

    return (
      <Box flexDirection="column" paddingX={1}>
        {headline}
        <Box height={1} width="100%">
          {inUse.map(r => (
            <Box key={`s-${r.name}`} width={`${Math.max(1, Math.round(share(r.tokens)))}%`} height={1} backgroundColor={r.color} />
          ))}
          <Box flexGrow={1} height={1} backgroundColor="inactive" />
        </Box>
        <Text dimColor>
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
        <Box gap={2} marginTop={1} flexWrap="wrap">
          <Button key="ctx-refresh" hotkey="r" label="Refresh" onPress={() => refreshThreshold($).catch(() => {})} />
          <Button
            key="ctx-compact"
            hotkey="c"
            label="Compact now"
            onPress={() => {
              $.ui.toast('Compacting the conversation…')
              $.session
                .compact()
                .then(() => $.ui.toast('Compacted'))
                .catch(err => $.ui.toast(`Compact failed: ${String(err)}`))
            }}
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
              $.ui
                .copy({
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
    const controls = (
      <Box gap={2} marginTop={1} flexWrap="wrap">
        <Button key="usage-refresh" hotkey="r" label="Refresh" onPress={() => refreshUsage($).catch(() => {})} />
        <Button key="usage-sound" hotkey="s" label={sound ? 'Sound: on' : 'Sound: off'} onPress={() => toggleSound($).catch(() => {})} />
        <Button key="usage-theme" hotkey="t" label={`Theme: ${themed}`} onPress={() => cycleTheme($).catch(() => {})} />
        <Button key="usage-hide-bar" label="Hide the bar" onPress={() => toggleHidden($).catch(() => {})} />
        <Button
          key="usage-clear"
          label="Clear chat"
          onPress={() => {
            $.ui.toast('Clearing the conversation…')
            $.command.run({ command: 'clear' }).catch(err => $.ui.toast(`Clear failed: ${String(err)}`))
          }}
        />
      </Box>
    )
    if (ls.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>Your usage appears after Claude's next reply.</Text>
          {controls}
        </Box>
      )
    }
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        {ls.map(l => {
          const left = resetIn(l.resetsAt, t)
          const mins = l.kind === 'five_hour' ? minutesToLimit(hist5, t) : null
          const warn = l.kind === 'five_hour' ? forecast(hist5, l.resetsAt, t) : null
          const pct = Math.min(100, Math.max(0, l.percent))
          return (
            <Box key={`u-${l.kind}`} flexDirection="column">
              <Text bold>{limitName(l.kind)}</Text>
              <Box justifyContent="space-between" alignItems="flex-end">
                <Box alignItems="flex-end" gap={1}>
                  <Text bold color={gradientAt(pct / 100, pal)}>
                    {l.percent}%
                  </Text>
                  <Text dimColor>used</Text>
                </Box>
                <Text color={left !== null ? countdownColor(l.percent) : undefined} dimColor={left === null}>
                  {left !== null ? `resets in ${left}` : 'reset time not reported'}
                </Text>
              </Box>
              {warn !== null ? (
                <Text color="error" bold>
                  ⚠ At the recent pace, the {warn} — before the reset
                </Text>
              ) : l.kind !== 'five_hour' ? null : mins !== null ? (
                <Text dimColor>
                  At the recent pace, the limit lands in ~
                  {mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`} — after the
                  reset
                </Text>
              ) : (
                <Text dimColor>Pace appears after a few minutes of readings.</Text>
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
            <Text bold dimColor>
              Fable (weekly)
            </Text>
            <Box height={1} width="100%">
              <Box flexGrow={1} height={1} backgroundColor="inactive" />
            </Box>
            <Text dimColor>Not reported to mods; see Settings → Usage for the real figure.</Text>
          </Box>
        ) : null}
        {controls}
      </Box>
    )
  })
}
