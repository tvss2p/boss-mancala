// BGM：その場で合成する短いループ（タイトル・ふつうのバトル・ボス戦）。音は audio.js の出口につなぐ
(function (BM) {
'use strict';
const A = BM.audio;
const hz = n => 440 * Math.pow(2, (n - 69) / 12);
// 和音は MIDI の音の番号。step は1拍に対する1歩の長さ
const SONGS = {
  title: { bpm: 78, step: 0.5, chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]], drums: 0, vol: 0.9 },
  battle: { bpm: 104, step: 0.5, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], drums: 1, vol: 0.8 },
  boss: { bpm: 128, step: 0.25, chords: [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]], drums: 2, vol: 0.8 },
};
let cur = null, timer = null, nextT = 0, n = 0, bus = null;
let on = true;
try { on = localStorage.getItem('bm_music') !== 'off'; } catch (err) { on = true; }

function ensure() {
  const AC = A.ctx();
  if (!AC) return null;
  if (!bus) {
    bus = AC.createGain();
    bus.gain.value = on ? 0.3 : 0;
    bus.connect(A.out());
  }
  return AC;
}
function env(AC, g, t, a, peak, dur, rel) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + Math.max(a, dur - rel));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function voice(AC, type, f, t, dur, peak, opt = {}) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.value = f;
  if (opt.detune) o.detune.value = opt.detune;
  let last = o;
  if (opt.lp) {
    const fl = AC.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = opt.lp;
    o.connect(fl);
    last = fl;
  }
  last.connect(g);
  g.connect(bus);
  env(AC, g, t, opt.a || 0.005, peak, dur, opt.rel || dur * 0.6);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function bell(AC, f, t, peak) {
  [[1, 1], [2.76, 0.35], [5.4, 0.12]].forEach(([m, k]) => voice(AC, 'sine', f * m, t, 0.9 / m + 0.2, peak * k, { rel: 0.6 }));
}
function kick(AC, t, peak) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  o.connect(g); g.connect(bus);
  env(AC, g, t, 0.003, peak, 0.22, 0.18);
  o.start(t); o.stop(t + 0.3);
}
function hiss(AC, t, f, q, dur, peak, type) {
  const nb = A.noise();
  if (!nb) return;
  const s = AC.createBufferSource(), fl = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = nb;
  fl.type = type || 'highpass';
  fl.frequency.value = f;
  fl.Q.value = q;
  s.connect(fl); fl.connect(g); g.connect(bus);
  env(AC, g, t, 0.002, peak, dur, dur * 0.8);
  s.start(t); s.stop(t + dur + 0.05);
}

function step(AC, S, i, t, spb) {
  const per = Math.round(4 / S.step), bar = Math.floor(i / per), pos = i % per, ch = S.chords[bar % S.chords.length];
  const len = spb * S.step, v = S.vol;
  if (pos === 0) {
    ch.forEach(m => {
      voice(AC, 'sawtooth', hz(m), t, spb * 4, 0.018 * v, { lp: 1100, a: 0.35, rel: 1.2, detune: -7 });
      voice(AC, 'sawtooth', hz(m), t, spb * 4, 0.018 * v, { lp: 1100, a: 0.35, rel: 1.2, detune: 7 });
    });
  }
  const up = Math.floor(pos / ch.length) % 2 ? 24 : 12;
  bell(AC, hz(ch[pos % ch.length] + up), t, (pos % 2 ? 0.035 : 0.05) * v);
  const beatPos = pos * S.step;
  if (Math.abs(beatPos - Math.round(beatPos)) < 1e-6) {
    voice(AC, 'triangle', hz(ch[0] - 12), t, spb * 0.9, 0.11 * v, { rel: spb * 0.4 });
    if (S.drums === 2 || (S.drums === 1 && (beatPos === 0 || beatPos === 2))) kick(AC, t, 0.28 * v);
    if (S.drums === 2 && (beatPos === 1 || beatPos === 3)) hiss(AC, t, 1800, 0.8, 0.16, 0.12 * v, 'bandpass');
    if (S.drums === 1 && (beatPos === 1 || beatPos === 3)) hiss(AC, t, 2200, 0.7, 0.12, 0.05 * v, 'bandpass');
  }
  if (S.drums && pos % 2 === 1) hiss(AC, t, 7000, 0.7, 0.05, 0.035 * v);
  if (S.drums === 2 && pos % 2 === 0) hiss(AC, t, 8000, 0.7, 0.03, 0.02 * v);
  void len;
}

function tick() {
  const AC = A.ctx();
  if (!AC || AC.state !== 'running' || !cur) return;
  const S = SONGS[cur], spb = 60 / S.bpm;
  if (nextT < AC.currentTime) nextT = AC.currentTime + 0.05;
  while (nextT < AC.currentTime + 0.3) {
    step(AC, S, n, nextT, spb);
    nextT += spb * S.step;
    n++;
  }
}
function play(name) {
  if (cur === name) return;
  stop();
  if (!ensure()) return;
  cur = name;
  n = 0;
  nextT = A.ctx().currentTime + 0.08;
  timer = setInterval(tick, 60);
  tick();
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  cur = null;
}
function setOn(v) {
  on = v;
  try { localStorage.setItem('bm_music', v ? 'on' : 'off'); } catch (err) { /* 保存できなくても続ける */ }
  const AC = ensure();
  if (AC && bus) bus.gain.setTargetAtTime(v ? 0.3 : 0, AC.currentTime, 0.1);
}

BM.music = { play, stop, setOn, get on() { return on; }, get current() { return cur; } };
})(globalThis.BM = globalThis.BM || {});
