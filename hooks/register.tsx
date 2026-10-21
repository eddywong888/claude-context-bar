import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Breakdown, ContextFill, GitInfo, Limit, RunningTool } from '../types'

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
const soundOn = atom({ plugin: 'context-bar', key: 'soundOn' } as const, true)
const tickOwner = atom({ plugin: 'context-bar', key: 'tickOwner' } as const, null)

const CONTEXT_PANE = 'context-bar-context'
const USAGE_PANE = 'context-bar-usage'
const WIDTH = 12
/** Cells in the Fable gauge. */
const SMOOTH = 8
const COMPACT_WARN = 85
const ACTIVE = ['pending', 'running', 'waiting']
/** Tools that can change files, after which the git status is read again. */
const WRITERS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit']
/** Git is read at most this often after tool calls; every turn end reads it regardless. */
const GIT_EVERY_MS = 5000

export const kilo = (n: number) =>
  n >= 999_500 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`

export const pctText = (p: number) => (p < 10 ? p.toFixed(1) : String(Math.round(p * 10) / 10))

const STOPS: [number, number, number][] = [
  [0x11, 0x7a, 0x2e], // deep green
  [0xb3, 0x6b, 0x00], // deep amber
  [0xb3, 0x1d, 0x28], // deep red
]

/** The gauge colour at a position from 0 (green) through amber to 1 (red). */
export const gradientAt = (t: number) => {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const a = STOPS[i] ?? STOPS[0]!
  const b = STOPS[i + 1] ?? a
  const f = x - i
  const hex = (k: 0 | 1 | 2) => Math.round(a[k] + (b[k] - a[k]) * f).toString(16).padStart(2, '0')
  return `#${hex(0)}${hex(1)}${hex(2)}`
}

/** One gradient cell per character of `text`, coloured by its place among `of` cells. */
export const gradientCells = (text: string, start: number, of: number) =>
  [...text].map((ch, i) => ({ ch, color: gradientAt(of <= 1 ? 0 : (start + i) / (of - 1)) }))

const MINI = 5

/** A five-cell gauge: lit cells (▰ for bars, ● for dots) and the unlit rest. */
export const mini = (percent: number, lit: string, unlit: string) => {
  const f = Math.min(MINI, Math.max(0, Math.ceil((percent / 100) * MINI)))
  return { on: lit.repeat(f), off: unlit.repeat(MINI - f) }
}

/** Where the early-warning line sits on the context bar, as a share of the window. */
export const WARN_AT = 75

/** Grey for the unlit part of every gauge, so the track reads as one strip. */
const TRACK = '#c9ced6'
/** The early-warning marker on the context gauge. */
const NOTCH_WARN = '#8a5a1f'
/** The stippled track the empty part of the context gauge is drawn in. */
const TRACK_DOTS = '#9aa1ab'

/**
 * The context gauge: lit cells in the gradient, the rest as a light stippled
 * track, and a thin marker set between two cells at `warnPercent`, so it adds
 * a line rather than taking a cell. The bar shows only the warning line;
 * the auto-compact point is reported in text.
 */
export const trackCells = (percent: number, width: number, warnPercent: number | null) => {
  const lit = Math.min(width, Math.max(0, Math.ceil(((percent - 1e-9) / 100) * width)))
  const warn = warnPercent === null ? -1 : Math.min(width, Math.max(0, Math.round((warnPercent / 100) * width)))
  const out: { ch: string; color: string; dim?: boolean }[] = []
  for (let i = 0; i <= width; i++) {
    if (i === warn) out.push({ ch: '┃', color: NOTCH_WARN })
    if (i === width) break
    out.push(i < lit ? { ch: '█', color: gradientAt(width <= 1 ? 0 : i / (width - 1)) } : { ch: '░', color: TRACK_DOTS, dim: true })
  }
  return out
}

/** The hidden view's five-cell gauge: ▰ lit in the gradient, ▱ unlit. */
export const miniCells = (percent: number) => {
  const { on, off } = mini(percent, '▰', '▱')
  return [...gradientCells(on, 0, MINI), ...[...off].map(ch => ({ ch, color: TRACK }))]
}

