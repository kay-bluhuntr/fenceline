# Event format

Send one JSON object per line (JSON Lines), over a WebSocket or in a `.jsonl` file.
The machine-readable definition is [`schema/event.schema.json`](../schema/event.schema.json).
Check a file with:

```sh
node tools/validate-events.mjs my-events.jsonl
```

## Example

```json
{
  "ts": "2026-10-08T22:43:12+01:00",
  "agent": "claude-code",
  "title": "Read AWS credentials",
  "zone": "vault",
  "target": "~/.aws/credentials",
  "said": null,
  "seen": [{ "source": "es", "text": "open ~/.aws/credentials pid 5203" }],
  "verdict": "breach",
  "rule": "Secret read outside the workspace"
}
```

## Fields

| Field | Required | Values | Notes |
|---|---|---|---|
| `agent` | Yes | `claude-code`, `copilot` | Picks the character. Common aliases are accepted. |
| `zone` | Yes | `fence`, `net`, `tools`, `vault` | Workspace, internet, a CLI tool, or anywhere else on the machine. |
| `target` | Yes | Path, URL, host or tool | Up to 2,048 characters. |
| `said` | No | `null`, string, or `{source, text}` | What the agent reported. `null` or missing means unreported. |
| `seen` | No | string, `{source, text, sampled?}`, or an array of them | What the OS observed. Up to 8 are shown. Set `sampled: true` when the observer polls and can miss short actions; the page marks it as lower confidence. |
| `verdict` | No | `ok`, `warn`, `breach` | If missing, Fenceline decides (see [architecture](architecture.md#verdicts)). |
| `rule` | No | string | The reason, shown under the log row. |
| `title` | No | string | The row heading. If missing, one is generated, such as "Ran git". |
| `ts` | No | ISO 8601 | Used for the clock and for pacing replays. |
| `workspace` | No | string | Relabels the fenced area. |
| `session` | No | string | Agent session ID. Each session gets its own character on the map, named after the last folder of its `workspace`, and its log rows say which project they came from. Up to 6 characters are drawn; further sessions share their agent's first one. |

Unknown fields are ignored, so producers can add their own.

## Status messages

A live producer can also send a status message, which the page shows in the feed status line
instead of counting it as an event:

```json
{ "type": "status", "observer": "lite", "detail": "Lite observer: sampled every 300 ms during tool calls" }
```

`observer` is a short name, such as `es`, `lite` or `none`, and `detail` is the text shown. The
reference collector sends one when a page connects and whenever its observer changes.

## Limits

| Limit | Value |
|---|---|
| WebSocket message size | 1 MB |
| Lines per message | 500 |
| Displayed text per field | 400 characters |

Events beyond what the map can animate are still logged and counted. They're shown without a walk,
so the map stays in real time.

## Writing a producer

Fenceline doesn't care where events come from. A producer only needs to:

1. Emit one event per meaningful action, not one per system call.
2. Pair the agent's report with the OS observation before sending, and set `said: null` when there's no matching report.
3. Serve them over a WebSocket on localhost, or write them to a `.jsonl` file.
4. Make sure the agent being watched can't write to the feed.

`tools/generate-events.mjs` produces synthetic events for testing a producer pipeline or the page under load.
