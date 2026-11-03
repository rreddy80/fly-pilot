// Leaky integrate-and-fire model of the FlyWire connectome, after Shiu et al. 2024 (Nature).
// Event-driven: only neurons with non-resting state are integrated each step.
function decodeGraph(buf) {
  const h = new Uint32Array(buf.buffer, buf.byteOffset, 5);
  const N = h[0], E = h[1], nc = h[2], nd = h[3];
  let p = 20;
  const rowPtr = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) {
    let v = 0, s = 0, b;
    do { b = buf[p++]; v += (b & 127) * 2 ** s; s += 7; } while (b & 128);
    rowPtr[i + 1] = rowPtr[i] + v;
  }
  const post = new Uint32Array(E);
  p = 20 + nc;
  for (let i = 0; i < N; i++) {
    let prev = 0;
    for (let e = rowPtr[i]; e < rowPtr[i + 1]; e++) {
      let v = 0, s = 0, b;
      do { b = buf[p++]; v += (b & 127) * 2 ** s; s += 7; } while (b & 128);
      prev = e === rowPtr[i] ? v : prev + v;
      post[e] = prev;
    }
  }
  const w = new Int16Array(E);
  p = 20 + nc + nd;
  for (let e = 0; e < E; e++) {
    let v = 0, s = 0, b;
    do { b = buf[p++]; v += (b & 127) * 2 ** s; s += 7; } while (b & 128);
    w[e] = (v & 1) ? -((v + 1) / 2) : v / 2;
  }
  return { N, E, rowPtr, post, w };
}

function createSim(graph, opts = {}) {
  const { N, rowPtr, post, w } = graph;
  const dt = 0.1, tm = 20, tau = 5, vth = 7, wSyn = 0.275, tRef = 2.2;
  const D = 18; // 1.8 ms synaptic delay in steps
  const a = Math.exp(-dt / tm), c = Math.exp(-dt / tau), b = (tau / (tau - tm)) * (c - a);
  const u = new Float32Array(N), g = new Float32Array(N), ref = new Float32Array(N);
  const isActive = new Uint8Array(N), active = new Int32Array(N);
  let nActive = 0;
  const silenced = new Uint8Array(N);
  const stimRate = new Float32Array(N); let stimList = [];
  const ring = Array.from({ length: D }, () => []);
  const spikeCount = new Uint16Array(N);
  let t = 0, step = 0, rng = opts.seed || 12345;
  const rand = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };

  const log = opts.onSpike;
  function fire(i, out) { out.push(i); spikeCount[i]++; if (log) log.push(i); }

  function advance(nSteps) {
    let spikes = 0;
    for (let k = 0; k < nSteps; k++) {
      const slot = ring[step % D];
      // deliver spikes emitted D steps ago
      for (let s = 0; s < slot.length; s++) {
        const i = slot[s];
        for (let e = rowPtr[i], end = rowPtr[i + 1]; e < end; e++) {
          const j = post[e];
          g[j] += w[e] * wSyn;
          if (!isActive[j]) { isActive[j] = 1; active[nActive++] = j; }
        }
      }
      slot.length = 0;
      const out = slot;
      // integrate active neurons
      for (let n = 0; n < nActive; n++) {
        const i = active[n];
        if (ref[i] > t) continue;
        const ui = u[i], gi = g[i];
        const un = a * ui + b * gi, gn = c * gi;
        if (un > vth && !silenced[i]) { u[i] = 0; g[i] = 0; ref[i] = t + tRef; fire(i, out); continue; }
        if (un < 1e-3 && un > -1e-3 && gn < 1e-3 && gn > -1e-3) {
          u[i] = 0; g[i] = 0; isActive[i] = 0; active[n] = active[--nActive]; n--; continue;
        }
        u[i] = un; g[i] = gn;
      }
      // Poisson drive to stimulated neurons
      for (let s = 0; s < stimList.length; s++) {
        const i = stimList[s];
        if (!silenced[i] && rand() < stimRate[i] * dt * 1e-3) { u[i] = 0; g[i] = 0; fire(i, out); }
      }
      spikes += out.length;
      step++; t += dt;
    }
    return spikes;
  }

  return {
    advance, spikeCount, silenced,
    get t() { return t; }, get nActive() { return nActive; },
    stimulate(ids, rate) { for (const i of ids) { if (!stimRate[i]) stimList.push(i); stimRate[i] = rate; } },
    clearStim() { for (const i of stimList) stimRate[i] = 0; stimList = []; },
    get stimList() { return stimList; },
    reset() { u.fill(0); g.fill(0); ref.fill(0); isActive.fill(0); nActive = 0; ring.forEach(r => (r.length = 0)); t = 0; step = 0; },
  };
}
if (typeof module !== 'undefined') module.exports = { decodeGraph, createSim };
