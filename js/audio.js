// ガラスの効果音（前の試作「ガラス玉マンカラ」の合成音を土台にしたもの）
(function (BM) {
'use strict';
let AC = null, master = null, verb = null, noiseBuf = null;
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0, 2349.32, 2637.02, 3135.96, 3520.0];
const GLASS = [[1, 1, 1], [2.76, 0.45, 0.55], [5.4, 0.2, 0.3], [8.93, 0.08, 0.18]];

// iPhone は pointerup / click の中でしか音を起こせないので、そこから呼ぶ
function wake() {
  try {
    if (!AC) {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      const comp = AC.createDynamicsCompressor();
      comp.connect(AC.destination);
      master = AC.createGain();
      master.gain.value = 0.8;
      master.connect(comp);
      verb = AC.createConvolver();
      const len = Math.floor(AC.sampleRate * 2.4), buf = AC.createBuffer(2, len, AC.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      verb.buffer = buf;
      const vg = AC.createGain();
      vg.gain.value = 0.28;
      verb.connect(vg);
      vg.connect(comp);
      noiseBuf = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.6), AC.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (AC.state !== 'running') AC.resume();
  } catch (err) { AC = null; }
}

function tone(f, vol, when, len, partials) {
  if (!AC || AC.state !== 'running') return;
  const t = AC.currentTime + (when || 0);
  const out = AC.createGain();
  out.gain.value = vol;
  out.connect(master);
  out.connect(verb);
  for (const [m, a, dl] of partials) {
    if (f * m > 16000) continue;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine';
    o.frequency.value = f * m;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len * dl);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + len * dl + 0.05);
  }
}
const chime = (f, vol, when, len) => tone(f, vol, when, len || 1.4, GLASS);
function noise(vol, f, q, dur, when, type) {
  if (!AC || AC.state !== 'running') return;
  const t = AC.currentTime + (when || 0);
  const src = AC.createBufferSource(), fl = AC.createBiquadFilter(), g = AC.createGain();
  src.buffer = noiseBuf;
  fl.type = type || 'bandpass';
  fl.frequency.value = f;
  fl.Q.value = q;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl);
  fl.connect(g);
  g.connect(master);
  g.connect(verb);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const SE = {
  select: () => chime(1568, 0.05, 0, 0.4),
  nope: () => tone(220, 0.06, 0, 0.15, [[1, 1, 1]]),
  pick: () => noise(0.1, 2600, 1.2, 0.08),
  drop: (i, goal) => {
    noise(0.14, 4200, 3, 0.03);
    const f = PENTA[Math.min(i, PENTA.length - 1)];
    tone(f, goal ? 0.07 : 0.05, 0.004, 0.45, [[1, 1, 1], [2.76, 0.35, 0.4], [5.4, 0.15, 0.2]]);
  },
  extra: () => [0, 2, 4, 7].forEach((n, k) => chime(PENTA[n + 3], 0.08, k * 0.06, 1)),
  capture: () => { noise(0.18, 1800, 0.7, 0.35, 0, 'lowpass'); [4, 6, 9].forEach((n, k) => chime(PENTA[n], 0.1, 0.05 + k * 0.05)); },
  launch: () => noise(0.14, 3000, 0.6, 0.4),
  hit: big => {
    noise(0.3, 160, 0.7, 0.3, 0, 'lowpass');
    noise(0.22, 5200, 0.8, 0.3, 0.01);
    for (let k = 0; k < (big ? 12 : 6); k++) chime(2400 + Math.random() * 3000, 0.022, 0.02 + Math.random() * 0.3, 0.3);
  },
  hurt: () => { noise(0.35, 120, 0.6, 0.45, 0, 'lowpass'); tone(110, 0.12, 0, 0.4, [[1, 1, 1], [1.5, 0.4, 0.6]]); },
  tech: () => { noise(0.15, 900, 0.8, 0.6, 0, 'lowpass'); [9, 7, 5].forEach((n, k) => chime(PENTA[n] / 2, 0.07, k * 0.08, 0.8)); },
  skill: () => [0, 4, 7, 9, 11].forEach((n, k) => chime(PENTA[n], 0.08, k * 0.05, 1.2)),
  heal: () => [4, 7, 9].forEach((n, k) => chime(PENTA[n], 0.07, k * 0.1, 1.6)),
  kill: () => { noise(0.25, 3000, 0.5, 0.6); for (let k = 0; k < 14; k++) chime(1800 + Math.random() * 3500, 0.025, Math.random() * 0.5, 0.5); },
  floor: () => [0, 2, 4, 7, 9].forEach((n, k) => chime(PENTA[n], 0.07, k * 0.07, 1.2)),
  win: () => [0, 2, 4, 5, 7, 9].forEach((n, k) => chime(PENTA[n], 0.12, k * 0.1, 1.8)),
  lose: () => [7, 4, 2, 0].forEach((n, k) => chime(PENTA[n] / 2, 0.12, k * 0.14, 1.6)),
  fall: () => noise(0.05, 4000, 3, 0.03),
};

BM.audio = { wake, SE, ctx: () => AC, out: () => master, noise: () => noiseBuf };
})(globalThis.BM = globalThis.BM || {});
