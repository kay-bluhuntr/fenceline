# Setup and reference

The detail behind the [README](../README.md) quick start: observers, hooks, the page, the event log,
troubleshooting and every command. For how events are matched and judged, see
[Architecture](architecture.md).

The collector is a local development integration, not a hardened security product.

## Observers

The collector pairs Claude Code's hook reports (what the agent **said**) with what macOS **saw**
Claude and its child processes do. It has two ways of seeing:

| Observer | Needs | Sees | Gaps |
|---|---|---|---|
| **Endpoint Security** (`es`) | `sudo` and Full Disk Access | Every process launch and file open/write | No network connections. Apple documents `eslogger` as a debugging tool whose JSON format can change after a macOS upgrade |
| **Lite** (`poll`) | Nothing | New processes, open files and network connections, sampled every 300 ms during tool calls and every 2 s between them | Anything that starts and finishes between two samples, such as a quick file read, is missed. Connections show IP addresses, not host names |

```sh
npm run collector         # Endpoint Security, falling back to Lite
npm run collector:lite    # Lite only, no sudo
```

The collector opens a WebSocket at `127.0.0.1:8765` for the page and a hook receiver at
`127.0.0.1:8766`. Keep it running; stop it with Ctrl+C or `npm run stop`.

The page's coverage line says which observer is running. Lite observations are tagged **POLL** with
a dotted underline, and an event seen only by Lite carries a **Sampled** pill. A Lite event is real,
but a missing one proves nothing: treat its absence as "not observed" rather than "didn't happen".

### Setting up Endpoint Security

Give the terminal app you run the collector in **Full Disk Access** (**System Settings → Privacy &
Security → Full Disk Access**), then quit and reopen that terminal. `eslogger` also needs root;
Fenceline starts it with `sudo` (enter your macOS password when asked) and never runs the web
server as root. The grant applies to everything that terminal runs, so you may prefer to grant it
to Terminal.app only and run the collector there.

## Claude Code hooks

```sh
npm run install-hooks                       # every Claude Code session on this Mac
npm run install-hooks -- --project ~/code/x # or one project only
npm run uninstall-hooks                     # remove them
```

The first form adds the hooks to `~/.claude/settings.json`, so every Claude Code session reports:
other VS Code windows, terminal sessions and every project. Each session gets its own character on
the map, named after its project folder. The second form uses that project's
`.claude/settings.local.json` instead. Both keep your other settings and save the previous file as
`*.fenceline-backup`.

Each tool call costs about 30–60 ms for the hook. If the collector isn't running, the hook fails
fast and Claude Code carries on. Claude Code usually picks up new hooks in a running session; if
tool calls don't appear, restart the session.

### Adding them by hand

Put this entry under each of `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`,
`Stop` and `SessionEnd` in the settings file's `"hooks"`:

```json
[{ "hooks": [{ "type": "command", "command": "node", "args": ["/absolute/path/to/fenceline/tools/claude-hook.mjs"] }] }]
```

Keep this exec form (`"command": "node"` with `"args"`). The collector accepts a report only from
`claude-hook.mjs` started directly by Claude Code, so the agent being watched can't send fake
reports by running the hook from its own shell. A shell-form command such as
`"command": "node /path/claude-hook.mjs"` is rejected for the same reason. If you can't use the exec
form, start the collector with `FENCELINE_TRUST_HOOKS=1` to turn the check off.

One forgery still gets through: an agent's Bash command that *replaces* its shell with the hook
(`exec node claude-hook.mjs`) looks exactly like a genuine report, and can make later actions look
reported. `npm run fence-check` shows it as **GAP**; the fix is on the [roadmap](roadmap.md).

`UserPromptSubmit`, `Stop` and `SessionEnd` let the collector close tool calls that never finished,
such as one you interrupted, so they can't absorb later activity. Any tool call still open after 11
minutes is closed too. Both show as "No result".

## The page

```sh
npm start                 # http://127.0.0.1:8080, local only
npm run build             # or dist/fenceline.html: one file, about 200 KB, to open from disk or share
```

It opens on the **Console**: a coverage line (which observer is running, sessions, events), filters,
and a table of every event with what the agent said beside what the Mac saw. Open a row to see the
raw event. **Export JSONL** downloads the events that match the filters, and the filters are kept in
the address, so a filtered view can be linked. The **Map** tab shows the same events animated; the
page remembers which you used last.

| Feed | What it does |
|---|---|
| **Live** | Default when run locally. Connects to the collector, or any producer that streams [the event format](event-format.md) over a WebSocket. Without a collector it keeps retrying (backing off to every 15 s), so you can start the collector before or after the page. **Stop** ends the retries. |
| **Replay file** | Load a `.jsonl` file: an event log, [`examples/sample-events.jsonl`](../examples/sample-events.jsonl), or a Claude Code session from `~/.claude/projects`. |
| **Replay link** | `?replay=replays/<name>.jsonl` plays a file published with the site. Only files from the same site load. |
| **Demo** | A scripted session with three breaches. Try **Simulate a breach**. |

