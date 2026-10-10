# Roadmap

## v0.2 (this release)

- Modular front end, a self-contained single-file build, and self-hosted fonts.
- On-demand rendering, back-pressure and batched DOM updates (see [performance and cost](performance-and-cost.md)).
- JSON Schema for events, plus a validator, a synthetic generator and a benchmark.
- Unit and browser tests, with CI and a GitHub Pages deploy.

## v0.3: making it useful day to day

- Timeline scrubber to replay any moment of a session.
- Filters by agent, zone and verdict.
- Editable allowlist and sensitive-path list, saved locally.
- Export incidents as JSON Lines.
- Pin GitHub Actions to commit SHAs.

## v0.4: more sources

- A reference producer, kept as a separate package. Its design is still open, and the event format is the contract.
- AgentBox sessions as a source, so Kubernetes sandboxes show up as fenced workspaces.
- More agent characters beyond Claude Code and Copilot.

## Later

- Optional incident summaries from an LLM, with incidents only and never the raw stream (see the cost watch-outs).
- Signed event batches, so the page can tell a genuine feed from a spoofed one.
