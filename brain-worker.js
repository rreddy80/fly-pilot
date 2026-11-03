// Runs the closed loop off the main thread: senses -> fly brain -> motor decoder -> rover, every 5 ms of brain time.
importScripts('sim.js', 'world.js');

const FRAME_MS = 5;
let sim, pilot, world, meter, log = [];
let paused = false, autoSwat = true, nextSwat = 4, seed = 7;
const knockouts = new Set();

async function load() {
  const [gz, pj] = await Promise.all([
    fetch('data/graph.bin.gz').then((r) => r.arrayBuffer()),
    fetch('data/pilot.json').then((r) => r.json()),
  ]);
  let bytes = new Uint8Array(gz);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(s).arrayBuffer());
  }
  pilot = pj;
  const G = decodeGraph(bytes);
  sim = createSim(G, { onSpike: log, seed });
  reset();
  postMessage({ type: 'ready', pilot });
  tick();
}

function reset() {
  sim.reset();
  world = FlyPilot.createWorld(seed);
  meter = FlyPilot.createRateMeter(pilot.outputs);
  nextSwat = 4;
}

function applyKnockouts() {
  sim.silenced.fill(0);
  for (const k of knockouts) for (const i of pilot.knockouts[k]) sim.silenced[i] = 1;
}

let spikesOut = [], lastPost = 0, wallStart = performance.now(), brainStart = 0;
function tick() {
  const start = performance.now();
  if (!paused) {
    // Run as many 5 ms brain frames as fit in ~14 ms of wall time, but never faster than real time.
    const realElapsed = (start - wallStart) / 1000;
    while (performance.now() - start < 14 && world.t - brainStart < realElapsed) {
      const s = FlyPilot.sense(world, FRAME_MS / 1000);
      sim.clearStim();
      for (const k in s) if (s[k] > 0.5) sim.stimulate(pilot.sensors[k], s[k]);
      log.length = 0;
      sim.advance(FRAME_MS * 10);
      for (let n = 0; n < log.length; n++) spikesOut.push(log[n]);
      meter.add(log, sim.t, FRAME_MS);
      FlyPilot.step(world, FRAME_MS / 1000, meter.rates());
      if (autoSwat && world.t > nextSwat) { world.addThreat(); nextSwat = world.t + 7; }
    }
    if (world.t - brainStart < realElapsed - 0.5) { brainStart = world.t; wallStart = performance.now(); } // fell behind: don't try to catch up
  } else { wallStart = performance.now(); brainStart = world.t; }

  if (start - lastPost > 30) {
    lastPost = start;
    const spikes = Int32Array.from(spikesOut); spikesOut = [];
    const r = world.rover;
    postMessage({
      type: 'frame', spikes,
      t: world.t,
      rover: { x: r.x, y: r.y, h: r.h, v: r.v, state: r.state, trail: r.trail },
      pillars: world.pillars.map((p) => ({ x: p.x, y: p.y, r: p.r })),
      threats: world.threats.map((t) => ({ x: t.x, y: t.y, r: t.r, rEnd: t.rEnd, landed: !!t.landed, hit: !!t.hit })),
      food: world.food && { x: world.food.x, y: world.food.y, r: world.food.r, left: world.food.left },
      stats: world.stats, events: world.events.slice(-8),
      sensors: world.sensors, rates: meter.rates(), cmd: world.cmd,
    }, [spikes.buffer]);
  }
  setTimeout(tick, 4);
}

onmessage = (e) => {
  const m = e.data;
  if (!world) return;
  if (m.type === 'swat') world.addThreat(m.x, m.y);
  else if (m.type === 'pillar') world.addPillar(m.x, m.y);
  else if (m.type === 'food') world.placeFood(m.x, m.y);
  else if (m.type === 'pause') paused = m.on;
  else if (m.type === 'autoSwat') autoSwat = m.on;
  else if (m.type === 'knockout') { m.on ? knockouts.add(m.key) : knockouts.delete(m.key); applyKnockouts(); }
  else if (m.type === 'reset') { seed = m.seed ?? seed; reset(); applyKnockouts(); wallStart = performance.now(); brainStart = 0; }
};

load().catch((err) => postMessage({ type: 'error', message: err.message }));
