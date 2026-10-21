import { expect, mock, test } from 'claude-code/testing'

const PROPS = { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 160 } as never

test('band redraws after a tool call and shows the working line', async ($, on) => {
  mock.clock(on)
  let tokens = 20_000
  let reported = [{ kind: 'five_hour', percentUsed: 4 }]
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
      rateLimits: reported,
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  let during = ''
  let text = async () => ''
  on('tool.call', async () => {
    during = await text()
    return { result: 'ok' } as never
  })
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  text = async () => [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(t => t.text || String(t.props.label ?? '')).join('|')

  tokens = 100_000
  await $.tool.call({ tool: 'Bash', command: 'echo hi' } as never)
  expect(during).toContain('▶ Bash')
  expect(during).toContain('echo hi')
  const after = await text()
  expect(after).toContain('50%')
  expect(after).toContain('●')
  expect(after).not.toMatch(/\d{4,}h/)

  // A later response with no rate-limit reading keeps the last 5h figure.
  reported = []
  await $.tool.call({ tool: 'Bash', command: 'echo again' } as never)
  expect(await text()).toContain('4%')
  await ui.unmount()
})

test('parallel tool calls keep the indicator until the last one ends', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 1, window: 200_000, percent: 0 }, rateLimits: [] },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  on('tool.call', async (_$, e) => {
    if ((e as { tool: string }).tool === 'Bash') await gate
    return { result: 'ok' } as never
  })
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const text = async () => [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(t => t.text || String(t.props.label ?? '')).join('|')

  const slow = $.tool.call({ tool: 'Bash', command: 'sleep 1', tool_use_id: 'a' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/x', tool_use_id: 'b' } as never)
  expect(await text()).toContain('▶ Bash')
  release()
  await slow
  await ui.unmount()
})

test('hide collapses the band and show brings it back', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 50_000, window: 200_000, percent: 25 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  const ui = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 160 } as never,
  })
  const text = async () => [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(t => t.text || String(t.props.label ?? '')).join('|')
  await $.tool.call({ tool: 'Bash', command: 'x' } as never)
  expect(await text()).toContain('█')

  await ui.press({ key: 'hide' })
  const collapsed = await text()
  expect(collapsed).not.toContain('Context')
  expect(collapsed).toContain('▰')
  expect(collapsed).not.toContain('█')
  expect(collapsed).toContain('25%')
  expect(collapsed).toContain('12%')

  await ui.press({ key: 'show' })
  expect(await text()).toContain('█')
  await ui.unmount()
})

test('clicking the numbers opens the context and usage panels', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 205_000,
        window: 1_000_000,
        percent: 21,
        breakdown: {
          categories: [{ name: 'Messages', tokens: 143_600, color: 'claude', isDeferred: false, kind: 'used' }],
          totalTokens: 205_000,
          maxTokens: 1_000_000,
          rawMaxTokens: 1_000_000,
          autocompactSource: 'auto',
          percentage: 21,
          gridRows: [],
          model: 'claude-opus-5-5',
          memoryFiles: [],
          mcpTools: [],
          agents: [],
          isAutoCompactEnabled: true,
          autoCompactThreshold: 967_000,
        },
      },
      rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('ui.open', (_$, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  const ui = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 160 } as never,
  })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  await ui.press({ key: 'open-context' })
  await ui.press({ key: 'open-usage' })
  expect(opened).toEqual(['context-bar-context', 'context-bar-usage'])

  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = await $.ui.mount({
      plugin: 'context-bar',
      surface,
      component: 'Pane',
      requestId: 'context-bar-context',
      props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
    })
    const paneText = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('|')
    expect(paneText).toContain('Messages')
    expect(paneText).toContain('auto-compacts at 967k')
    expect(paneText).toContain('Opus 5.5')
    expect(paneText).toContain('Tools: ')
    await pane.unmount()
  }
  await ui.unmount()
})

test('usage pane lists each limit, and says when there is none', async ($, on) => {
  mock.clock(on)
  let reported: unknown[] = []
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 1, window: 200_000, percent: 0 }, rateLimits: reported },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  const PANE = {
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-usage',
    props: { title: 'Usage', isFocused: true, bodyColumns: 80, placement: 'dock' },
  } as const
  const read = async (pane: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
    (await pane.findAll({ type: 'Text' })).map(t => t.text).join('|')

  const empty = await $.ui.mount(PANE as never)
  expect(await read(empty)).toContain('Your usage appears')
  await empty.unmount()

  reported = [
    { kind: 'five_hour', percentUsed: 30 },
    { kind: 'seven_day_fable', percentUsed: 65 },
  ]
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const full = await $.ui.mount({ ...PANE, surface } as never)
    const text = await read(full)
    expect(text).toContain('Current session (5h)')
    expect(text).toContain('Fable (weekly)')
    expect(text).toContain('65%')
    expect(text).not.toContain('appear here once Claude Code reports them')
    await full.unmount()
  }
})

