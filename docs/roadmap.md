# Roadmap

## v0.2 (this release)

- Modular front end, a self-contained single-file build, and self-hosted fonts.
- On-demand rendering, back-pressure and batched DOM updates (see [performance and cost](performance-and-cost.md)).
- JSON Schema for events, plus a validator, a synthetic generator and a benchmark.
- Unit and browser tests, with CI and a GitHub Pages deploy.

## Next release (on the `live-feed` branch)

- Live by default, with automatic reconnection.
- A reference local producer for Claude Code: hooks plus macOS Endpoint Security, or the permission-free Lite observer. It is experimental; see the README for its limits.
- Hook reports that the watched agent can't forge, and tool calls that can't stay open forever.
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

## v0.3: making it useful day to day

- Timeline scrubber to replay any moment of a session.
- Filters by agent, session, zone and verdict.
- A separate fenced workspace per session, rather than one shared fence.
- Editable allowlist and sensitive-path list, saved locally.
- Export incidents as JSON Lines.
- Pin GitHub Actions to commit SHAs.

## v0.4: more sources

- Confirm reported web visits against observed connections, so the map shows "confirmed by OS" rather than an IP address.
- Test the Endpoint Security parser against recorded `eslogger` output, and run the collector end to end in the test suite.
- AgentBox sessions as a source, so Kubernetes sandboxes show up as fenced workspaces.
- More agent characters beyond Claude Code and Copilot.

## Later

- Optional incident summaries from an LLM, with incidents only and never the raw stream (see the cost watch-outs).
- Signed event batches, so the page can tell a genuine feed from a spoofed one.
- A team view that combines several developers' reports.
- Claude Code's own OpenTelemetry export as a fleet-wide source of what agents reported.
- A Linux and CI observer, and Copilot, Cursor and Codex adapters.
- A public "can your agent sneak past the fence?" challenge, once the observer is harder to evade.