A hosted copy, such as GitHub Pages, opens in **Demo** with a banner pointing to this repository.
`?feed=demo`, `?feed=replay` or `?feed=live` picks the starting feed, and `?view=console` or
`?view=map` the view.

### On the map

| Claude Code does | On the map |
|---|---|
| Read, Edit, Write, Glob, Grep | A walk to the file, inside the fence or out to the vault |
| Bash | A walk to a building named after the command |
| WebFetch, WebSearch | A walk to the site in the network zone |
| An MCP tool | A walk to one `mcp:<server>` building per MCP server |
| A subagent (Agent tool) | A walk to an `agent:<type>` building; the subagent's own tool calls appear as Claude's |
| Something the OS saw with no tool call running | A ghost, titled "Unmatched OS event": a **breach** when it reached the internet or a sensitive file such as `~/.ssh`, otherwise a **check** |

Tools with no effect outside Claude Code, such as ToolSearch and TodoWrite, aren't drawn.

## Event log

The collector saves every event to a daily file in `~/Library/Logs/Fenceline/`, such as
`2026-10-10.jsonl`. To look back at a session, choose **Replay file** and pick that file (in the
file picker, press ⇧⌘G and type `~/Library/Logs/Fenceline`).

- **Private:** the folder and files are readable only by you, because commands and paths can
  contain secrets such as tokens on a command line.
- **Kept for 30 days:** older files are deleted when the collector starts and at midnight. Set
  `FENCELINE_LOG_DAYS` to change this, `FENCELINE_LOG_DIR` to use another folder, or pass
  `--no-log` (`npm run collector -- --no-log`) to keep nothing.
- **Coverage:** the collector also logs which observer it's running, so `npm run report` can say
  which days were monitored, and how. A day with no log means the collector wasn't running.
- **Tamper-evident:** each line carries a `chain` hash of the line before it. `npm run verify-log`
  reports any file where a line was edited, inserted or removed. It can't stop something running as
  you from rewriting a whole file with a fresh chain, so treat it as a check against casual edits,
  not proof.

## Stopping and restarting

| To | Do |
|---|---|
| Stop the collector or page server in its own terminal | Ctrl+C in that terminal |
| Stop them wherever they're running | `npm run stop` |
| Check what's running | `lsof -nP -iTCP:8080,8765,8766 -sTCP:LISTEN` |
| Restart | `npm run stop`, then `npm start` and `npm run collector:lite` in two terminals |
| Restart a Claude Code session | VS Code: close the Claude Code tab and open a new one. Terminal: `/exit`, then `claude` (or `claude --continue`) |

While the collector is stopped, the page keeps retrying and reconnects by itself, and Claude Code's
hooks fail fast. Tool calls that were open when it stopped are lost; everything already sent is in
the event log.

## Troubleshooting

| Symptom | Check |
|---|---|
| Page says "Retrying" | The collector isn't running: `npm run collector:lite` |
| `EADDRINUSE` / address already in use | A collector or page server is already running: `npm run stop`, then start again |
| Connected, but nothing appears | The hooks aren't installed for the Claude Code session you're using. Without a hook report the collector doesn't know which process is Claude, so nothing is observed |
| `Failed to create ES client … Full Disk Access` | Grant Full Disk Access to the terminal app and reopen it, or use Lite. In auto mode the collector falls back to Lite by itself |
| `Fenceline hook: couldn't forward the event` in Claude Code | The collector isn't running, or is on a different port |
| `Fenceline hook: collector refused the event … exec form` | The hook is configured in shell form. Use the [exec form](#adding-them-by-hand) |

## All commands

| Command | Purpose |
|---|---|
| `npm start` | Page server on 127.0.0.1:8080 |
| `npm run collector` | Hook receiver and macOS observer (Endpoint Security, falling back to Lite) |
| `npm run collector:lite` | The same, Lite observer only |
| `npm run stop` | Stop the collector and page server, wherever they were started |
| `npm run install-hooks` | Add the hooks to Claude Code (`--project DIR` for one project); `npm run uninstall-hooks` removes them |
| `npm run fence-check` | Detection test against the real collector and hook (`--es` for Endpoint Security) |
| `npm run report` | HTML report of the last 7 days (`--days N`, `--from`/`--to`, `--md`, `--json [--name NAME]`, `--out FILE`) |
| `npm run report -- --merge a.json b.json …` | One team report from several developers' `--json` reports |
| `npm run verify-log` | Check the event log files haven't been edited |
| `npm run build` | Self-contained `dist/fenceline.html` |
| `npm test` | Unit tests, build, then browser tests |
| `npm run validate` | Check example events against the schema |
| `npm run bench` | Front-end performance benchmark |
| `npm run generate -- --count 5000 --rate 200` | Synthetic events for load tests |
| `npm run media` | Re-record `docs/img/fenceline-demo.gif` and the `og.png` link preview |

## Repository layout

```
web/            the page (HTML, CSS, ES modules, self-hosted fonts)
tools/          collector, hook, observers, report, fence-check, build, dev server
tests/          unit tests (Node) and browser tests (Playwright)
schema/         JSON Schema for events
examples/       sample event files; replays/ is published with the site
bench/          benchmark results
docs/           this guide, architecture, event format, replays, pilots, roadmap
```