test('a panel that cannot be placed falls back to a toast', async ($, on) => {
  mock.clock(on)
  const toasts: string[] = []
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 50_000, window: 200_000, percent: 25 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: string }).text ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
  const ui = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 160 } as never,
  })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  await ui.press({ key: 'open-context' })
  await ui.press({ key: 'open-usage' })
  expect(toasts.join(' ')).toContain('Context 25% (50k/200k)')
  expect(toasts.join(' ')).toContain('5h limit 30% used')
  await ui.unmount()
})

test('a finished answer rings done.wav; the usage panel toggles it off', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const played: string[] = []
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 1, window: 200_000, percent: 0 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 10 }],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('audio.play', (_$, e) => {
    played.push(String((e as { clip?: { asset?: string } }).clip?.asset))
    return { value: undefined } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)

  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-usage',
    props: { title: 'Usage', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })

  await $.turn.complete({ reason: 'answer', answer: 'done', turnId: 't1' } as never)
  expect(played).toEqual(['sounds/done.wav'])


  await pane.press({ key: 'usage-sound' })
  await $.turn.complete({ reason: 'answer', answer: 'done', turnId: 't2' } as never)
  expect(played.length).toBe(1)

  // An interrupted turn stays silent even with the sound on.
  await pane.press({ key: 'usage-sound' })
  played.length = 0
  await $.turn.complete({ reason: 'aborted', turnId: 't3' } as never)
  expect(played).toEqual([])
  await pane.unmount()
})

test('early compaction compacts at 90% of the way to the threshold', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let tokens = 100_000
  let compacted = 0
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: {
        tokens,
        window: 1_000_000,
        percent: Math.round((tokens / 1_000_000) * 100),
        breakdown: (e as { breakdown?: string }).breakdown !== undefined
          ? {
              categories: [], totalTokens: tokens, maxTokens: 1_000_000, rawMaxTokens: 1_000_000,
              autocompactSource: 'auto', percentage: 10, gridRows: [], model: 'claude-fable-5',
              memoryFiles: [], mcpTools: [], agents: [],
              isAutoCompactEnabled: true, autoCompactThreshold: 500_000,
            }
          : undefined,
      },
      rateLimits: [],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.compact', () => {
    compacted += 1
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never
  })

  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-context',
    props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await pane.press({ key: 'ctx-refresh' }) // pull the breakdown in, so the full panel draws
  await pane.press({ key: 'ctx-early' }) // turn early compaction on

  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1' } as never)
  expect(compacted).toBe(0) // 100k of 500k: far from the line

  tokens = 460_000 // 92% of the way to the 500k threshold
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't2' } as never)
  expect(compacted).toBe(1)
  await pane.unmount()
})

test('/contextbar flips the sound with sloppy spacing; unknown args say so', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 1, window: 200_000, percent: 0 }, rateLimits: [] },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  const off = await $.command.run({ command: 'contextbar', args: '  Sound   OFF ' } as never)
  expect(off.text).toBe('Completion sound off.')
  const huh = await $.command.run({ command: 'contextbar', args: 'louder' } as never)
  expect(huh.text).toContain('understand')
  const status = await $.command.run({ command: 'contextbar', args: '' } as never)
  expect(status.text).toContain('sound off')
})

test('the bar grows a Compact button once 70% of the way to auto-compact', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let tokens = 100_000
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: {
        tokens,
        window: 1_000_000,
        percent: Math.round((tokens / 1_000_000) * 100),
        breakdown: (e as { breakdown?: string }).breakdown !== undefined
          ? {
              categories: [], totalTokens: tokens, maxTokens: 1_000_000, rawMaxTokens: 1_000_000,
              autocompactSource: 'auto', percentage: 10, gridRows: [], model: 'claude-fable-5',
              memoryFiles: [], mcpTools: [], agents: [],
              isAutoCompactEnabled: true, autoCompactThreshold: 500_000,
            }
          : undefined,
      },
      rateLimits: [],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)

  const ui = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 200 } as never,
  })
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'a' } as never)
  expect(await ui.find({ key: 'bar-compact' })).toBe(undefined) // 100k of 500k: 20%

  tokens = 400_000 // 80% of the way to the threshold
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'b' } as never)
  expect(await ui.find({ key: 'bar-compact' })).toBeDefined()
  await ui.unmount()
})
