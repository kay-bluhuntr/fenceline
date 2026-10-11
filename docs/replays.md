# Replays

Replays play a recorded session on the map. Open one from the hosted page, or link to it with
`?replay=replays/<name>.jsonl`. They live in [`examples/replays/`](../examples/replays/).

The incident replays are **reconstructions** of publicly reported attacks, not recordings of them.
The steps follow the published reports; file names, process IDs and times are illustrative.

| Replay | What it shows | Link |
|---|---|---|
| A poisoned npm package | An install script reads AWS and npm credentials and sends them out, while the agent reports "all tests pass". A made-up example. | [Play](https://kay-bluhuntr.github.io/fenceline/?replay=replays/poisoned-package.jsonl) |
| s1ngularity (Nx, August 2025) | An install script uses your own AI CLI, with its permission checks switched off, to hunt for secrets, then publishes them to a public repository in your GitHub account. | [Play](https://kay-bluhuntr.github.io/fenceline/?replay=replays/s1ngularity.jsonl) |
| A GitHub issue injection (May 2025) | Every step is reported, but the agent follows instructions hidden in a public issue and publishes private repository data in a public pull request. | [Play](https://kay-bluhuntr.github.io/fenceline/?replay=replays/github-issue-injection.jsonl) |

## s1ngularity (Nx, August 2025)

On 26 August 2025, malicious versions of the Nx build system were published to npm using a stolen
token. Their install script:

- ran automatically on `npm install` (`telemetry.js`);
- prompted installed AI command-line tools, including Claude Code, Gemini CLI and Amazon Q, with flags
  that switch off their permission checks (`--dangerously-skip-permissions`, `--yolo`,
  `--trust-all-tools`), to search the file system for secrets and wallets;
- collected SSH keys, GitHub and npm tokens and wallet files;
- created a public repository named `s1ngularity-repository` in the victim's own GitHub account and
  pushed the stolen data to it, base64-encoded several times;
- appended `sudo shutdown -h 0` to shell start-up files.

What Fenceline shows: none of this is reported by the agent you were working with, so every step is a
ghost. The upload goes to `github.com`, a site on the allowlist, which is why the replay marks it as a
breach anyway: an allowlist alone doesn't stop data leaving through a trusted site.

Sources: [Wiz: s1ngularity supply chain attack](https://www.wiz.io/blog/s1ngularity-supply-chain-attack),
[GitHub advisory GHSA-cxm3-wv7p-598c](https://github.com/nrwl/nx/security/advisories/GHSA-cxm3-wv7p-598c),
[Kodem: malicious Nx npm packages](https://kodemsecurity.com/resources/vulnerability-alert-s1ngularity-malicious-nx-npm-packages).

## A GitHub issue injection (May 2025)

Invariant Labs showed that an agent connected to the GitHub MCP server, with a token that can read
both public and private repositories, can be steered by a public issue. Asked to look at a public
project's open issues, the agent reads one containing hidden instructions, pulls data from the user's
private repositories, and opens a public pull request containing it. Invariant described this as a
"toxic agent flow": no server was compromised and no credential was stolen; the agent did what the
issue told it to.

The original demonstration used Claude Desktop; the replay draws it as a Claude Code character with
the GitHub MCP server.

What Fenceline shows: every step is reported, so there are no ghosts. The harm is in what the
reported steps do, which is why the replay marks reading private repositories as a check and the
public pull request as a breach. Said-versus-seen catches what an agent hides; it takes rules about
what is allowed to catch an agent that is openly misled.

Sources: [Invariant Labs: GitHub MCP exploited](https://invariantlabs.ai/blog/mcp-github-vulnerability),
[DevClass: prompt injection in GitHub MCP](https://devclass.com/2025/05/27/researchers-warn-of-prompt-injection-vulnerability-in-github-mcp-with-no-obvious-fix/).

## Your own session

Choose **Replay your own Claude Code session** on the hosted page, or drop a session file from
`~/.claude/projects/` onto it. The page reads the file in your browser and never sends it anywhere.
A transcript records what the agent said it did, not what the operating system saw, so its events
are marked "transcript only". Run Fenceline locally to see both.
