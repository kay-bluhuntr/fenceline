// "Your agent's day": a summary of a replayed Claude Code session, and an image of it to share.
// The image is drawn on a canvas in the browser and downloaded directly; nothing is uploaded.
// Site names are left out of the image unless the visitor chooses them, as they can be internal.
import { REPO_URL } from './config.js';

let panel, numbers = null;

const STATS = [
  ['toolCalls', 'Tool calls'], ['commands', 'Commands run'], ['filesInside', 'Files in the workspace'],
  ['filesOutside', 'Files outside it'], ['domains', 'Sites reached'], ['sensitive', 'Sensitive files'],
  ['subagentCalls', 'Subagent calls'], ['mcpServers', 'MCP servers']
];

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function when(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function span(n) {
  const a = when(n.first), b = when(n.last);
  return a && b ? (a === b ? a : `${a} to ${b}`) : '';
}

export function initDayCard(el) { panel = el; }

/** Show the card for a transcript summary, or hide it (null). */
export function showDay(n) {
  numbers = n;
  panel.replaceChildren();
  panel.hidden = !n;
  if (!n) return;
  const head = el('div', { class: 'dayhead' });
  head.append(el('h2', {}, 'Your agent’s day'), el('span', { class: 'dayspan' }, span(n)));
  const grid = el('dl', { class: 'daygrid' });
  for (const [key, label] of STATS) {
    const item = el('div', { class: key === 'sensitive' && n.sensitive ? 'warn' : '' });
    item.append(el('dt', {}, label), el('dd', {}, String(n[key])));
    grid.append(item);
  }
  const sites = el('p', { class: 'daysites', hidden: '' }, n.domainList.length ? n.domainList.join(', ') : 'No sites.');
  const toggle = el('label', { class: 'daytoggle' });
  const box = el('input', { type: 'checkbox', id: 'daySites' });
  box.addEventListener('change', () => { sites.hidden = !box.checked; });
  toggle.append(box, document.createTextNode(' Show site names (also adds them to the image)'));
  const note = el('p', { class: 'daynote' },
    'From the session transcript: what Claude Code said it did. It never left this browser. To see what your Mac actually saw, ');
  note.append(el('a', { href: REPO_URL }, 'run Fenceline locally'), document.createTextNode('.'));
  const actions = el('div', { class: 'dayactions' });
  const download = el('button', { type: 'button', id: 'dayDownload' }, 'Download image');
  download.addEventListener('click', () => downloadImage(box.checked));
  actions.append(download, toggle);
  panel.append(head, grid, actions, sites, note);
}

/** Draw the card as a 1200×630 image (the size social sites preview). */
export function drawDayImage(n, withSites, canvas = document.createElement('canvas')) {
  const W = 1200, H = 630;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const v = (k, fallback) => cs.getPropertyValue(k).trim() || fallback;
  const C = { bg: v('--bg', '#F4F6F1'), surface: v('--surface', '#FFFFFF'), ink: v('--ink', '#1C2620'), muted: v('--muted', '#5B695F'),
    line: v('--line', '#C9D2C4'), accent: v('--accent', '#C2610F'), warn: v('--warn', '#A97A0C') };
  const F = { display: v('--f-display', 'monospace'), body: v('--f-body', 'sans-serif'), mono: v('--f-mono', 'monospace') };
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = C.ink; g.textBaseline = 'alphabetic';
  g.font = `28px ${F.display}`; g.fillText('FENCE', 64, 84);
  const fw = g.measureText('FENCE').width;
  g.fillStyle = C.accent; g.fillText('LINE', 64 + fw, 84);
  g.fillStyle = C.ink; g.font = `600 52px ${F.body}`; g.fillText('My Claude Code day', 64, 168);
  g.fillStyle = C.muted; g.font = `24px ${F.body}`; g.fillText(span(n), 64, 210);
  const cols = 4, gap = 16, tileW = (W - 128 - gap * (cols - 1)) / cols, tileH = 132;
  STATS.forEach(([key, label], i) => {
    const x = 64 + (i % cols) * (tileW + gap), y = 250 + Math.floor(i / cols) * (tileH + gap);
    g.fillStyle = C.surface; g.fillRect(x, y, tileW, tileH);
    g.strokeStyle = C.line; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, tileW - 2, tileH - 2);
    g.fillStyle = key === 'sensitive' && n.sensitive ? C.warn : C.ink;
    g.font = `600 54px ${F.mono}`; g.fillText(String(n[key]), x + 20, y + 72);
    g.fillStyle = C.muted; g.font = `20px ${F.body}`; g.fillText(label, x + 20, y + 110);
  });
  g.fillStyle = C.muted; g.font = `20px ${F.body}`;
  const foot = withSites && n.domainList.length ? `Sites: ${n.domainList.join(', ')}` : 'What my agent said it did. Replayed in the browser; nothing uploaded.';
  g.fillText(foot.length > 110 ? foot.slice(0, 109) + '…' : foot, 64, 580);
  return canvas;
}

function downloadImage(withSites) {
  if (!numbers) return;
  drawDayImage(numbers, withSites).toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'my-claude-code-day.png' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
