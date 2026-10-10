# Changelog

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
