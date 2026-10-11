# Changelog

## Unreleased

- Hosted copies (GitHub Pages) open in Demo, with a banner linking to the repository, instead of an empty Live feed that can't reach the visitor's Mac. Local copies still open in Live. `?feed=demo|replay|live` overrides either.
- Replay links: `?replay=replays/<name>.jsonl` plays a file published with the site. Same origin only, so a link can't make the page show someone else's fabricated feed.
- A **Copy link** button on hosted copies shares the demo or the replay on screen.
- New replay, `poisoned-package.jsonl`: an npm install script reads AWS and npm credentials and uploads them while Claude Code reports a clean run.
- Link previews (Open Graph and Twitter card) with a 1200×630 image, and a README GIF. `npm run media` re-records both.
- The Pages deploy validates events and publishes the replays and preview image.

- Unreported actions are a breach only when they reach the internet or a sensitive file (SSH, cloud and registry credentials, Keychain, LaunchAgents, browser logins). Other unreported local processes, files and private-network connections are a check, so routine background work doesn't raise incidents.
- Each Claude Code session gets its own character, named after its project, and log rows say which project they came from. Events carry a `session` field.
- `npm run install-hooks` adds the hooks for every Claude Code session on the Mac (or one project with `--project`), keeping other settings; `npm run uninstall-hooks` removes them.
- The collector keeps a private daily log in `~/Library/Logs/Fenceline/` (30 days, `--no-log` to turn off) that Replay file can open, with a hash chain that `npm run verify-log` checks.
- Fenceline opens in Live mode and connects to the local collector, instead of running the demo. Demo and Replay file are still in the feed selector.
- The Live feed reconnects by itself, backing off from 1 s to 15 s, so the collector can start before or after the page. **Stop** ends the retries.
- Added a local Claude Code collector (`npm run collector`). It pairs Claude Code tool hooks with what macOS observed and flags actions that no tool call reported.
- Two observers: Endpoint Security (`eslogger`, needs `sudo` and Full Disk Access) and Lite (`npm run collector:lite`, samples `ps` and `lsof`, needs no permissions and also sees network connections). The default tries Endpoint Security and falls back to Lite.
- Background processes that outlive their shell are still attributed to Claude, through their process group.
- MCP calls are drawn as one building per server, and subagents as one per type.
- Hook reports are accepted only from the Fenceline hook started directly by a top-level Claude Code process, so the agent being watched can't forge them.
- Tool calls that never finish, such as an interrupted one, are closed at the next prompt, at the end of Claude's turn, or after 11 minutes, so they can't hide later activity.
- Fenceline's own processes, Claude Code's internal `git` calls and its bookkeeping files are filtered out.
- Lite samples every 300 ms during tool calls and every 2 s between them, about 85% fewer `lsof` runs while idle.
- Sampled observations are marked on the page (a dotted **POLL** tag and a **Sampled** pill), and the feed status line names the running observer. Producers can set `sampled: true` on an observation and send a `status` message; see the event format.

## 0.2.0 (2026-10-09)

- Split the single prototype file into ES modules, with a build that inlines everything back into one file.
- The render loop only runs while the map changes: 0 redraws when paused or idle, capped at 30 fps while moving.
- Back-pressure for bursts: per-agent queues are capped and extra events are fast-forwarded, so the map stays in real time.
- DOM updates are batched per frame, and static scenery is cached offscreen.
- Fonts are self-hosted, so the built page makes no network requests.
- Fixed: the observation source label wasn't HTML-escaped.
- Added size limits on messages and fields.
- Added the JSON Schema, validator, synthetic event generator and benchmark.
- Added unit and browser tests, CI, and a GitHub Pages deploy.

## 0.1.0 (2026-10-08)

- First prototype: animated map, demo, file replay and live WebSocket modes.
