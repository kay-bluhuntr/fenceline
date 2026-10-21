# Roadmap

## v0.2 (this release)

- Modular front end, a self-contained single-file build, and self-hosted fonts.
- On-demand rendering, back-pressure and batched DOM updates (see [performance and cost](performance-and-cost.md)).
- JSON Schema for events, plus a validator, a synthetic generator and a benchmark.
- Unit and browser tests, with CI and a GitHub Pages deploy.

## Next release (on the `live-feed` branch)

- Live by default, with automatic reconnection.
- A reference local producer for Claude Code: hooks plus macOS Endpoint Security, or the permission-free Lite observer. It is experimental; see the README for its limits.
- Hook reports checked to come from the Fenceline hook started by Claude (see v0.4 for a gap), and tool calls that can't stay open forever.
- Sampled observations marked as lower confidence, the running observer shown, and slower sampling between tool calls.
- Breaches only for unreported internet access or sensitive files.
- A private, tamper-evident daily event log.
- Every Claude Code session on the Mac, each as its own character, with a hook installer.
- Observations attributed by process group: parallel calls and background tasks.

## Launch

- Hosted page opens in Demo with a link to the repository; replay links and Copy link for sharing.
- A curated replay (poisoned npm package), README GIF and link-preview image.

## Launch (in progress)

- Replay your own Claude Code session in the browser, with a shareable "Your agent's day" card.
- Reconstructions of real attacks (s1ngularity, GitHub issue injection).
- Pilot kit: `npm run report` and `docs/pilots.md`.
- MP4 launch video from `npm run media`.

## v0.3: evidence for security teams (on the `v0.3-console` branch)

A security lead needs to see what agents did, trust that the monitor works, and see a whole team.

- A Console as the default view: every event in a filterable table (agent, workspace, zone, verdict,
  text), what the agent said beside what the Mac saw, a coverage line, and JSON Lines export of the
  filtered events. The map becomes a tab.
- `npm run fence-check`: a detection test that drives the real collector and hook with planted
  actions and prints a scorecard, including the limits it finds. CI runs it on macOS.
- Coverage in the report: which days the collector ran and with which observer, so "nothing found"
  can be told apart from "not watching". Detection check results are listed too.
- A team report: `npm run report -- --json` per developer, `--merge` to combine.
- Pin GitHub Actions to commit SHAs.

## v0.4: closing gaps

- Reject or flag a hook report started by an agent's shell that replaced itself with the hook
  (`exec`). `fence-check` shows the collector accepts it today. Endpoint Security's exec event names
  the image being replaced (a shell, not Claude), which tells the two apart.
- Confirm reported web visits against observed connections, so the map shows "confirmed by OS" rather than an IP address.
- Test the Endpoint Security parser against recorded `eslogger` output.
- Editable allowlist and sensitive-path list, saved locally.
- AgentBox sessions as a source, so Kubernetes sandboxes show up as fenced workspaces.
- **GitHub Copilot.** Today only Claude Code is monitored live; Copilot is only a character for
  hand-made events. Copilot now has hooks with the same fields as Claude Code (`session_id`,
  `tool_name`, `tool_input`, `tool_use_id`, `cwd`), so the "said" side is close. The work is:
  - Start with an audit hook that records Copilot's real hook input, tool names and which process
    starts the hook, before writing the adapter.
  - Copilot CLI first: a single `copilot` process, like `claude`, so the process-tree approach carries
    over. Hooks live in `~/.copilot/hooks/*.json`.
  - Then Copilot in VS Code (hooks in preview). It runs inside VS Code's shared extension host and
    its terminal commands run in VS Code's terminal, so attributing what the OS saw is the hard part.
  - The forged-report check accepts only a hook started by Claude; it needs a Copilot equivalent.
  - Map Copilot's tool names, and label its events `copilot` rather than `claude-code`.
- More agent characters beyond Claude Code and Copilot.

## Later

- Timeline scrubber to replay any moment of a session on the map.
- A separate fenced workspace per session on the map, rather than one shared fence.
- Optional incident summaries from an LLM, with incidents only and never the raw stream (see the cost watch-outs).
- Signed event batches, so the page can tell a genuine feed from a spoofed one.
- A live team view, beyond merging weekly reports.
- Claude Code's own OpenTelemetry export as a fleet-wide source of what agents reported.
- A Linux and CI observer, and Cursor and Codex adapters.
- A public "can your agent sneak past the fence?" challenge, once the observer is harder to evade.
