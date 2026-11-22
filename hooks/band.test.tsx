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

test('a warm cache draws its parts on every surface', async ($, on) => {
  on('state.get', seed({ minutesLeft: 42, ttlMinutes: 60, contextTokens: 89_120, lastHit: 98 }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^Cache warm$/ }))?.text).toBe('Cache warm')
    expect((await ui.find({ type: 'Text', text: /^89k context$/ }))?.text).toBe('89k context')
    expect((await ui.find({ type: 'Text', text: /^98%$/ }))?.text).toBe('98%')
    await ui.unmount()
  }
})

test('a cold cache says what the next message rewrites', async ($, on) => {
  on('state.get', seed({ minutesLeft: -11, ttlMinutes: 60, contextTokens: 471_421, lastHit: null }))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Cache cold$/ }))?.text).toBe('Cache cold')
  expect((await ui.find({ type: 'Text', text: /^471k$/ }))?.text).toBe('471k')
  expect(await ui.find({ type: 'Text', text: /hit/ })).toBeUndefined()
  await ui.unmount()
})
