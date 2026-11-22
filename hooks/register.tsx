import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CacheView } from '../types'

const view = atom({ plugin: 'cache-status', key: 'view' } as const, null)

const TICK_MS = 30_000
const BAR_CELLS = 20
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
    const parts =
      v.minutesLeft >= 0
        ? [
            <Text color="success" weight="bold">Cache warm</Text>,
            dot,
            'cools in ',
            <Text color={v.minutesLeft <= 5 ? 'warning' : 'text'} weight="bold">{v.minutesLeft} min</Text>,
            <Text dimColor> ({v.ttlMinutes} min TTL)</Text>,
            dot,
            <Text color="suggestion">{kTokens(v.contextTokens)} context</Text>,
          ]
        : [
            <Text color="error" weight="bold">Cache cold</Text>,
            <Text dimColor> for {-v.minutesLeft} min</Text>,
            dot,
            'next message rewrites ',
            <Text color="warning" weight="bold">{kTokens(v.contextTokens)}</Text>,
          ]
    if (v.lastHit !== null) {
      parts.push(
        dot,
        <Text dimColor>last message hit </Text>,
        <Text color={v.lastHit >= 50 ? 'success' : 'error'}>{v.lastHit}%</Text>,
      )
    }

    // Time left as a bar that drains from full (just written) to empty (cold).
    const filled = Math.round((BAR_CELLS * Math.max(0, v.minutesLeft)) / v.ttlMinutes)

    return (
      <Box flexDirection="row" gap={1}>
        <Box flexDirection="row" width={BAR_CELLS} height={1} backgroundColor="subtle">
          <Box key="fill" width={filled} height={1} backgroundColor={v.minutesLeft <= 5 ? 'warning' : 'success'} />
        </Box>
        <Text>{...parts}</Text>
      </Box>
    )
  })
}
