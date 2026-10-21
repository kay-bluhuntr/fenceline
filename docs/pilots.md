# Pilots

Fenceline is looking for a few engineering teams to pilot it. A pilot answers one question for you:
**what do our coding agents actually do on our developers' machines, and what don't they tell us?**

## Who it's for

- Teams of 3–15 developers using Claude Code on Macs. Copilot isn't monitored yet.
- A CTO or engineering lead who wants evidence, not guesses, before setting agent policy.

## What a pilot includes

| Week | What happens |
|---|---|
| Setup (about 30 minutes per developer) | Each developer installs Fenceline and the Claude Code hooks: `npm ci`, `npm run install-hooks`, `npm run collector:lite`, then `npm run fence-check` to prove detection on that Mac. No admin rights or Full Disk Access needed. |
| Weeks 1 and 2 | Developers work as normal. Each laptop keeps a private, tamper-evident daily log. |
| End of each week | Each developer runs `npm run report` and reviews their report, then shares `npm run report -- --json`. `npm run report -- --merge *.json` combines them into one team report, with which days each Mac was monitored. We go through it with you. |
| Close | A findings summary: unreported actions, sites reached, sensitive files touched, and suggested agent settings and allowlists. |

## What stays on each laptop

- Everything Fenceline records stays on the developer's Mac, in `~/Library/Logs/Fenceline`. There is
  no server and nothing is uploaded.
- Reports are files the developer chooses to share. They contain commands and file paths, so each
  developer reviews theirs first.
- `npm run uninstall-hooks` and deleting the log folder remove Fenceline completely.

## What it can and can't tell you

- **Proven on each Mac:** `npm run fence-check` plants actions and shows what was caught, missed and
  accepted; the results appear in each report.
- **Can:** every tool call Claude Code reports; processes, files and network connections from
  Claude's process tree that no tool call reported; background tasks; interrupted tool calls.
- **Can't, in Lite mode:** actions shorter than its sampling interval, or host names (connections show
  as IP addresses). Endpoint Security mode closes most of the first gap but needs Full Disk Access.
  See [Setup and reference](setup.md#observers) for the full list of limits.

## Ask for a pilot

[Open a pilot request](https://github.com/kay-bluhuntr/fenceline/issues/new?template=pilot.yml). The
form is a public GitHub issue, so leave out anything confidential; we'll reply there to arrange a
private conversation.
