// Draws the arena and the live brain, and forwards clicks and knockouts to the closed loop in brain-worker.js.
const $ = (s) => document.querySelector(s);
const P = FlyPilot.P;

const SENSES = [
  { name: 'Looming in eyes', who: 'LC4', l: 'LC4_left', r: 'LC4_right', max: 100 },
  { name: 'Fast looming', who: 'LPLC2', l: 'LPLC2_left', r: 'LPLC2_right', max: 200 },
  { name: 'Air on antennae', who: "Johnston's organ", l: 'wind_left', r: 'wind_right', max: P.windRate },
  { name: 'Sugar on legs', who: 'taste neurons', l: 'sugar', r: 'sugar', max: P.sugarRate },
];
const OUTPUTS = [
  { name: 'Turn away', who: 'DNp04, DNp02, DNp11…', l: 'avoid_left', r: 'avoid_right', max: 250 },
  { name: 'Turn upwind', who: 'DNge091, DNb06, DNp18…', l: 'upwind_left', r: 'upwind_right', max: 40 },
  { name: 'Escape', who: 'giant fiber DNp01', l: 'escape_left', r: 'escape_right', max: 250 },
  { name: 'Feed', who: 'MN9, MN10', l: 'feed_left', r: 'feed_right', max: 150 },
];
const KNOCKOUTS = [
  { key: 'giant_fiber', name: 'Giant fiber', what: 'The 2 escape command neurons. Watch the swats land.' },
  { key: 'wind', name: 'Wind-steering neurons', what: '41 descending neurons. It can feel the air but stops heading upwind.' },
  { key: 'lc4', name: 'LC4 looming detectors', what: '104 visual neurons. It stops turning away from pillars.' },
  { key: 'feeding', name: 'Feeding motor neurons', what: 'MN9 and MN10. It walks over the sugar without eating.' },
];
const STATE_LABEL = { explore: 'Exploring', escape: 'Escaping!', feed: 'Feeding' };

let frame = null, ready = false, tool = 'swat', paused = false;
const worker = new Worker('brain-worker.js');

// ---------- brain view ----------
const bc = $('#brain'), bctx = bc.getContext('2d');
const bbase = document.createElement('canvas');
let N = 0, BX, BY, heat, hotFlag, hot, nHot = 0, inputFlag, pilot;
async function loadBrainView() {
  const [meta, raw] = await Promise.all([
    fetch('data/meta.json').then((r) => r.json()),
    fetch('data/neurons.bin.gz').then((r) => r.arrayBuffer()),
  ]);
  let u8 = new Uint8Array(raw);
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  N = meta.N;
  const q = new Int16Array(u8.buffer, 0, N * 3), sc = new Uint8Array(u8.buffer, 6 * N, N);
  BX = new Float32Array(N); BY = new Float32Array(N);
  for (let i = 0; i < N; i++) { BX[i] = q[3 * i] / 50; BY[i] = q[3 * i + 1] / 50; }
  heat = new Float32Array(N); hotFlag = new Uint8Array(N); hot = new Int32Array(N); inputFlag = new Uint8Array(N);
  window.__sc = { sc, names: meta.superClasses };
  sizeBrain();
}
let bs = 1, bW = 0, bH = 0, dpr = 1;
function sizeBrain() {
  if (!N) return;
  dpr = Math.min(devicePixelRatio || 1, 2);
  const r = bc.getBoundingClientRect();
  bW = bc.width = bbase.width = Math.round(r.width * dpr);
  bH = bc.height = bbase.height = Math.round(r.height * dpr);
  bs = Math.min(bW / 860, bH / 420);
  const g = bbase.getContext('2d'), img = g.createImageData(bW, bH), acc = new Float32Array(bW * bH);
  const { sc, names } = window.__sc;
  const optic = names.indexOf('optic');
  for (let i = 0; i < N; i++) {
    const x = (bW / 2 + BX[i] * bs) | 0, y = (bH / 2 + BY[i] * bs) | 0;
    if (x >= 0 && y >= 0 && x < bW && y < bH) acc[y * bW + x] += sc[i] === optic ? 0.6 : 1;
  }
  for (let p = 0; p < acc.length; p++) if (acc[p]) {
    const k = 1 - Math.exp(-acc[p] * 0.35);
    img.data[p * 4] = 60 * k + 10; img.data[p * 4 + 1] = 82 * k + 14; img.data[p * 4 + 2] = 140 * k + 24; img.data[p * 4 + 3] = 255 * Math.min(1, k * 1.6);
  }
  g.putImageData(img, 0, 0);
}
function sprite(rgb, r) {
  const c = document.createElement('canvas'); c.width = c.height = r * 2;
  const g = c.getContext('2d'), grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,248,230,1)'); grd.addColorStop(0.3, `rgba(${rgb},0.85)`); grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, r * 2, r * 2); return c;
}
let sprOut, sprIn, sprR = 0;
function drawBrain(dtw) {
  if (!N) return;
  bctx.globalCompositeOperation = 'source-over';
  bctx.clearRect(0, 0, bW, bH);
  bctx.drawImage(bbase, 0, 0);
  const r = Math.max(2, Math.round(2.4 * dpr));
  if (r !== sprR) { sprR = r; sprOut = sprite('255,181,71', r); sprIn = sprite('98,211,255', r); }
  bctx.globalCompositeOperation = 'lighter';
  const f = Math.exp(-dtw / 280);
  for (let n = 0; n < nHot; n++) {
    const i = hot[n], h = (heat[i] *= f);
    if (h < 0.04) { hotFlag[i] = 0; heat[i] = 0; hot[n] = hot[--nHot]; n--; continue; }
    bctx.globalAlpha = Math.min(1, h);
    bctx.drawImage(inputFlag[i] ? sprIn : sprOut, bW / 2 + BX[i] * bs - r, bH / 2 + BY[i] * bs - r);
  }
  bctx.globalAlpha = 1;
}

