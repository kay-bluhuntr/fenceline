# Benchmarks

`npm run bench` builds the page and runs `tools/bench.mjs` against it.

- `baseline-v0.1.html` is the original single-file prototype, kept for before-and-after comparisons. Run it with `node tools/bench.mjs bench/baseline-v0.1.html`.
- `results/` holds the JSON from each run. The figures are summarised in [docs/performance-and-cost.md](../docs/performance-and-cost.md).

Compare builds on the same machine. Headless Chromium numbers aren't comparable across machines.
