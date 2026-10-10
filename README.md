# Fenceline

**See what your AI coding agents actually do, and catch what they don't tell you.**

Fenceline is a gamified monitor for AI agents such as Claude Code and GitHub Copilot. Each agent is a
character inside a fenced workspace. When it reaches a website, runs a tool or touches a sensitive
folder, you watch it walk there. When the operating system sees something the agent never reported,
a ghost walks the route instead, cracks the fence, and raises an incident.

![Fenceline replaying a session with two breaches](docs/img/fenceline.png)

## Why

Agents report their own actions through hooks and logs, but a misbehaving agent can leave things out.
Fenceline puts two accounts side by side:

- **Said**: what the agent reported.
- **Seen**: what the OS observed.

The gap between them is the signal.

## Quick start

```sh
npm ci
npm start              # http://127.0.0.1:8080, local only
```

Open the page and choose a feed:

| Feed | What it does |
|---|---|
| **Demo** | A scripted session with three breaches. Try **Simulate a breach**. |
| **Replay file** | Load a `.jsonl` file, such as [`examples/sample-events.jsonl`](examples/sample-events.jsonl). |
| **Live** | Connect to any producer that streams [the event format](docs/event-format.md) over a WebSocket. |

For a single file you can open straight from disk, or share:

```sh
npm run build          # dist/fenceline.html, about 200 KB, no network requests
```

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Dev server on 127.0.0.1 |
| `npm run build` | Self-contained `dist/fenceline.html` |
| `npm test` | Unit tests, build, then browser tests |
| `npm run validate` | Check example events against the schema |
| `npm run bench` | Front-end performance benchmark |
| `npm run generate -- --count 5000 --rate 200` | Synthetic events for load tests |

## Repository layout

```
web/            the app (HTML, CSS, ES modules, self-hosted fonts)
schema/         JSON Schema for events
examples/       sample event files
tools/          build, dev server, validator, generator, benchmark
tests/          unit tests (Node) and browser tests (Playwright)
bench/          benchmark baseline and results
docs/           architecture, event format, performance and cost, roadmap
```

## Docs

- [Architecture](docs/architecture.md)
- [Event format](docs/event-format.md)
- [Performance and cost review](docs/performance-and-cost.md)
- [Roadmap](docs/roadmap.md)
- [Security](SECURITY.md)

## Status

v0.2. The front end, event format and tooling are complete. This repo doesn't include an event producer
(collector) yet. Fenceline works with any producer that emits the event format.

## Licence

MIT, see [LICENSE](LICENSE). Bundled fonts (IBM Plex Sans, JetBrains Mono, Silkscreen) are under the
SIL Open Font License 1.1, see [`web/fonts/`](web/fonts/).
