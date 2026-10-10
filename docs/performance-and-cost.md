# Performance and cost review

Review of the Fenceline front end at v0.1 (the first prototype) and the fixes in v0.2.
All numbers come from `npm run bench`, run on the same machine one build after the other.

> The benchmark uses headless Chromium in a Linux container, not a Mac. Treat the numbers as a
> comparison between builds, not as what you will see on your laptop.

## Summary

| Scenario | v0.1 main thread busy | v0.2 main thread busy | v0.1 redraws/s | v0.2 redraws/s |
|---|---:|---:|---:|---:|
| Demo running | 26.2% | 11.2% | 60 | 30 |
| Paused | 27.3% | 0.0% | 60 | 0 |
| Live burst, 200 events/s for 8 s | 74.5% | 47.8% | 52 | 29 |
| 8 s after the burst | 66.6% | 15.5% | 58 | 30 |
| Quiet, 60 s after the burst | 40.3% | 0.5% | 60 | 0.3 |

| After the burst | v0.1 | v0.2 |
|---|---:|---:|
| Trips still queued | 1,302 (about an hour behind) | 0 |
| DOM nodes | 36,305 | 2,005 |
| JS heap | 5.4 MB | 2.7 MB |

Raw results: [`bench/results/v0.1-baseline.json`](../bench/results/v0.1-baseline.json) and [`bench/results/v0.2.json`](../bench/results/v0.2.json).

During the burst, the page's own JavaScript accounts for about 10% of CPU profile samples. Most of the
remaining busy time is native browser work, much of it the benchmark harness feeding the mocked WebSocket.

## Findings and fixes

### Performance

| # | Finding in v0.1 | Impact | Fix in v0.2 |
|---|---|---|---|
| P1 | The canvas redrew 60 times a second whatever was happening, including while paused. | A paused or idle tab used a quarter of a CPU core. Battery drain and fan noise on a laptop. | The loop runs only while something changes. It caps at 30 fps while things move, 6 fps while trails fade, and stops completely when the map is still. Agents fall asleep after 8 s idle in live mode. |
| P2 | Every reported event queued a walk, with no limit. | Under a 200 events/s burst the map fell over an hour behind reality, which defeats the purpose of a monitor. | Back-pressure: at most 3 queued trips per agent and 4 ghosts at once. Extra events are fast-forwarded: logged, counted and pulsed at their target, without a walk. The status line says how many. |
| P3 | Each event wrote to the DOM straight away, and queued events held removed log rows in memory. | 36,000 DOM nodes after a burst, and steady layout work. | DOM writes are batched into one flush per frame. A flush never builds rows that would be trimmed straight away. Click handling is delegated, and row-to-event lookups use a `WeakMap`. |
| P4 | Static scenery (about 600 checkerboard tiles plus zones) was redrawn every frame. | Wasted fill work on every frame. | It's drawn once into an offscreen layer and copied in per frame. The layer is rebuilt only on resize, theme change or a workspace rename. |
| P5 | Trails, rings and fence cracks had long or unbounded lifetimes. | Draw cost grew with history. | Capped at 40 trails and 24 rings. Ghost trails last 45 s and cracks 15 s. |
| P6 | Fonts loaded from Google Fonts. | A third-party request every time you open a security tool, and broken type when offline. | Fonts are self-hosted (SIL OFL). The built single file makes no network requests at all, and a test enforces this. |
| P7 | Status text was rewritten on every live event. | Unneeded DOM churn under load. | Throttled to four updates per second. |

### Security (found during the review)

| # | Finding | Fix |
|---|---|---|
| S1 | The `source` label on observations was put into the page without escaping. Event text can be chosen by the agent being watched, through file names, commands or hosts, so this was an injection route into the monitor itself. | All event text is escaped, including single quotes. A browser test replays hostile events and checks nothing runs. |
| S2 | There were no size limits on messages or fields. | Messages are capped at 1 MB and 500 lines. Display fields are clipped at 400 characters, and observations at 8 per event. |
| S3 | A network building could be recycled while a character was walking to it, which crashed the trip. | Recycling skips busy buildings, and missing targets fall back to the internet gate. |
| S4 | The local dev server didn't exist yet, and serving it carelessly would expose the monitor on your network. | `npm start` binds to 127.0.0.1 only and sends a strict Content-Security-Policy. |

## Budgets enforced in CI

These are checked by `npm test` on every push, so a regression fails the build:

- Paused: zero redraws.
- After a 1,000-event burst: no more than 6 queued trips and 4 ghosts, and no more than 60 log rows.
- Built single file: under 400 KB, with zero network requests.
- Phone width: no horizontal scrolling.

## Cost

Fenceline is local-first: a static page on your own machine reading events from a local source.
There is no server to pay for.

| Item | Cost | Notes |
|---|---|---|
| Hosting the demo | £0 | GitHub Pages is free for public repositories. Limits are 1 GB per site and a soft 100 GB/month of bandwidth. The site is about 200 KB. |
| CI | £0 | GitHub Actions on standard hosted runners stays free for public repositories. For a private repo, runs use the Free plan's included minutes (over 33 hours a month). One CI run is an estimated 2–3 minutes. |
| Private repo with Pages | Needs a paid plan | Pages for private repositories needs GitHub Pro or higher. Keep the repo public to stay at £0. |
| Runtime infrastructure | £0 | Runs in your browser. Events travel over localhost only. |
| Network | £0 | 200 events/s × about 250 bytes is about 50 KB/s, local only. |
| Storage, if you keep event logs | Negligible | About 250 bytes per event raw. A busy day of 20,000 events is about 5 MB, or about 1.8 GB a year. Real logs typically compress 5–10×. |

So the real cost is your laptop's CPU and battery, which is why P1 and P2 mattered most.

### Watch-outs as the project grows

- **LLM summaries of incidents.** This is a natural next feature, and the one that could make running costs non-zero. Keep the model out of the event path: summarise incidents only (a handful a day), never the raw stream. Batch them and cache the results.
- **Central or team version.** Sending events to a hosted backend brings compute, storage and data protection obligations (UK GDPR), because event logs contain file paths and hostnames. Treat it as a separate design decision.
- **Producer volume.** The page copes with bursts by fast-forwarding, but producers should still filter at the source and send only what the map shows: one event per meaningful action, not every syscall.

Sources: [GitHub Actions pricing update](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/), [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
