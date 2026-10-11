# Changelog

## Unreleased

- **Replay your own Claude Code session**: choose or drop a session file from `~/.claude/projects` on the page (hosted or local). It's read in the browser and never sent anywhere; each tool call becomes an event, and URLs and sensitive paths in commands are shown as where the command reached. A "Your agent's day" card summarises the session and downloads as an image, with site names left out unless you add them.
- Two reconstructions of real attacks: **s1ngularity** (Nx, 2025) and **a GitHub issue injection** (2025), with sources in `docs/replays.md`. The hosted page offers all three replays.
- The hosted demo shows its first breach about 4 seconds after loading.
- `npm run report`: a one-page HTML or Markdown report from the event log (breaches, checks, sessions, sites, sensitive files, log integrity), the deliverable for pilots. `docs/pilots.md` describes a pilot.
- `npm run media` also records the s1ngularity replay as MP4 (1920×1080 and 1080×1080) into `dist/media/`.
- Claude Code tool calls are mapped in one shared module, used by both the collector and the page.
- Fixed: long workspace paths kept their start and lost the project folder; they now keep the end (`…/Projects/fenceline`) and show the home folder as `~`. Command buildings skip leading `VAR=value` assignments.
- A trusted site used in a breach is labelled "Breached" rather than "Unknown".
- Added a pilot request form (a GitHub issue form), linked from the hosted demo's banner and the README.
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
- Observations are attributed by process group: parallel Bash calls each get their own processes, and Claude's own connections go to the open web call rather than whichever call started last.
- Processes from a `run_in_background` Bash call are reported as "Background" activity of that call instead of unreported ghosts; a process left running by `cmd &` inside an ordinary call is still unreported.
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
