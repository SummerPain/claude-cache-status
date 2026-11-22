# cache-status

A Claude Code mod that adds one row above the prompt showing the state of the session's prompt cache:

- **Warm**: minutes until the cache cools, the cache lifetime in use (5 min or 1 h), and the context size.
- **Cold**: how long it has been cold and how many tokens the next message will write to the cache again.
- **Last message hit**: what share of the input to your latest message was served from the cache.

A cold cache loses nothing: Claude still sees the whole conversation. The next request just writes the context to the cache again, which is slower and costs more than reading it. Context detail is lost only when a conversation is compacted.

The mod reads the session's transcript file every 30 seconds. It makes no model request, so watching it never warms the cache.

## Install

At the prompt of a terminal session:

```
/plugin install cache-status --marketplace SummerPain/claude-cache-status
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install cache-status --marketplace SummerPain/claude-cache-status
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `SummerPain/claude-cache-status`, then Add plugin.

## Limits

- Only the last 512 KB of the transcript is read; a single entry larger than that hides older replies.
- Before a session's first model reply the row stays hidden.
- Subagents keep their own caches and are not counted.