// ---------- arena ----------
const ac = $('#arena'), actx = ac.getContext('2d');
let aW = 0, aH = 0, as = 1;
function sizeArena() {
  const r = ac.getBoundingClientRect();
  aW = ac.width = Math.round(r.width * dpr); aH = ac.height = Math.round(r.height * dpr);
  as = Math.min(aW, aH) / (2 * (P.arenaR + 3));
}
const toScreen = (x, y) => [aW / 2 + x * as, aH / 2 - y * as];
const toWorld = (sx, sy) => [(sx - aW / 2) / as, -(sy - aH / 2) / as];

const air = [];
function drawArena(dtw) {
  const g = actx; g.clearRect(0, 0, aW, aH);
  const [cx, cy] = toScreen(0, 0);
  g.fillStyle = '#0a1120'; g.beginPath(); g.arc(cx, cy, P.arenaR * as, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1c2740'; g.lineWidth = 1 * dpr;
  for (let rr = 10; rr <= P.arenaR; rr += 10) { g.beginPath(); g.arc(cx, cy, rr * as, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = '#2c3b5c'; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(cx, cy, P.arenaR * as, 0, Math.PI * 2); g.stroke();
  // scale bar
  g.fillStyle = '#8390ab'; g.font = `${11 * dpr}px "JetBrains Mono", monospace`;
  g.fillRect(aW - 24 * dpr - 10 * as, aH - 20 * dpr, 10 * as, 2 * dpr); g.fillText('10 cm', aW - 24 * dpr - 10 * as, aH - 26 * dpr);
  if (!frame) return;

  // air flowing out of the fan behind the sugar
  const fd = frame.food, dts = Math.min(dtw, 50) / 1000;
  if (fd) for (let k = 0; k < 4; k++) { const a = Math.random() * Math.PI * 2; air.push({ x: fd.x + Math.cos(a) * 2, y: fd.y + Math.sin(a) * 2, a, life: 1 }); }
  g.strokeStyle = 'rgba(98,211,255,0.22)'; g.lineWidth = 1 * dpr;
  for (let k = air.length - 1; k >= 0; k--) {
    const p = air[k]; p.life -= dts * 0.45;
    const nx = p.x + Math.cos(p.a) * 14 * dts, ny = p.y + Math.sin(p.a) * 14 * dts;
    if (p.life <= 0 || Math.hypot(nx, ny) > P.arenaR) { air.splice(k, 1); continue; }
    const [x1, y1] = toScreen(p.x, p.y), [x2, y2] = toScreen(nx + Math.cos(p.a) * 0.8, ny + Math.sin(p.a) * 0.8);
    g.globalAlpha = p.life; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    p.x = nx; p.y = ny;
  }
  g.globalAlpha = 1;

  if (fd) {
    const [x, y] = toScreen(fd.x, fd.y), k = 0.4 + 0.6 * Math.max(0, fd.left) / P.mealTime;
    g.fillStyle = 'rgba(230,245,255,0.95)'; g.beginPath(); g.arc(x, y, fd.r * as * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(98,211,255,0.6)'; g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(x, y, (fd.r + 0.8) * as, 0, Math.PI * 2); g.stroke();
  }
  for (const p of frame.pillars) {
    const [x, y] = toScreen(p.x, p.y);
    g.fillStyle = '#1b2539'; g.strokeStyle = '#34466b'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.arc(x, y, p.r * as, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  // trail
  const tr = frame.rover.trail;
  g.strokeStyle = 'rgba(255,181,71,0.35)'; g.lineWidth = 1.2 * dpr; g.beginPath();
  tr.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); }); g.stroke();
  drawRover(g);
  for (const t of frame.threats) {
    const [x, y] = toScreen(t.x, t.y);
    const f = t.r / t.rEnd;
    g.fillStyle = t.landed ? (t.hit ? 'rgba(255,93,114,0.55)' : 'rgba(131,144,171,0.35)') : `rgba(0,0,0,${0.25 + 0.5 * f})`;
    g.beginPath(); g.arc(x, y, t.r * as, 0, Math.PI * 2); g.fill();
    g.strokeStyle = t.landed ? (t.hit ? '#ff5d72' : '#8390ab') : 'rgba(255,93,114,0.5)'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.arc(x, y, t.rEnd * as, 0, Math.PI * 2); g.setLineDash([4 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]);
  }
}
function drawRover(g) {
  const r = frame.rover, [x, y] = toScreen(r.x, r.y), s = as, sn = frame.sensors;
  g.save(); g.translate(x, y); g.rotate(-r.h);
  // what each eye is seeing loom: tinted view cones
  for (const [side, key] of [[1, 'LC4_left'], [-1, 'LC4_right']]) {
    const a = Math.min(1, (sn[key] || 0) / 100);
    if (a < 0.03) continue;
    g.fillStyle = `rgba(98,211,255,${0.28 * a})`;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 9 * s, side > 0 ? -2.6 : 0, side > 0 ? 0 : 2.6, false); g.closePath(); g.fill();
  }
  if (r.state === 'escape') { g.fillStyle = 'rgba(255,181,71,0.25)'; g.fillRect(-5 * s, -1 * s, 4 * s, 2 * s); }
  g.fillStyle = r.state === 'escape' ? '#ffb547' : '#e4e9f4';
  g.beginPath(); g.ellipse(0, 0, 1.6 * s, 1 * s, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c0533f';
  g.beginPath(); g.arc(1.1 * s, -0.65 * s, 0.45 * s, 0, Math.PI * 2); g.arc(1.1 * s, 0.65 * s, 0.45 * s, 0, Math.PI * 2); g.fill();
  if (r.state === 'feed') { g.strokeStyle = '#62d3ff'; g.lineWidth = 2 * dpr; g.beginPath(); g.moveTo(1.6 * s, 0); g.lineTo(2.6 * s, 0); g.stroke(); }
  g.restore();
}

// ---------- panels ----------
function bars(el, defs, cls) {
  el.className = 'bars ' + cls;
  el.innerHTML = defs.map((d, k) => `<div class="bar" data-k="${k}"><span>${d.name}</span><span class="v">–</span><span class="lr"><i><b></b></i><i><b></b></i></span></div>`).join('');
  defs.forEach((d, k) => (el.children[k].title = d.who));
}
bars($('#senses'), SENSES, 'in');
bars($('#outputs'), OUTPUTS, 'out');
function updateBars(el, defs, src) {
  defs.forEach((d, k) => {
    const row = el.children[k], L = src[d.l] || 0, R = src[d.r] || 0;
    row.querySelector('.v').textContent = d.l === d.r ? `${L.toFixed(0)} Hz` : `L ${L.toFixed(0)} · R ${R.toFixed(0)}`;
    const [bl, br] = row.querySelectorAll('b');
    bl.style.width = Math.min(100, (100 * L) / d.max) + '%'; br.style.width = Math.min(100, (100 * R) / d.max) + '%';
  });
}
$('#kos').innerHTML = KNOCKOUTS.map((k) => `<button class="ko" data-key="${k.key}" aria-pressed="false"><strong>${k.name}</strong><small>${k.what}</small><em>on</em></button>`).join('');
document.querySelectorAll('.ko').forEach((b) => b.addEventListener('click', () => {
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', String(on)); b.querySelector('em').textContent = on ? 'silenced' : 'on';
  worker.postMessage({ type: 'knockout', key: b.dataset.key, on });
}));
let lastUi = 0, lastBrainT = 0, lastWallT = 0, ratio = 0;
function updatePanels(now) {
  if (!frame || now - lastUi < 120) return;
  lastUi = now;
  updateBars($('#senses'), SENSES, frame.sensors);
  updateBars($('#outputs'), OUTPUTS, frame.rates);
  $('#t').textContent = frame.t.toFixed(1);
  if (lastWallT) ratio = ratio * 0.8 + 0.2 * ((frame.t - lastBrainT) / ((now - lastWallT) / 1000));
  lastBrainT = frame.t; lastWallT = now;
  $('#speed').textContent = paused ? 'paused' : `running at ${ratio >= 0.95 ? 'real time' : ratio.toFixed(2) + '× real time'}`;
  const r = frame.rover, c = frame.cmd;
  $('#state').textContent = STATE_LABEL[r.state] || r.state;
  const turn = c.turn || 0;
  $('#cmd').textContent = `${Math.abs(turn) < 0.15 ? 'straight' : turn > 0 ? `turning left ${turn.toFixed(1)}` : `turning right ${(-turn).toFixed(1)}`}${Math.abs(turn) < 0.15 ? '' : ' rad/s'} · ${r.v.toFixed(1)} cm/s`;
  const st = frame.stats;
  $('#stats').innerHTML = [['meals', 'sugar drops eaten'], ['escapes', 'escape dashes'], ['caught', 'times swatted'], ['bumps', 'bumps']].map(([k, l]) => `<div><b>${st[k]}</b><span>${l}</span></div>`).join('');
  $('#events').innerHTML = frame.events.slice().reverse().map((e) => `<li><b>${e.t.toFixed(1)}s</b>${e.text}</li>`).join('');
}

// ---------- loop & input ----------
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') { ready = true; pilot = m.pilot; $('#loader').hidden = true; }
  else if (m.type === 'error') $('#loader').textContent = `Couldn't start the brain: ${m.message}. Serve this folder over http (see README).`;
  else if (m.type === 'frame') {
    frame = m;
    if (N && pilot) {
      inputFlag.fill(0);
      for (const k in m.sensors) if (m.sensors[k] > 0.5) for (const i of pilot.sensors[k]) inputFlag[i] = 1;
      for (const i of m.spikes) { heat[i] = 1; if (!hotFlag[i]) { hotFlag[i] = 1; hot[nHot++] = i; } }
    }
  }
};
let lastT = performance.now();
function loop(now) {
  const dtw = now - lastT; lastT = now;
  drawArena(dtw); drawBrain(dtw); updatePanels(now);
  requestAnimationFrame(loop);
}
ac.addEventListener('click', (e) => {
  if (!ready) return;
  const r = ac.getBoundingClientRect(), [x, y] = toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  if (Math.hypot(x, y) > P.arenaR) return;
  worker.postMessage({ type: tool, x, y });
});
document.querySelectorAll('.toolbar button').forEach((b) => b.addEventListener('click', () => {
  tool = b.dataset.tool;
  document.querySelectorAll('.toolbar button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
}));
$('#autoswat').addEventListener('change', (e) => worker.postMessage({ type: 'autoSwat', on: e.target.checked }));
$('#pause').addEventListener('click', () => { paused = !paused; $('#pause').textContent = paused ? 'Resume' : 'Pause'; worker.postMessage({ type: 'pause', on: paused }); });
$('#reset').addEventListener('click', () => worker.postMessage({ type: 'reset', seed: (Math.random() * 1e9) | 0 }));
new ResizeObserver(() => { dpr = Math.min(devicePixelRatio || 1, 2); sizeArena(); sizeBrain(); }).observe(document.body);
dpr = Math.min(devicePixelRatio || 1, 2); sizeArena();
loadBrainView();
requestAnimationFrame(loop);
