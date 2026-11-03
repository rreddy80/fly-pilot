// Runs the closed loop (brain + rover) without a browser and reports what the rover did.
// Usage: node tools/headless.js [seconds] [seed]
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const { decodeGraph, createSim } = require('../sim.js');
const FP = require('../world.js');
const dir = path.join(__dirname, '..', 'data');
const G = decodeGraph(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'graph.bin.gz')))));
const pilot = JSON.parse(fs.readFileSync(path.join(dir, 'pilot.json')));
const seconds = +(process.argv[2] || 30), seed = +(process.argv[3] || 7);

const log = [], sim = createSim(G, { onSpike: log, seed });
const w = FP.createWorld(seed), meter = FP.createRateMeter(pilot.outputs);
const FRAME_MS = 5, t0 = Date.now();
let nextThreat = 6, lastLog = 0;
while (w.t < seconds) {
  const s = FP.sense(w, FRAME_MS / 1000);
  sim.clearStim();
  for (const k in s) if (s[k] > 0.5) sim.stimulate(pilot.sensors[k], s[k]);
  log.length = 0;
  sim.advance(FRAME_MS * 10);
  meter.add(log, sim.t, FRAME_MS);
  FP.step(w, FRAME_MS / 1000, meter.rates());
  if (w.t > nextThreat) { w.addThreat(); nextThreat += 6; }
  if (w.t - lastLog >= 2) {
    lastLog = w.t; const r = w.rover, rt = meter.rates();
    const df = w.food ? Math.hypot(w.food.x - r.x, w.food.y - r.y).toFixed(1) : '-';
    console.log(`t=${w.t.toFixed(1)}s state=${r.state.padEnd(7)} food@${df}cm up L${rt.upwind_left.toFixed(0)}/R${rt.upwind_right.toFixed(0)} avoid L${rt.avoid_left.toFixed(0)}/R${rt.avoid_right.toFixed(0)} GF ${((rt.escape_left + rt.escape_right) / 2).toFixed(0)} feed ${((rt.feed_left + rt.feed_right) / 2).toFixed(0)}`);
  }
}
console.log('stats', JSON.stringify(w.stats), `wall ${(Date.now() - t0) / 1000}s for ${seconds}s brain time`);
console.log(w.events.map((e) => `${e.t.toFixed(1)}s ${e.text}`).join('\n'));
