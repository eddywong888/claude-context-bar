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
  expect(collapsed).not.toContain('█')
  expect(collapsed).toContain('▰')
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

  const pane = await $.ui.mount({
    plugin: 'context-bar',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'context-bar-context',
    props: { title: 'Context', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  const paneText = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('|')
  expect(paneText).toContain('Messages')
  expect(paneText).toContain('Auto-compacts at 967k')
  await pane.unmount()
  await ui.unmount()
})
