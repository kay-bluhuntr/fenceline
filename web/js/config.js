// Tunables in one place. Every limit here exists to keep the page cheap
// and the map close to real time; docs/performance-and-cost.md explains each.
export const LIMITS = Object.freeze({
  fpsMoving: 30,        // frame cap while anything walks or pulses
  fpsFading: 6,         // frame cap while only trails and highlights fade
  queuePerAgent: 3,     // queued trips per agent before the map fast-forwards
  maxGhosts: 4,         // unreported actions animating at once
  maxWalkers: 6,        // characters on the map; extra sessions share their agent's first one
  maxTrails: 40,
  maxRings: 24,
  logRows: 60,          // rows kept in the activity log
  consoleEvents: 5000,  // events kept in the console, for filtering and export
  incidentsShown: 3,
  idleSleepSec: 8,      // an idle agent stops wandering (and the loop sleeps)
  maxMessageBytes: 1_000_000,
  maxLinesPerMessage: 500,
  maxFieldChars: 400,   // longer text from events is clipped before display
  maxReplayBytes: 5_000_000,  // largest .jsonl a replay link will load
  maxLocalFileBytes: 100_000_000,  // largest file (event log or session transcript) read from disk
  transcriptSeconds: 90       // a replayed session transcript plays in about this long
});

// Where hosted visitors are sent to install Fenceline on their own Mac.
export const REPO_URL = 'https://github.com/kay-bluhuntr/fenceline';
// The pilot request form (.github/ISSUE_TEMPLATE/pilot.yml), linked from the hosted demo.
export const PILOT_URL = `${REPO_URL}/issues/new?template=pilot.yml`;

// Domains every agent is expected to reach. Anything else gets a "new" building.
export const ALLOWLIST = ['anthropic.com', 'github.com', 'npmjs.org', 'terraform.io'];

export const AGENTS = Object.freeze({
  claude: { name: 'Claude Code', colour: 'accent' },
  copilot: { name: 'Copilot', colour: 'agent2' }
});

export const DEFAULT_SLOTS = Object.freeze({
  tiles: [['src', 'src/'], ['tests', 'tests/'], ['github', '.github/'], ['infra', 'infra/']],
  tools: ['git', 'npm', 'terraform', 'kubectl', 'docker'],
  vault: [['ssh', '~/.ssh'], ['aws', '~/.aws'], ['keychain', 'Keychain'], ['launch', 'LaunchAgents']]
});

export const NET_SLOTS = 6;
export const DEFAULT_WORKSPACE = '~/code/payments-api';
