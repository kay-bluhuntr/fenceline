# Benchmarks

`npm run bench` builds the page and runs `tools/bench.mjs` against it.

- The original single-file prototype lives in the `v0.1` tag, for before-and-after comparisons:
  `git show v0.1:bench/baseline-v0.1.html > /tmp/baseline-v0.1.html && node tools/bench.mjs /tmp/baseline-v0.1.html`.
- `results/` holds the JSON from each run. The figures are summarised in [docs/performance-and-cost.md](../docs/performance-and-cost.md).

Compare builds on the same machine. Headless Chromium numbers aren't comparable across machines.
