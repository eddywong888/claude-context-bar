import { expect, test } from 'claude-code/testing'

import { compactPercent, countdownColor, detailOf, dots, duration, gradientAt, gradientCells, hasReset, isFable, clearPassedResets, kilo, limitName, modelName, markedBar, maskSecrets, mini, parseGitStatus, pctText, resetIn, smoothBar, turnLength } from './register'

test('auto-compact share', () => {
  expect(compactPercent(85_000, 100_000)).toBe(85)
  expect(compactPercent(120_000, 100_000)).toBe(100)
  expect(compactPercent(50_000, null)).toBe(null)
})

test('session length', () => {
  expect(duration(12 * 60000)).toBe('12m')
  expect(duration(75 * 60000)).toBe('1h15m')
})

test('tool detail picks the first useful argument, trimmed', () => {
  expect(detailOf({ command: 'npm test\necho hi' })).toBe('npm test')
  expect(detailOf({ file_path: '/a/b.ts' })).toBe('/a/b.ts')
  expect(detailOf({ command: 'echo '.repeat(15) })?.length).toBe(40)
  expect(detailOf({})).toBe(undefined)
})

test('small moves on a 1M window stay visible', () => {
  expect(pctText(13.6)).toBe('13.6')
  expect(pctText(2.04)).toBe('2.0')
  expect(kilo(136_266)).toBe('136k')
  expect(kilo(1_000_000)).toBe('1M')
})

test('marked bar puts the marker at the compact point', () => {
  const segs = markedBar(50, 80)
  expect(segs.map(s => s.text).join('')).toBe('█'.repeat(10) + '░'.repeat(6) + '┃' + '░'.repeat(3))
  expect(segs.map(s => s.text).join('').length).toBe(20)
  expect(markedBar(50, 500).map(s => s.text).join('').length).toBe(20)
  expect(segs.find(s => s.kind === 'mark')?.text).toBe('┃')
  expect(markedBar(50, null).some(s => s.kind === 'mark')).toBe(false)
})

test('5h dots', () => {
  expect(dots(32)).toEqual({ on: '●●●●', off: '○○○○○○' })
  expect(dots(4).on).toBe('●')
  expect(dots(0).on).toBe('')
  expect(dots(100).off).toBe('')
})

test('smooth bar moves in eighth steps', () => {
  expect(smoothBar(0)).toEqual({ on: '', off: '··········' })
  expect(smoothBar(25)).toEqual({ on: '██▌', off: '·······' })
  expect(smoothBar(100)).toEqual({ on: '██████████', off: '' })
})

test('fable windows and turn length', () => {
  expect(isFable('seven_day_fable')).toBe(true)
  expect(isFable('seven_day')).toBe(false)
  expect(turnLength(42_000)).toBe('42s')
  expect(turnLength(125_000)).toBe('2m05s')
})

test('5h reset countdown', () => {
  const now = Date.parse('2026-10-20T10:00:00Z')
  expect(resetIn('2026-10-20T10:29:10Z', now)).toBe('30m')
  expect(resetIn('2026-10-20T12:05:00Z', now)).toBe('2h05m')
  expect(resetIn('2026-10-20T09:00:00Z', now)).toBe(null)
  expect(resetIn(undefined, now)).toBe(null)
  expect(resetIn('not a date', now)).toBe(null)
})

test('gradient runs green to amber to red', () => {
  expect(gradientAt(0)).toBe('#117a2e')
  expect(gradientAt(0.5)).toBe('#b36b00')
  expect(gradientAt(1)).toBe('#b31d28')
  expect(gradientAt(2)).toBe('#b31d28')
  const cells = gradientCells('███', 0, 10)
  expect(cells.length).toBe(3)
  expect(cells[0]?.color).toBe('#117a2e')
  expect(markedBar(100, null).filter(s => s.kind === 'fill').at(-1)?.color).toBe('#b31d28')
})

test('countdown colour follows the 5h usage', () => {
  expect(countdownColor(4)).toBe('suggestion')
  expect(countdownColor(60)).toBe('warning')
  expect(countdownColor(90)).toBe('error')
})

test('reset detection', () => {
  const now = Date.parse('2026-10-20T10:00:00Z')
  expect(hasReset('2026-10-20T09:59:00Z', now)).toBe(true)
  expect(hasReset('2026-10-20T10:30:00Z', now)).toBe(false)
  expect(hasReset(undefined, now)).toBe(false)
})

test('mini gauges light at least one cell for any usage', () => {
  expect(mini(24, '▰', '▱')).toEqual({ on: '▰▰', off: '▱▱▱' })
  expect(mini(4, '●', '○')).toEqual({ on: '●', off: '○○○○' })
  expect(mini(0, '●', '○').on).toBe('')
  expect(mini(100, '▰', '▱').off).toBe('')
})

test('git status parsing', () => {
  const out = [
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b src/a.ts',
    '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts',
    '? notes.md',
  ].join('\n')
  expect(parseGitStatus(out)).toEqual({ branch: 'main', changed: 3, ahead: 2, behind: 1 })
  expect(parseGitStatus('# branch.oid abc\n# branch.head feature/x\n')).toEqual({
    branch: 'feature/x',
    changed: 0,
    ahead: 0,
    behind: 0,
  })
  expect(parseGitStatus('# branch.head (detached)\n')?.branch).toBe('detached')
  expect(parseGitStatus('')).toBe(null)
})

test('secrets are masked in the working line', () => {
  expect(maskSecrets('curl -H "Authorization: Bearer sk-live-abcdef123456"')).not.toContain('abcdef123456')
  expect(maskSecrets('export API_KEY=supersecretvalue')).toBe('export API_KEY=••••')
  expect(maskSecrets('git push ghp_abcdefghijklmnop1234')).toBe('git push ••••')
  expect(maskSecrets('npm test')).toBe('npm test')
  expect(detailOf({ command: 'TOKEN=abc123 npm publish' })).toBe('TOKEN=•••• npm publish')
})

test('a passed 5h reset reads as an empty window', () => {
  const now = Date.parse('2026-10-20T10:00:00Z')
  const list = [
    { kind: 'five_hour', percent: 80, resetsAt: '2026-10-20T09:00:00Z' },
    { kind: 'seven_day', percent: 40, resetsAt: '2026-10-20T09:00:00Z' },
  ]
  expect(clearPassedResets(list, now).map(l => l.percent)).toEqual([0, 40])
  expect(clearPassedResets([{ kind: 'five_hour', percent: 80, resetsAt: '2026-10-20T11:00:00Z' }], now)[0]?.percent).toBe(80)
})

test('usage panel names and long countdowns', () => {
  expect(limitName('five_hour')).toBe('Current session (5h)')
  expect(limitName('seven_day_fable')).toBe('Fable (weekly)')
  expect(limitName('seven_day')).toBe('Weekly')
  const now = Date.parse('2026-10-20T10:00:00Z')
  expect(resetIn('2026-10-23T08:00:00Z', now)).toBe('2d 22h')
})

test('model ids read as names', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('custom-model')).toBe('custom-model')
})
