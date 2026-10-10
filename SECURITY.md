# Security

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** button (private vulnerability reporting) on this
repository, rather than a public issue. You'll get a reply within 7 days.

## Threat model

Fenceline displays data that can be influenced by the AI agent it is watching. The agent chooses file
names, commands and hostnames, and those end up in events. So the page treats every event as hostile:

- All event text is HTML-escaped before display, and markup is shown as plain text.
- Field lengths, observation counts and message sizes are capped.
- The built page makes no network requests. Live mode connects only to the address you enter.
- `npm start` binds to 127.0.0.1 and sends a strict Content-Security-Policy.

These properties are covered by tests in `tests/e2e/page.test.mjs`.

## Out of scope for this repo

Fenceline is a viewer. How trustworthy it is depends on the producer feeding it. A producer should make
sure the agent being watched can't write to, or impersonate, the event feed.
