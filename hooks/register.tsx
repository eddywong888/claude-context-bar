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
const tickOwner = atom({ plugin: 'context-bar', key: 'tickOwner' } as const, null)

const CONTEXT_PANE = 'context-bar-context'
const USAGE_PANE = 'context-bar-usage'
const WIDTH = 20
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

export type Segment = { text: string; kind: 'fill' | 'empty' | 'mark'; color?: string }

/** The bar as runs of filled, empty and marker cells; the marker replaces the cell where auto-compaction runs. */
export const markedBar = (percent: number, markPercent: number | null): Segment[] => {
  const filled = Math.min(WIDTH, Math.round((percent / 100) * WIDTH))
  const mark =
    markPercent === null ? -1 : Math.min(WIDTH - 1, Math.max(0, Math.floor((markPercent / 100) * WIDTH)))
  const out: Segment[] = []
  const push = (kind: Segment['kind'], ch: string) => {
    const last = out[out.length - 1]
    if (last !== undefined && last.kind === kind && kind === 'empty') last.text += ch
    else out.push({ kind, text: ch })
  }
  for (let i = 0; i < WIDTH; i++) {
    if (i === mark) push('mark', '┃')
    else if (i < filled) out.push({ kind: 'fill', text: '█', color: gradientAt(i / (WIDTH - 1)) })
    else push('empty', '░')
  }
  return out
}

const DOTS = 10

/** Dots round up, so any usage above zero lights at least one. */
export const dots = (percent: number) => {
  const f = Math.min(DOTS, Math.max(0, Math.ceil((percent / 100) * DOTS)))
  return { on: '●'.repeat(f), off: '○'.repeat(DOTS - f) }
}

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const SMOOTH = 10

/** A bar in eighth-cell steps: the filled run and the empty rest. */
export const smoothBar = (percent: number) => {
  const units = Math.round((Math.min(100, Math.max(0, percent)) / 100) * SMOOTH * 8)
  const full = Math.floor(units / 8)
  const part = EIGHTHS[units % 8] ?? ''
  const used = full + (part === '' ? 0 : 1)
  return { on: '█'.repeat(full) + part, off: '·'.repeat(SMOOTH - used) }
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
  await $.ui.open({ id: CONTEXT_PANE, title: 'Context', focus: true })
  await refreshThreshold($).catch(() => {})
}

