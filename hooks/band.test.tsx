import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'cache-status',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const seed = (value: object) => () => ({ value: { value, version: 1 } })

test('a warm cache lights a segment per 5 min left, on every surface', async ($, on) => {
  on('state.get', seed({ minutesLeft: 42, ttlMinutes: 60, contextTokens: 89_120, lastHit: 98 }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // 42 of 60 minutes: 9 of 12 segments lit, green.
    expect((await ui.find({ type: 'Text', text: /^▮{9}$/ }))?.props).toMatchObject({ color: 'success' })
    expect((await ui.find({ type: 'Text', text: /^▮{3}$/ }))?.props).toMatchObject({ color: 'subtle' })
    expect((await ui.find({ type: 'Text', text: /^42 min$/ }))?.props).toMatchObject({ color: 'success' })
    expect((await ui.find({ type: 'Text', text: /^89k context$/ }))?.text).toBe('89k context')
    expect((await ui.find({ type: 'Text', text: /^98%$/ }))?.text).toBe('98%')
    await ui.unmount()
  }
})

test('the last minutes turn amber, then red', async ($, on) => {
  let left = 12
  on('state.get', () => ({ value: { value: { minutesLeft: left, ttlMinutes: 60, contextTokens: 1000, lastHit: null }, version: 1 } }))

  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^▮{3}$/ }))?.props).toMatchObject({ color: 'warning' })
  await ui.unmount()

  left = 4
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^▮$/ }))?.props).toMatchObject({ color: 'error' })
  await ui.unmount()
})

test('a cold cache lights nothing and says what the next message rewrites', async ($, on) => {
  on('state.get', seed({ minutesLeft: -11, ttlMinutes: 60, contextTokens: 471_421, lastHit: 98 }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // The outer Text holds the same twelve glyphs, so look for the grey run among all matches.
  const runs = await ui.findAll({ type: 'Text', text: /^▮{12}$/ })
  expect(runs.map(r => r.props.color)).toContain('subtle')
  expect((await ui.find({ type: 'Text', text: /^Cold 11 min$/ }))?.text).toBe('Cold 11 min')
  expect((await ui.find({ type: 'Text', text: /^471k$/ }))?.text).toBe('471k')
  expect(await ui.find({ type: 'Text', text: /hit/ })).toBeUndefined()
  await ui.unmount()
})