/** Five dots for the 5h window: lit ones in the gradient, the rest as rings. */
export const dotCells = (percent: number) => {
  const { on, off } = mini(percent, '●', '○')
  return [...gradientCells(on, 0, MINI), ...[...off].map(ch => ({ ch, color: TRACK }))]
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
  ])

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
    await Promise.all([
      refreshThreshold($)
        .then(() => refreshUsage($, { checkWindow: false }))
        .catch(() => {}),
      startTick($).catch(() => {}),
      refreshGit($).catch(() => {}),
      syncHidden($).catch(() => {}),
      syncSound($).catch(() => {}),
    ])
    return result
  })

  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const id = e.tool_use_id ?? `${e.tool}-${Math.random()}`
    if (isMain) {
      const entry: RunningTool = { id, tool: e.tool, detail: detailOf(e as Record<string, unknown>) }
      await update($, running, list => [...list, entry]).catch(() => {})
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

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const at = await $.clock.now().catch(() => null)
      if (at !== null) await update($, turnStartedAt, () => at).catch(() => {})
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
      ])
      if (e.reason === 'answer') ringDone($).catch(() => {})
    } else {
      await refreshAgents($).catch(() => {})
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const [f, threshold, ls, start, t, tools, turnMs, active, hidden, repo] = await Promise.all([
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
    ])
    const act = tools[tools.length - 1] ?? null

    const percent = f?.percent ?? 0
    const toCompact = f === null ? null : compactPercent(f.tokens, threshold)
    const elapsed = start === null || t === 0 ? null : duration(t - start)

    const showWork = e.props.isWorking || active.length > 0
    const five = ls.find(l => l.kind === 'five_hour')

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
        <Box>{cells(miniCells(percent), 'm')}</Box>
      ) : (
        <Box>{cells(trackCells(percent, WIDTH, WARN_AT), 'c')}</Box>
      )

    const fiveGroup =
      five === undefined ? null : (
        <Box key="five" gap={1} alignItems="center">
          <Text dimColor>5h</Text>
          <Box>{cells(dotCells(five.percent), 'd')}</Box>
          <Button key="open-usage" plain dimColor={five.percent < 50} label={`${five.percent}%`} onPress={() => openUsage($)} />
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
          <Text dimColor>Context</Text>
          {contextGauge('full')}
          <Button key="open-context" plain label={`${pctText(percent)}%`} onPress={() => openContext($)} />
          {f !== null ? (
            <Text dimColor>
              ({kilo(f.tokens)}/{kilo(f.window)})
            </Text>
          ) : null}
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
            <Text dimColor>Fable</Text>
            <Box>{cells(trackCells(l.percent, SMOOTH, null), `f${l.kind}`)}</Box>
            <Text dimColor={l.percent < 50} color={l.percent >= 80 ? 'error' : undefined}>
              {l.percent}%
            </Text>
          </Box>
        ))}
        {gitGroup(false)}
        {turnMs !== null || elapsed !== null ? (
          <Box gap={1}>
            {turnMs !== null ? <Text dimColor>last {turnLength(turnMs)}</Text> : null}
            {elapsed !== null ? <Text dimColor>session {elapsed}</Text> : null}
          </Box>
        ) : null}
        {workGroup}
        <Box flexGrow={1} />
        <Button key="hide" label="Hide" onPress={() => toggleHidden($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [b, f, threshold] = await Promise.all([read($, breakdown), read($, fill), read($, compactAt)])
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
          {kilo(used)} tokens{b !== null ? ` · ${modelName(b.model)}` : ''}
          {threshold !== null ? ` · auto-compacts at ${kilo(threshold)}` : ''}
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
        {section('In use', inUse, false, true)}
        {section('Room left', spare, true, true)}
        {section('Loaded when needed', later, true, false)}
        <Box gap={2} marginTop={1} flexWrap="wrap">
          <Button key="ctx-refresh" label="Refresh" onPress={() => refreshThreshold($).catch(() => {})} />
          <Button
            key="ctx-compact"
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
    const [ls, t, sound] = await Promise.all([read($, limits), read($, now), read($, soundOn)])
    const controls = (
      <Box gap={2} marginTop={1} flexWrap="wrap">
        <Button key="usage-refresh" label="Refresh" onPress={() => refreshUsage($).catch(() => {})} />
        <Button key="usage-sound" label={sound ? 'Sound: on' : 'Sound: off'} onPress={() => toggleSound($).catch(() => {})} />
        <Button key="usage-hide-bar" label="Hide the bar" onPress={() => toggleHidden($).catch(() => {})} />
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
          const pct = Math.min(100, Math.max(0, l.percent))
          return (
            <Box key={`u-${l.kind}`} flexDirection="column">
              <Text bold>{limitName(l.kind)}</Text>
              <Box justifyContent="space-between" alignItems="flex-end">
                <Box alignItems="flex-end" gap={1}>
                  <Text bold color={gradientAt(pct / 100)}>
                    {l.percent}%
                  </Text>
                  <Text dimColor>used</Text>
                </Box>
                <Text color={left !== null ? countdownColor(l.percent) : undefined} dimColor={left === null}>
                  {left !== null ? `resets in ${left}` : 'reset time not reported'}
                </Text>
              </Box>
              <Box height={1} width="100%">
                {pct > 0 ? <Box width={`${Math.max(1, Math.round(pct))}%`} height={1} backgroundColor={gradientAt(pct / 100)} /> : null}
                <Box flexGrow={1} height={1} backgroundColor="inactive" />
              </Box>
            </Box>
          )
        })}
        {ls.every(l => l.kind === 'five_hour') ? (
          <Text dimColor>
            Weekly limits, including Fable, appear here once Claude Code reports them.
          </Text>
        ) : null}
        {controls}
      </Box>
    )
  })
}