async function openUsage($: EngineInterface) {
  await $.ui.open({ id: USAGE_PANE, title: 'Usage', focus: true })
  await refreshUsage($).catch(() => {})
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
      ])
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
    const markAt = f === null || threshold === null || f.window <= 0 ? null : (threshold / f.window) * 100
    const elapsed = start === null || t === 0 ? null : duration(t - start)

    const showWork = e.props.isWorking || active.length > 0
    const five = ls.find(l => l.kind === 'five_hour')

    if (hidden) {
      const ctx = mini(percent, '▰', '▱')
      const fiveDots = five === undefined ? null : mini(five.percent, '●', '○')
      const fiveReset = five === undefined ? null : resetIn(five.resetsAt, t)
      return (
        <Box flexWrap="wrap">
          {gradientCells(ctx.on, 0, MINI).map((c, i) => (
            <Text key={`m${i}`} color={c.color} bold>
              {c.ch}
            </Text>
          ))}
          <Text dimColor>{ctx.off}</Text>
          <Text> </Text>
          <Button key="open-context" plain label={`${Math.round(percent)}%`} onPress={() => openContext($)} />
          {five !== undefined && fiveDots !== null ? (
            <Box>
              <Text dimColor> · 5h </Text>
              {gradientCells(fiveDots.on, 0, MINI).map((c, i) => (
                <Text key={`n${i}`} color={c.color} bold>
                  {c.ch}
                </Text>
              ))}
              <Text dimColor>{fiveDots.off}</Text>
              <Text> </Text>
              <Button
                key="open-usage"
                plain
                label={`${five.percent}%${fiveReset !== null ? ` ↻${fiveReset}` : ''}`}
                onPress={() => openUsage($)}
              />
            </Box>
          ) : null}
          {repo !== null ? (
            <Text>
              <Text dimColor> · </Text>
              <Text color="suggestion">⎇ {repo.branch}</Text>
              {repo.changed > 0 ? <Text color="warning" bold>*</Text> : null}
            </Text>
          ) : null}
          {e.props.isWorking ? (
            <Text color="claude">
              {'  '}▶ {act === null ? 'thinking…' : act.tool}
              {act?.detail !== undefined ? <Text dimColor> {act.detail}</Text> : null}
            </Text>
          ) : null}
          {active.length > 0 ? (
            <Text color="suggestion">
              {'  '}⧉ {active.length}
            </Text>
          ) : null}
          <Text> </Text>
          <Button key="show" label="Show" onPress={() => toggleHidden($)} />
        </Box>
      )
    }

    return (
      <Box flexWrap="wrap">
        <Text dimColor>Context </Text>
        {markedBar(percent, markAt).map((seg, i) => (
          <Text
            key={`seg${i}`}
            color={seg.kind === 'mark' ? 'warning' : seg.color}
            bold={seg.kind !== 'empty'}
            dimColor={seg.kind === 'empty'}
          >
            {seg.text}
          </Text>
        ))}
        <Text> </Text>
        <Button
          key="open-context"
          plain
          label={`${pctText(percent)}%${f !== null ? ` (${kilo(f.tokens)}/${kilo(f.window)})` : ''}`}
          onPress={() => openContext($)}
        />
        {toCompact !== null && toCompact >= COMPACT_WARN ? (
          <Text color="warning"> ⚠ auto-compact {toCompact}%</Text>
        ) : null}
        {toCompact === null && percent >= 90 ? <Text color="error"> ⚠ nearly full, /compact</Text> : null}
        {ls
          .filter(l => l.kind === 'five_hour')
          .map(l => (
            <Box key={l.kind}>
              <Text dimColor> · 5h </Text>
              {gradientCells(dots(l.percent).on, 0, DOTS).map((c, i) => (
                <Text key={`d${i}`} color={c.color} bold>
                  {c.ch}
                </Text>
              ))}
              <Text dimColor>{dots(l.percent).off}</Text>
              <Text> </Text>
              <Button
                key="open-usage"
                plain
                label={`${l.percent}%${resetIn(l.resetsAt, t) !== null ? ` ↻ ${resetIn(l.resetsAt, t)}` : ''}`}
                onPress={() => openUsage($)}
              />
            </Box>
          ))}
        {ls
          .filter(l => isFable(l.kind))
          .map(l => (
            <Text key={l.kind}>
              <Text dimColor> · Fable </Text>
              {gradientCells(smoothBar(l.percent).on, 0, SMOOTH).map((c, i) => (
                <Text key={`f${i}`} color={c.color} bold>
                  {c.ch}
                </Text>
              ))}
              <Text dimColor>{smoothBar(l.percent).off}</Text>
              <Text color={l.percent >= 80 ? 'error' : undefined} dimColor={l.percent < 80}> {l.percent}%</Text>
            </Text>
          ))}
        {repo !== null ? (
          <Text>
            <Text dimColor> · </Text>
            <Text color="suggestion" bold>
              ⎇ {repo.branch}
            </Text>
            {repo.changed > 0 ? (
              <Text color="warning" bold>
                {' '}✎{repo.changed}
              </Text>
            ) : null}
            {repo.ahead > 0 ? <Text dimColor> ↑{repo.ahead}</Text> : null}
            {repo.behind > 0 ? <Text dimColor> ↓{repo.behind}</Text> : null}
          </Text>
        ) : null}
        {turnMs !== null ? <Text dimColor> · last {turnLength(turnMs)}</Text> : null}
        {elapsed !== null ? <Text dimColor>{turnMs !== null ? ' / ' : ' · '}session {elapsed}</Text> : null}
        <Text> </Text>
        <Button key="hide" label="Hide" onPress={() => toggleHidden($)} />
        {showWork ? (
          <Box>
            {e.props.isWorking ? (
              <Text color="claude">
                {'  '}▶ {act === null ? 'thinking…' : act.tool}
                {act?.detail !== undefined ? <Text dimColor> {act.detail}</Text> : null}
              </Text>
            ) : null}
            {active.length > 0 ? (
              <Text color="suggestion">
                {'  '}⧉ {active.length} agent{active.length > 1 ? 's' : ''}: {active.slice(0, 3).join(', ')}
                {active.length > 3 ? '…' : ''}
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [b, f, threshold] = await Promise.all([read($, breakdown), read($, fill), read($, compactAt)])
    if (b === null) return <Text dimColor>Reading the context breakdown…</Text>
    const max = f?.window ?? b.max
    const used = f?.tokens ?? b.total
    const live = b.rows.filter(r => !r.isDeferred && r.tokens > 0)
    const deferred = b.rows.filter(r => r.isDeferred && r.tokens > 0)
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{pctText((used / Math.max(1, max)) * 100)}% used </Text>
          <Text dimColor>
            {kilo(used)} / {kilo(max)} · {b.model}
          </Text>
        </Box>
        {threshold !== null ? <Text dimColor>Auto-compacts at {kilo(threshold)}</Text> : null}
        <Text> </Text>
        {live.map(r => (
          <Box key={`r-${r.name}`}>
            <Text color={r.color}>■ </Text>
            <Text>{r.name.padEnd(28)}</Text>
            <Text dimColor>{kilo(r.tokens).padStart(6)} </Text>
            <Text>{pctText((r.tokens / Math.max(1, b.max)) * 100).padStart(5)}%</Text>
          </Box>
        ))}
        {deferred.length > 0 ? <Text> </Text> : null}
        {deferred.map(r => (
          <Box key={`d-${r.name}`}>
            <Text dimColor>□ {r.name.padEnd(28)}</Text>
            <Text dimColor>{kilo(r.tokens).padStart(6)}  —</Text>
          </Box>
        ))}
        <Text> </Text>
        <Button key="close-context" role="dismiss" label="Close" onPress={() => $.ui.close({ id: CONTEXT_PANE })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: USAGE_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [ls, t] = await Promise.all([read($, limits), read($, now)])
    return (
      <Box flexDirection="column">
        {ls.length === 0 ? <Text dimColor>No usage reading yet: it arrives with Claude's next reply.</Text> : null}
        {ls.map(l => {
          const bar = smoothBar(l.percent)
          const left = resetIn(l.resetsAt, t)
          return (
            <Box key={`u-${l.kind}`} flexDirection="column">
              <Text bold>{limitName(l.kind)}</Text>
              <Box>
                {gradientCells(bar.on, 0, SMOOTH).map((c, i) => (
                  <Text key={`c${i}`} color={c.color} bold>
                    {c.ch}
                  </Text>
                ))}
                <Text dimColor>{bar.off}</Text>
                <Text bold> {l.percent}% used</Text>
              </Box>
              <Text color={countdownColor(l.percent)}>{left !== null ? `Resets in ${left}` : 'Reset time unknown'}</Text>
              <Text> </Text>
            </Box>
          )
        })}
        <Text dimColor>Weekly and Fable limits show here when Claude Code reports them.</Text>
        <Text> </Text>
        <Button key="close-usage" role="dismiss" label="Close" onPress={() => $.ui.close({ id: USAGE_PANE })} />
      </Box>
    )
  })
}
