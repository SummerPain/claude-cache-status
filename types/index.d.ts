export type CacheView = {
  /** Minutes left until the cache cools; negative once it is cold. */
  minutesLeft: number
  ttlMinutes: number
  /** Prompt tokens the next request sends. */
  contextTokens: number
  /** Cache hit percent of the first response to the latest user message. */
  lastHit: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cache-status': { view: CacheView | null }
  }
}
