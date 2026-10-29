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
    expect(text).toContain('Pace appears after a few minutes')
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
  const clock = mock.clock(on)
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
  on('command.run', { command: 'compact' }, () => {
    compacted += 1
    return { text: '' } as never
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
  await clock.advance(600) // early compaction starts just after the turn
  expect(compacted).toBe(1)
  // The mock compaction left the context nearly full, so early compaction stays off.
  expect((await pane.find({ key: 'ctx-early' }))?.props.label).toContain(': off')
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

test('the skin picker sets a palette and /contextbar theme sets one', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 100_000, window: 200_000, percent: 50 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)

  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-usage',
    props: { title: 'Usage', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  expect((await pane.find({ key: 'usage-skin-meadow' }))?.props.label).toBe('✓ meadow')
  expect((await pane.findAll({ type: 'Button' })).filter(b => String(b.props.key ?? '').startsWith('usage-skin-')).length).toBe(10)
  await pane.press({ key: 'usage-skin-ocean' })
  expect((await pane.find({ key: 'usage-skin-ocean' }))?.props.label).toBe('✓ ocean')
  expect((await pane.find({ key: 'usage-skin-meadow' }))?.props.label).toBe('meadow')

  const band = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 200 } as never,
  })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  const fills = (await band.findAll({ type: 'Text' })).map(x => x.props.color)
  expect(fills).toContain('#0e7490') // the band draws in ocean now

  await pane.press({ key: 'usage-skin-hermes' })
  expect((await pane.find({ key: 'usage-skin-hermes' }))?.props.label).toBe('✓ hermes') // the panel redraws in its border and backdrop
  expect((await pane.findAll({ type: 'Box' })).some(x => x.props.borderStyle === 'single' && x.props.backgroundColor === '#0c1a10')).toBe(true)
  const boxes = (await band.findAll({ type: 'Box' })).map(x => x.props.backgroundColor)
  expect(boxes).toContain('#0c1a10') // the band takes the skin's backdrop
  expect((await band.findAll({ type: 'Text' })).map(x => x.props.color)).toContain('#8cc79a') // faint text in the skin's ink

  const set = await $.command.run({ command: 'contextbar', args: 'theme ember' } as never)
  expect(set.text).toBe('Theme: ember.')
  const bad = await $.command.run({ command: 'contextbar', args: 'theme neon' } as never)
  expect(bad.text).toContain('No theme called')
  await band.unmount()
  await pane.unmount()
})

test('after a compaction the panel shows the fresh figures', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let tokens = 723_000
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
              isAutoCompactEnabled: true, autoCompactThreshold: 967_000,
            }
          : undefined,
      },
      rateLimits: [],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.compact', () => {
    tokens = 80_000 // the summary the conversation shrinks to
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never
  })

  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-context',
    props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  const text = async () => (await pane.findAll({ type: 'Text' })).map(x => x.text).join('|')
  expect(await text()).toContain('72.3%')

  await $.session.compact({ messages: [{ role: 'user', text: 'old', toolUses: [] }] } as never)
  expect(await text()).toContain('8.0%')
  await pane.unmount()
})

test('a compaction that helps keeps early compaction on: the hook refreshed the figures', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  let tokens = 460_000
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
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.run', { command: 'compact' }, () => {
    tokens = 60_000
    return { text: '' } as never
  })
  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-context',
    props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await pane.press({ key: 'ctx-refresh' })
  await pane.press({ key: 'ctx-early' })
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1' } as never)
  await clock.advance(600)
  // Only the hook refreshed after the mod's own compaction; it saw the drop, so the toggle stays on.
  expect((await pane.find({ key: 'ctx-early' }))?.props.label).toContain(': on')
  await pane.unmount()
})

test('Compact now runs /compact, which works in a desktop session', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const ran: string[] = []
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 700_000,
        window: 1_000_000,
        percent: 70,
        breakdown: (e as { breakdown?: string }).breakdown !== undefined
          ? {
              categories: [], totalTokens: 700_000, maxTokens: 1_000_000, rawMaxTokens: 1_000_000,
              autocompactSource: 'auto', percentage: 70, gridRows: [], model: 'claude-opus-5-5',
              memoryFiles: [], mcpTools: [], agents: [],
              isAutoCompactEnabled: true, autoCompactThreshold: 967_000,
            }
          : undefined,
      },
      rateLimits: [],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.run', { command: 'compact' }, (_$, e) => {
    ran.push((e as { command: string }).command)
    return { text: '' } as never
  })
  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-context',
    props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await pane.press({ key: 'ctx-refresh' })
  await pane.press({ key: 'ctx-compact' })
  expect(ran).toEqual(['compact'])
  await pane.unmount()
})

function earlySetup(
  on: Parameters<Parameters<typeof test>[1]>[1],
  state: { tokens: number; compacted: number },
  toasts: string[] = [],
) {
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: {
        tokens: state.tokens,
        window: 1_000_000,
        percent: Math.round((state.tokens / 1_000_000) * 100),
        breakdown: (e as { breakdown?: string }).breakdown !== undefined
          ? {
              categories: [], totalTokens: state.tokens, maxTokens: 1_000_000, rawMaxTokens: 1_000_000,
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
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId?: string }).turnId ?? 't' }) as never)
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined } as never
  })
  on('command.run', { command: 'compact' }, () => {
    state.compacted += 1
    state.tokens = 60_000
    return { text: '' } as never
  })
}

