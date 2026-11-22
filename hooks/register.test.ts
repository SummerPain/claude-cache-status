import { expect, test } from 'claude-code/testing'

import { summarize } from './register'

const line = (o: object) => JSON.stringify(o)
const reply = (timestamp: string, usage: object) =>
  line({ type: 'assistant', timestamp, message: { usage } })
const prompt = (timestamp: string) =>
  line({ type: 'user', timestamp, message: { content: 'hi' } })

const T0 = '2026-11-22T10:00:00.000Z'
const cold = {
  input_tokens: 10,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 90_000,
  cache_creation: { ephemeral_1h_input_tokens: 90_000, ephemeral_5m_input_tokens: 0 },
}
const warm = { input_tokens: 10, cache_read_input_tokens: 99_000, cache_creation_input_tokens: 990 }

test('a 1 h write is warm for an hour after the last reply', () => {
  const text = [prompt(T0), reply('2026-11-22T10:00:05.000Z', cold)].join('\n')
  const v = summarize(text, Date.parse('2026-11-22T10:20:05.000Z'))

  expect(v).toEqual({ minutesLeft: 40, ttlMinutes: 60, contextTokens: 90_010, lastHit: 0 })
})

test('after the TTL it is cold, and a later message that read cache shows its hit', () => {
  const text = [
    prompt(T0),
    reply('2026-11-22T10:00:05.000Z', cold),
    prompt('2026-11-22T10:30:00.000Z'),
    reply('2026-11-22T10:30:05.000Z', warm),
    line({ type: 'assistant', isSidechain: true, timestamp: '2026-11-22T10:59:00.000Z', message: { usage: cold } }),
    'not json',
  ].join('\n')
  const v = summarize(text, Date.parse('2026-11-22T11:40:05.000Z'))

  expect(v).toEqual({ minutesLeft: -10, ttlMinutes: 60, contextTokens: 100_000, lastHit: 99 })
})

test('no replies yet gives nothing to show', () => {
  expect(summarize(prompt(T0), Date.parse(T0))).toBe(null)
})
