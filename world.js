// Arena, rover body, sensors and motor decoder for Fly Pilot.
// The brain (sim.js) never sees any of this directly: the rover turns what it senses into
// firing rates for real sensory neurons, and reads its wheel commands from real descending neurons.
(function (root) {
  const TAU = Math.PI * 2;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // Tuning for the sensor encoders and the motor decoder.
  const P = {
    arenaR: 40,          // cm
    roverR: 1.2,
    cruise: 15,           // cm/s
    escapeSpeed: 32,
    escapeTime: 0.3,     // s
    lc4Gain: 140,        // Hz per rad/s of looming
    lplc2Gain: 120, lplc2Thresh: 3,
    windRate: 130,       // Hz at full deflection
    sugarRate: 150,
    kUpwind: 0.15,       // rad/s turn per Hz difference
    upwindBias: 3.5,     // Hz: the right-side wind neurons fire a little more for equal input (measured)
    kAvoid: 0.05,
    wander: 0.4,         // rad/s, random wander added by the rover itself
    escapeHz: 120, feedHz: 25, // LC4 alone drives the giant fiber to ~80 Hz; a real swat (LPLC2) pushes it past 150
    mealTime: 2.5,       // s of feeding to finish a drop
    contactSlow: 0.3,    // speed factor while the legs touch sugar, so MN9 has time to fire on a glancing pass
  };

  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

  function createWorld(seed = 7) {
    const rand = rng(seed);
    const w = {
      P, t: 0,
      rover: { x: 0, y: -20, h: Math.PI / 2, v: 0, turn: 0, wander: 0, state: 'explore', stateT: 0, cooldown: 0, eat: 0, trail: [] },
      pillars: [], threats: [], food: null,
      stats: { meals: 0, escapes: 0, bumps: 0, caught: 0 },
      events: [],
      sensors: {}, cmd: { turn: 0, speed: 0 }, rand,
    };
    const ok = (x, y, clear) => Math.hypot(x, y) < P.arenaR - 4 && w.pillars.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + clear);
    for (let k = 0; k < 7; k++) {
      for (let tries = 0; tries < 50; tries++) {
        const a = rand() * TAU, d = 8 + rand() * 26, x = Math.cos(a) * d, y = Math.sin(a) * d;
        if (ok(x, y, 6) && Math.hypot(x - w.rover.x, y - w.rover.y) > 8) { w.pillars.push({ x, y, r: 2 + rand() * 2.5 }); break; }
      }
    }
    w.placeFood = (x, y) => {
      // Sugar dropped on a pillar slides off to its edge, where the rover can still reach it.
      for (const p of w.pillars) {
        let dx = x - p.x, dy = y - p.y, dd = Math.hypot(dx, dy);
        if (dd < 1e-3) { const c = Math.hypot(p.x, p.y); [dx, dy, dd] = c ? [-p.x / c, -p.y / c, 1] : [1, 0, 1]; } // dead centre: push toward the arena centre
        const min = p.r + 2.1;
        if (dd < min) { x = p.x + dx / dd * min; y = p.y + dy / dd * min; }
      }
      w.food = { x, y, r: 1.6, left: P.mealTime };
    };
    w.spawnFood = () => {
      for (let tries = 0; tries < 200; tries++) {
        const a = rand() * TAU, d = rand() * (P.arenaR - 6), x = Math.cos(a) * d, y = Math.sin(a) * d;
        if (ok(x, y, 4) && Math.hypot(x - w.rover.x, y - w.rover.y) > 22) return w.placeFood(x, y);
      }
      w.placeFood(0, 0);
    };
    w.addThreat = (x, y) => {
      const r = w.rover;
      if (x === undefined) { const a = rand() * TAU; x = r.x + Math.cos(a) * 2.5; y = r.y + Math.sin(a) * 2.5; }
      // A swat is a hand coming down from above: its shadow grows, then it lands.
      w.threats.push({ x, y, r: 0.6, rEnd: 4.5, T: 0.6, age: 0 });
    };
    w.addPillar = (x, y) => { if (ok(x, y, 2) && Math.hypot(x - w.rover.x, y - w.rover.y) > 5) w.pillars.push({ x, y, r: 3 }); };
    w.spawnFood();
    return w;
  }

  // Angular expansion of every object, split by which eye sees it.
  function looming(w, dt) {
    const r = w.rover; let L = 0, R = 0;
    for (const o of [...w.pillars, ...w.threats]) {
      const dx = o.x - r.x, dy = o.y - r.y;
      const d = Math.max(0.3, Math.hypot(dx, dy) - o.r - P.roverR);
      const th = 2 * Math.atan(o.r / d);
      const rate = o.prevTh === undefined || dt <= 0 ? 0 : (th - o.prevTh) / dt;
      o.prevTh = th;
      const bearing = wrap(Math.atan2(dy, dx) - r.h);
      if (Math.abs(bearing) > 2.6 || rate < 0.1) continue; // blind spot behind, and receding objects
      if (bearing > 0) L += rate; else R += rate;
    }
    return { L, R };
  }

  // Sensor encoder: world -> firing rate (Hz) for each sensory neuron group.
  function sense(w, dt) {
    const r = w.rover, loom = looming(w, dt);
    const s = {};
    s.LC4_left = clamp(P.lc4Gain * loom.L, 0, 100);
    s.LC4_right = clamp(P.lc4Gain * loom.R, 0, 100);
    s.LPLC2_left = clamp(P.lplc2Gain * (loom.L - P.lplc2Thresh), 0, 200);
    s.LPLC2_right = clamp(P.lplc2Gain * (loom.R - P.lplc2Thresh), 0, 200);
    // A fan behind the sugar blows outward, so the air always comes from the food.
    if (w.food) {
      const from = wrap(Math.atan2(w.food.y - r.y, w.food.x - r.x) - r.h); // + = air arriving from the left
      s.wind_left = P.windRate * clamp(0.5 + Math.sin(from), 0, 1);
      s.wind_right = P.windRate * clamp(0.5 - Math.sin(from), 0, 1);
      s.sugar = Math.hypot(w.food.x - r.x, w.food.y - r.y) < w.food.r + P.roverR ? P.sugarRate : 0;
    } else { s.wind_left = s.wind_right = s.sugar = 0; }
    w.sensors = s; w.loom = loom;
    return s;
  }

  // Motor decoder: mean firing rate (Hz) of each descending-neuron group -> wheel command.
  function decode(rates) {
    const up = rates.upwind_left - rates.upwind_right + P.upwindBias;
    const av = rates.avoid_left - rates.avoid_right;
    return {
      upwindTurn: P.kUpwind * up,             // turn toward the side that feels the wind
      avoidTurn: -P.kAvoid * av,              // turn away from the side that sees looming
      slow: clamp((rates.avoid_left + rates.avoid_right) / 200, 0, 0.6),
      escape: (rates.escape_left + rates.escape_right) / 2 > P.escapeHz,
      escapeDir: av > 0 ? -1 : 1,
      feed: (rates.feed_left + rates.feed_right) / 2 > P.feedHz,
    };
  }

  function step(w, dt, rates) {
    const r = w.rover, d = decode(rates);
    w.t += dt; r.stateT += dt; r.cooldown -= dt;
    r.wander += (-r.wander * 2 + (w.rand() * 2 - 1) * P.wander * 4) * dt;
    const onFood = w.food && w.sensors.sugar > 0;

    if (r.state === 'escape' && r.stateT > P.escapeTime) { r.state = 'explore'; r.stateT = 0; }
    if (r.state !== 'escape') {
      if (d.escape && r.cooldown <= 0) {
        r.state = 'escape'; r.stateT = 0; r.cooldown = 1;
        r.h += d.escapeDir * 2.0; w.stats.escapes++; w.events.push({ t: w.t, text: 'Giant fiber fired: escape dash' });
      } else if (d.feed && onFood) {
        if (r.state !== 'feed') w.events.push({ t: w.t, text: 'Sugar on the legs: MN9 fired, feeding' });
        r.state = 'feed';
      } else if (r.state === 'feed') { r.state = 'explore'; r.stateT = 0; }
    }

    if (r.state === 'escape') { r.v = P.escapeSpeed; r.turn = 0; }
    else if (r.state === 'feed') {
      r.v = 0; r.turn = 0;
      w.food.left -= dt;
      if (w.food.left <= 0) { w.stats.meals++; w.events.push({ t: w.t, text: 'Finished the sugar drop' }); w.spawnFood(); r.state = 'explore'; }
    } else {
      r.turn = d.upwindTurn + d.avoidTurn + r.wander;
      r.v = P.cruise * (1 - d.slow) * (onFood ? P.contactSlow : 1);
    }
    w.cmd = { turn: r.turn, speed: r.v, ...d };

    r.h = wrap(r.h + r.turn * dt);
    r.x += Math.cos(r.h) * r.v * dt; r.y += Math.sin(r.h) * r.v * dt;

    // Physical contact: slide off pillars and the arena wall.
    let bumped = false;
    for (const p of w.pillars) {
      const dx = r.x - p.x, dy = r.y - p.y, dd = Math.hypot(dx, dy), min = p.r + P.roverR;
      if (dd < min) { r.x = p.x + dx / dd * min; r.y = p.y + dy / dd * min; bumped = true; }
    }
    const rr = Math.hypot(r.x, r.y), lim = P.arenaR - P.roverR;
    if (rr > lim) { r.x *= lim / rr; r.y *= lim / rr; bumped = true; }
    if (bumped && !r.touching) w.stats.bumps++;
    r.touching = bumped;

    for (const th of w.threats) {
      th.age += dt;
      const f = Math.min(1, th.age / th.T);
      th.r = 0.6 + (th.rEnd - 0.6) * f * f;
      if (th.age >= th.T && !th.landed) {
        th.landed = true;
        const hit = Math.hypot(r.x - th.x, r.y - th.y) < th.rEnd + P.roverR;
        th.hit = hit;
        if (hit) w.stats.caught++;
        w.events.push({ t: w.t, text: hit ? 'Swatted' : 'Swat missed' });
      }
    }
    w.threats = w.threats.filter((t) => t.age < t.T + 0.25);

    const tr = r.trail, last = tr[tr.length - 1];
    if (!last || Math.hypot(last[0] - r.x, last[1] - r.y) > 0.4) { tr.push([r.x, r.y]); if (tr.length > 600) tr.shift(); }
    if (w.events.length > 30) w.events.splice(0, w.events.length - 30);
  }

  // Sliding-window firing rates for the decoder's output groups.
  function createRateMeter(outputs, windowMs = 60) {
    const groupOf = new Map(), names = Object.keys(outputs), frames = [];
    names.forEach((k) => outputs[k].forEach((i) => groupOf.set(i, k)));
    return {
      add(spikes, t, dt) {
        const c = {}; for (const i of spikes) { const g = groupOf.get(i); if (g) c[g] = (c[g] || 0) + 1; }
        frames.push({ t, dt, c });
        while (frames.length && frames[0].t < t - windowMs) frames.shift();
      },
      rates() {
        let span = 0; const sum = {};
        for (const f of frames) { span += f.dt; for (const k in f.c) sum[k] = (sum[k] || 0) + f.c[k]; }
        const out = {};
        for (const k of names) out[k] = span > 0 ? (sum[k] || 0) / (span / 1000) / outputs[k].length : 0;
        return out;
      },
    };
  }

  const api = { createWorld, sense, step, decode, createRateMeter, P };
  if (typeof module !== 'undefined') module.exports = api; else root.FlyPilot = api;
})(this);