test('two turns ending inside the delay compact once', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const state = { tokens: 460_000, compacted: 0 }
  earlySetup(on, state)
  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-context',
    props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await pane.press({ key: 'ctx-refresh' })
  await pane.press({ key: 'ctx-early' })
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't2' } as never)
  await clock.advance(600)
  await clock.advance(600)
  expect(state.compacted).toBe(1)
  await pane.unmount()
})

test('a turn begun during the delay puts early compaction off to its end', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const state = { tokens: 460_000, compacted: 0 }
  earlySetup(on, state)
  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-context',
    props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await pane.press({ key: 'ctx-refresh' })
  await pane.press({ key: 'ctx-early' })
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1' } as never)
  await $.turn.start({ text: 'next', turnId: 't2' } as never)
  await clock.advance(600)
  expect(state.compacted).toBe(0) // /compact would have queued behind the new turn
  expect((await pane.find({ key: 'ctx-early' }))?.props.label).toContain(': on')
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't2' } as never)
  await clock.advance(600)
  expect(state.compacted).toBe(1)
  await pane.unmount()
})

test('Compact now while Claude works says it is queued', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const state = { tokens: 460_000, compacted: 0 }
  const toasts: string[] = []
  earlySetup(on, state, toasts)
  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-context',
    props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await pane.press({ key: 'ctx-refresh' })
  await $.turn.start({ text: 'work', turnId: 't1' } as never)
  await pane.press({ key: 'ctx-compact' })
  expect(state.compacted).toBe(1)
  expect(toasts.join('|')).toContain('queued')
  expect(toasts.join('|')).not.toContain('Compacted')
  await pane.unmount()
})

test('italic-label skins draw the band', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 100_000, window: 200_000, percent: 50 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }] },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  for (const skin of ['latte', 'sumi', 'cyberpunk']) {
    await $.command.run({ command: 'contextbar', args: `theme ${skin}` } as never)
    const band = await $.ui.mount({
      plugin: 'context-bar',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 200 } as never,
    })
    await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
    expect((await band.findAll({ type: 'Text' })).some(x => x.props.italic === true)).toBe(true)
    await band.unmount()
  }
})

test('a typed /compact redraws from the breakdown, marked ~, until the next reply', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let compacted = false
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 677_000, // the last reply's figure: stale after the compaction
        window: 1_000_000,
        percent: 68,
        breakdown: (e as { breakdown?: string }).breakdown !== undefined
          ? {
              categories: [], totalTokens: compacted ? 124_000 : 677_000, maxTokens: 1_000_000, rawMaxTokens: 1_000_000,
              autocompactSource: 'auto', percentage: 12, gridRows: [], model: 'claude-fable-5',
              memoryFiles: [], mcpTools: [], agents: [],
              isAutoCompactEnabled: true, autoCompactThreshold: 967_000,
            }
          : undefined,
      },
      rateLimits: [],
    },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId?: string }).turnId ?? 't' }) as never)
  on('command.run', { command: 'compact' }, () => {
    compacted = true
    return { text: '' } as never
  })
  const band = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 200 } as never,
  })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  expect((await band.find({ key: 'open-context' }))?.props.label).toBe('67.7%')
  await $.command.run({ command: 'compact', args: '' } as never)
  expect((await band.find({ key: 'open-context' }))?.props.label).toBe('~12.4%')
  await $.turn.start({ text: 'next', turnId: 't2' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/y' } as never)
  expect((await band.find({ key: 'open-context' }))?.props.label).toBe('67.7%') // the reply's own figure again
  await band.unmount()
})

test('the band shows the folder, and the group the user ties it to', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 50_000, window: 200_000, percent: 25 }, rateLimits: [] },
  }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('process.run', (_$, e) =>
    ({
      value: (e as { argv: string[] }).argv?.[0] === 'pwd'
        ? { exitCode: 0, stdout: '/Users/me/Codex/sites\n', stderr: '' }
        : { exitCode: 1, stdout: '', stderr: '' },
    }) as never,
  )
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const text = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('|')

  const before = await $.command.run({ command: 'contextbar', args: 'group' } as never)
  expect(JSON.stringify(before)).toContain('/Users/me/Codex/sites')
  expect(JSON.stringify(before)).toContain('Group: none')
  expect(await text()).toContain('📁')
  expect(await text()).toContain('sites')

  await $.command.run({ command: 'contextbar', args: 'group 🟦 Sites / Ops' } as never)
  expect(await text()).toContain('🟦')
  const after = await $.command.run({ command: 'contextbar', args: 'group' } as never)
  expect(JSON.stringify(after)).toContain('🟦 Sites / Ops')

  await $.command.run({ command: 'contextbar', args: 'group off' } as never)
  expect(await text()).not.toContain('🟦')
  await ui.unmount()
})
