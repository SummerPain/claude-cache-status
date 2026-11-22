import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CacheView } from '../types'

const view = atom({ plugin: 'cache-status', key: 'view' } as const, null)

const TICK_MS = 30_000
// shortcut: reads only the transcript's tail; a single entry larger than this hides older replies, raise it if that shows up.
const TAIL_BYTES = 512 * 1024

type Usage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

const contextOf = (u: Usage) =>
  (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)

const isUserPrompt = (e: any) => {
  if (e.type !== 'user' || e.isMeta) return false
  const content = e.message?.content
  if (typeof content === 'string') return true
  return Array.isArray(content) && !content.some((c: any) => c?.type === 'tool_result')
}

/** Reads transcript lines (JSONL) and says how the main thread's prompt cache stands at `nowMs`. */
export function summarize(text: string, nowMs: number): CacheView | null {
  const replies: { at: number; usage: Usage }[] = []
  const prompts: number[] = []
  for (const line of text.split('\n')) {
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (!e || e.isSidechain || !e.timestamp) continue
    const at = Date.parse(e.timestamp)
    const usage = e.type === 'assistant' ? e.message?.usage : undefined
    if (usage) replies.push({ at, usage })
    else if (isUserPrompt(e)) prompts.push(at)
  }
  const last = replies.at(-1)
  if (!last) return null

  // The newest reply that wrote cache says which lifetime this session uses.
  let ttlMinutes = 5
  for (const { usage } of [...replies].reverse()) {
    const cc = usage.cache_creation ?? {}
    if (cc.ephemeral_1h_input_tokens) { ttlMinutes = 60; break }
    if (cc.ephemeral_5m_input_tokens) { ttlMinutes = 5; break }
  }

  const prompt = prompts.at(-1)
  const firstAfter = prompt === undefined ? undefined : replies.find(r => r.at >= prompt)
  const total = firstAfter ? contextOf(firstAfter.usage) : 0

  return {
    minutesLeft: Math.floor((last.at + ttlMinutes * 60_000 - nowMs) / 60_000),
    ttlMinutes,
    contextTokens: contextOf(last.usage),
    lastHit: firstAfter && total ? Math.round((100 * (firstAfter.usage.cache_read_input_tokens ?? 0)) / total) : null,
  }
}

const kTokens = (n: number) => `${Math.round(n / 1000)}k`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { transcriptPath } = await $.session.info()
    if (!transcriptPath) return result

    const refresh = async () => {
      try {
        const { size } = await $.fs.stat(transcriptPath)
        const offset = Math.max(0, size - TAIL_BYTES)
        let text = (await $.fs.read(transcriptPath, { offset })) as string
        if (offset > 0) text = text.slice(text.indexOf('\n') + 1)
        const fresh = summarize(text, await $.clock.now())
        await update($, view, () => fresh)
      } catch {
        // No transcript yet: keep the row as it was.
      }
    }

    await refresh()
    $.clock.every(TICK_MS, refresh)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || v === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const dot = <Text dimColor> · </Text>
    const isWarm = v.minutesLeft >= 0

    // Battery segments (pick page "Cache row look", take 3): one per 5 min of a 1 h TTL, one per minute of a 5 min TTL.
    // Green above a quarter of the TTL left, amber above a twelfth, red below.
    const segments = v.ttlMinutes >= 60 ? 12 : v.ttlMinutes
    const lit = isWarm ? Math.ceil((v.minutesLeft * segments) / v.ttlMinutes - 1e-9) : 0
    const share = v.minutesLeft / v.ttlMinutes
    const color = share > 1 / 4 ? 'success' : share > 1 / 12 ? 'warning' : 'error'

    const parts = isWarm
      ? [
          <Text color={color} weight="bold">{v.minutesLeft} min</Text>,
          <Text dimColor> until cold</Text>,
          dot,
          <Text color="suggestion">{kTokens(v.contextTokens)} context</Text>,
        ]
      : [
          <Text color="error" weight="bold">Cold {-v.minutesLeft} min</Text>,
          dot,
          <Text dimColor>next message rewrites </Text>,
          <Text color="warning" weight="bold">{kTokens(v.contextTokens)}</Text>,
        ]
    if (isWarm && v.lastHit !== null) {
      parts.push(
        dot,
        <Text dimColor>hit </Text>,
        <Text color={v.lastHit >= 50 ? 'success' : 'error'}>{v.lastHit}%</Text>,
      )
    }

    return (
      <Box flexDirection="row" gap={1}>
        <Text>
          {lit > 0 && <Text color={color}>{'▮'.repeat(lit)}</Text>}
          {lit < segments && <Text color="subtle">{'▮'.repeat(segments - lit)}</Text>}
        </Text>
        <Text>{...parts}</Text>
      </Box>
    )
  })
}
