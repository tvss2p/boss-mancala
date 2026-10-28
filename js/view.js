// 画面：バトルの「できごとの列」を順に演出しながら描く。タップ操作もここ
(function (BM) {
'use strict';
const D = BM.data, Ru = BM.rules, Bt = BM.battle, A = BM.audio;
const W = 390, H = 844;
const Q = new URLSearchParams(location.search);
const SPD = +(Q.get('speed') || 1);
const cv = document.getElementById('cv'), g = cv.getContext('2d');
const $ = id => document.getElementById(id);

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const eio = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const eout = k => 1 - Math.pow(1 - k, 3);
const eback = k => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const FONT = '"M PLUS Rounded 1c", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const NUMF = '"Dela Gothic One", "Hiragino Sans", sans-serif';
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const ELC = i => D.EL_COLOR[D.EL[i % 5]];
function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }

// ---------- 絵 ----------
const IMG = {};
// 階ごとの背景の絵（無いときはグラデーションだけ）
const FLOOR_BG = ['bg_forest', 'bg_forest', 'bg_temple', 'bg_garden', 'bg_witch'];
// 顔の位置（絵の幅・高さに対する割合）と、切りぬく大きさ（幅に対する割合）
const FACE = { ally_fire: [0.5, 0.15, 0.3], ally_water: [0.53, 0.12, 0.28], ally_wood: [0.5, 0.15, 0.3], ally_light: [0.5, 0.13, 0.28], ally_dark: [0.47, 0.22, 0.42] };
function loadImages() {
  const names = [...D.ALLIES.map(a => a.img), ...Object.values(D.ENEMIES).map(e => e.img), ...new Set(FLOOR_BG), 'title_art'];
  return Promise.all(names.map(n => new Promise(res => {
    const im = new Image();
    im.onload = () => { IMG[n] = im; whiteOf(n); res(); };
    im.onerror = () => res();
    im.src = 'art/' + n + (n.startsWith('bg_') || n === 'title_art' ? '.jpg' : '.png');
  })));
}

// 当たったときに白く光らせるための、白い形（Safari は ctx.filter が使えないため）
const WHITE = {};
function whiteOf(name) {
  if (WHITE[name] || !IMG[name]) return WHITE[name];
  const im = IMG[name], c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  WHITE[name] = c;
  return c;
}

// ---------- 大きさ ----------
let scale = 1, ox = 0, oy = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const vw = window.innerWidth, vh = window.innerHeight;
  cv.width = Math.round(vw * dpr);
  cv.height = Math.round(vh * dpr);
  scale = Math.min(vw / W, vh / H);
  ox = (vw - W * scale) / 2;
  oy = (vh - H * scale) / 2;
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  $('rotate').hidden = !(touch && vw > vh && vh < 520);
}

// ---------- 状態 ----------
let R = null;            // ルールの本当の状態
let VS = null;           // 画面に見せている盤（演出で少しずつ R に追いつく）
let VE = [];             // 画面の敵
let VT = { hp: 0, max: 0, trail: 0 };
let VR = 0;              // いかり
let VF = 0;              // 画面に見せている階
let steps = [], cur = null, busy = false;
let sel = -1, morph = null, now = 0, enemyBanner = 0;
let hand = null;         // 流している途中の玉 {colors, x, y}
let lastGoalSide = 0;
let shakeT = 0, shakeAmp = 0, redFlash = 0, clawFrom = -9;
const fx = [], pops = [], rings = [];

function syncFromR() {
  VS = Ru.clone(R.S);
  VE = R.enemies.map((e, i) => ({ ...(VE[i] && VE[i].name === e.name ? VE[i] : {}), ...e, alive: e.hp > 0, dying: e.hp > 0 ? 0 : 1 }));
  VT = { hp: R.team.hp, max: R.team.max, trail: VT.trail != null && VT.max === R.team.max ? VT.trail : R.team.hp };
  VR = R.rage;
  VF = R.floor;
}

// ---------- 盤の位置 ----------
const BX = 10, BY = 394;
function basePos(id, i) {
  const c = D.layout(id).cells[i];
  return [BX + c.x, BY + c.y];
}
function cellPos(i) {
  const p = basePos(VS.id, i);
  if (!morph) return p;
  const k = eio(clamp((now - morph.t0) / morph.dur));
  const q = basePos(morph.from, i);
  return [lerp(q[0], p[0], k), lerp(q[1], p[1], k) - Math.sin(k * Math.PI) * 18];
}
const isGoal = i => D.BOARDS[VS.id].cells[i].kind === 'goal';
const cellR = i => D.layout(VS.id).cells[i].r;
const beadR = () => D.layout(VS.id).pitR * 0.36;

// ---------- 敵の位置 ----------
function enemySlot(i) {
  const n = VE.length, w = W / n;
  const h = n === 1 ? (VE[0].boss ? 250 : 225) : n === 2 ? 190 : 150;
  return { cx: w * (i + 0.5), by: 262, h, w: h * 2 / 3, slotW: w };
}
const enemyCenter = i => { const s = enemySlot(i); return [s.cx, s.by - s.h * 0.5]; };

// ---------- 味方の位置 ----------
const allyPos = i => [39 + 78 * i, 350];

// ---------- 演出のための小物 ----------
function pop(text, x, y, opt = {}) { pops.push({ text, x: clamp(x, 92, W - 92), y, t: 0, dur: opt.dur || 1.1, size: opt.size || 22, kind: opt.kind || 'sticker', color: opt.color }); }
function burst(x, y, col, n = 14, sp = 160) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random());
    fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, t: 0, life: 0.5 + Math.random() * 0.5, r: 2 + Math.random() * 3, col });
  }
}
function shake(a) { shakeAmp = Math.max(shakeAmp, a); shakeT = 0.4; }

function marble(x, y, r, col, a = 1) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
  gr.addColorStop(0.35, rgb(col, 0.95 * a));
  gr.addColorStop(1, `rgba(${col[0] * 0.35 | 0},${col[1] * 0.35 | 0},${col[2] * 0.45 | 0},${a})`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, 7);
  g.fill();
}
// 3Dで描いたガラス玉の絵＋影・床の光・中のきらめき
function drawBead(x, y, r, ci, seed) {
  const spr = BM.beadSprites && BM.beadSprites[ci % 5], plus = ci >= 5;
  if (plus) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(x, y, r * 0.6, x, y, r * 1.6);
    gl.addColorStop(0, `rgba(255,228,140,${0.5 + Math.sin(now * 4 + seed) * 0.15})`); gl.addColorStop(1, 'rgba(255,228,140,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(x, y, r * 1.6, 0, 7); g.fill();
    g.restore();
  }
  if (!spr) { marble(x, y, r, ELC(ci)); plusMark(x, y, r, plus, seed); return; }
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath(); g.ellipse(x + r * 0.28, y + r * 0.38, r * 0.95, r * 0.72, 0, 0, 7); g.fill();
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = rgb(ELC(ci), 0.22);
  g.beginPath(); g.ellipse(x + r * 0.55, y + r * 0.6, r * 0.55, r * 0.38, 0.6, 0, 7); g.fill();
  g.restore();
  g.drawImage(spr, x - r, y - r, r * 2, r * 2);
  const tw = Math.sin(now * 2.4 + seed * 1.7);
  if (tw > 0.6) {
    const k = (tw - 0.6) / 0.4, a = seed * 2.4, sx = x + Math.cos(a) * r * 0.38, sy = y + Math.sin(a) * r * 0.38, s = r * 0.55 * k;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = k;
    const sg = g.createRadialGradient(sx, sy, 0, sx, sy, s * 0.7);
    sg.addColorStop(0, 'rgba(255,255,255,1)'); sg.addColorStop(0.35, 'rgba(255,255,255,0.5)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg;
    g.beginPath(); g.arc(sx, sy, s * 0.7, 0, 7); g.fill();
    g.restore();
  }
  plusMark(x, y, r, plus, seed);
}
function plusMark(x, y, r, plus, seed) {
  if (!plus) return;
  g.save();
  g.strokeStyle = 'rgba(255,236,150,0.95)';
  g.lineWidth = Math.max(1.2, r * 0.13);
  g.setLineDash([r * 0.55, r * 0.3]);
  g.lineDashOffset = -now * r * 3 - seed;
  g.beginPath(); g.arc(x, y, r * 1.13, 0, 7); g.stroke();
  g.setLineDash([]);
  g.font = `900 ${Math.max(9, r * 0.95)}px ${NUMF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = Math.max(2, r * 0.25); g.strokeStyle = '#6a3a00'; g.strokeText('+', x + r * 0.68, y - r * 0.62);
  g.fillStyle = '#fff3b0'; g.fillText('+', x + r * 0.68, y - r * 0.62);
  g.restore();
}
function cluster(n) {
  if (n <= 0) return [];
  if (n === 1) return [[0, 0]];
  const o = [], ring = n <= 6 ? n : Math.min(n - 1, 8);
  if (n > 6) o.push([0, 0]);
  for (let i = 0; i < ring; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / ring; o.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]); }
  return o;
}
function sticker(str, x, y, size, k = 1, a = 1, cols) {
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.translate(x, y);
  g.scale(k, k);
  g.font = `900 ${size}px ${FONT}`;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  if (!cols) {
    g.textAlign = 'center';
    g.lineWidth = size * 0.32;
    g.strokeStyle = '#3d1a68';
    g.strokeText(str, 0, 0);
    g.fillStyle = '#ffe14d';
    g.fillText(str, 0, 0);
  } else {
    let px = -g.measureText(str).width / 2;
    g.textAlign = 'left';
    [...str].forEach((ch, i) => {
      const yy = Math.sin(i * 1.3 + now * 6) * 2;
      g.lineWidth = size * 0.32;
      g.strokeStyle = '#2a1050';
      g.strokeText(ch, px, yy);
      g.fillStyle = cols[i % cols.length];
      g.fillText(ch, px, yy);
      px += g.measureText(ch).width;
    });
  }
  g.restore();
}
const RAINBOW = ['#ff6fa8', '#ffd84d', '#6fe0ff', '#9dff8a', '#c69bff', '#ffa65c'];

// ---------- できごと → 演出の手順 ----------
function add(dur, o) { steps.push({ dur, t: 0, ...o }); }

function enqueue(evs) {
  for (const e of evs) {
    if (e.t === 'sow') {
      lastGoalSide = e.side;
      if (e.side === 1) add(0.35, { start() { enemyBanner = 1; } });
      else enemyBanner = 0;
      let k = 0;
      for (const s of e.ev) {
        if (s.t === 'pick') {
          add(0.16, { start() { const [x, y] = cellPos(s.cell); hand = { colors: s.colors.slice(), x, y, fx: x, fy: y, tx: x, ty: y }; VS.beads[s.cell] = []; A.SE.pick(); } });
        } else if (s.t === 'drop') {
          const idx = k++;
          add(0.12, {
            start() { hand.fx = hand.x; hand.fy = hand.y; [hand.tx, hand.ty] = cellPos(s.cell); },
            draw(p) { hand.x = lerp(hand.fx, hand.tx, eio(p)); hand.y = lerp(hand.fy, hand.ty, eio(p)) - Math.sin(p * Math.PI) * 14; },
            finish() { hand.x = hand.tx; hand.y = hand.ty; hand.colors.shift(); VS.beads[s.cell].push(s.color); A.SE.drop(idx, isGoal(s.cell)); if (!hand.colors.length) hand = null; },
          });
        } else if (s.t === 'capture') {
          add(0.55, {
            start() { this.colors = s.colors; this.a = cellPos(s.from); this.b = cellPos(s.cell); this.c = cellPos(s.to); VS.beads[s.from] = []; VS.beads[s.cell] = []; A.SE.capture(); pop('とった！', this.c[0], this.c[1] - 40, { size: 20 }); },
            draw(p) { const kk = eio(p); this.colors.forEach((col, j) => { const from = j < this.colors.length - 1 ? this.a : this.b; drawBead(lerp(from[0], this.c[0], kk) + Math.sin(j) * 4, lerp(from[1], this.c[1], kk) - Math.sin(kk * Math.PI) * 30, beadR(), col, j); }); },
            finish() { VS.beads[s.to].push(...s.colors); },
          });
        } else if (s.t === 'extra') {
          add(0.4, { start() { const p = cellPos(Ru.goalOf(VS, e.side)); pop('もう1回！', p[0], p[1] - 44, { size: 22, kind: 'rainbow' }); A.SE.extra(); } });
        }
      }
    } else if (e.t === 'attack') {
      add(0.62, {
        start() {
          this.g = cellPos(Ru.goalOf(VS, 0));
          this.e = enemyCenter(e.enemy);
          this.col = D.EL_COLOR[R.allies[e.ally].el];
          const ci = D.EL.indexOf(R.allies[e.ally].el), gb = VS.beads[Ru.goalOf(VS, 0)];
          for (let j = 0; j < e.n; j++) { const at = gb.findIndex(x => x % 5 === ci); if (at >= 0) gb.splice(at, 1); }
          this.hit = false;
          A.SE.launch();
        },
        draw(p) {
          const kk = Math.min(1, p / 0.7), ax = allyPos(e.ally);
          for (let j = 0; j < Math.min(e.n, 8); j++) {
            const q = clamp(kk - j * 0.05), u = 1 - q, mx = (this.g[0] + this.e[0]) / 2 + (j % 2 ? 60 : -60), my = ax[1] - 40;
            const x = u * u * this.g[0] + 2 * u * q * mx + q * q * this.e[0], y = u * u * this.g[1] + 2 * u * q * my + q * q * this.e[1];
            if (q > 0 && q < 1) { g.save(); g.shadowColor = rgb(this.col); g.shadowBlur = 18; marble(x, y, 8, this.col); g.restore(); }
          }
          if (p >= 0.7 && !this.hit) {
            this.hit = true;
            const v = VE[e.enemy];
            v.hp = Math.max(0, v.hp - e.dmg);
            v.flash = 1;
            const [x, y] = this.e;
            pop(String(e.dmg), x + 30 - (e.ally % 2) * 50, y - 10 - e.ally * 16, { kind: 'dmg', size: e.dmg > 300 ? 42 : 34, color: this.col });
            if (e.mult === 2) pop('こうかばつぐん！', x, y + 50, { size: 16 });
            if (e.mult === 0.5) pop('いまひとつ…', x, y + 50, { size: 14 });
            elemBurst(x, y, R.allies[e.ally].el);
            shake(e.dmg > 300 ? 8 : 5);
            A.SE.hit(e.dmg > 300);
          }
        },
      });
    } else if (e.t === 'kill') {
      add(0.7, { start() { VE[e.enemy].dyingFrom = now; VE[e.enemy].alive = false; const [x, y] = enemyCenter(e.enemy); burst(x, y, D.EL_COLOR[VE[e.enemy].el], 40, 260); burst(x, y, [255, 255, 255], 20, 200); A.SE.kill(); } });
    } else if (e.t === 'reshape') {
      add(1.4, { start() { morph = { from: VS.id, t0: now, dur: 1.2 / SPD }; VS.id = e.board; pop('盤が組みかわった！', 195, 612, { size: 24, kind: 'rainbow', dur: 1.6 }); shake(10); A.SE.tech(); }, finish() { morph = null; } });
    } else if (e.t === 'refill') {
      const side = lastGoalSide;
      add(Math.max(0.45, 0.05 * e.ev.length + 0.35), {
        start() { VS.beads[Ru.goalOf(VS, side)] = []; this.items = e.ev.map((f, j) => ({ ...f, d: j * 0.05 })); A.SE.fall(); },
        draw(p) { const tt = p * this.dur; this.items.forEach(f => { const q = clamp((tt - f.d) / 0.3); if (q <= 0 || q >= 1) return; const [x, y] = cellPos(f.cell); drawBead(x, lerp(BY - 10, y, q * q), beadR(), f.color, f.cell); }); },
        finish() { this.items.forEach(f => VS.beads[f.cell].push(f.color)); },
      });
    } else if (e.t === 'rage') {
      add(0.6, {
        start() { this.g = cellPos(Ru.goalOf(VS, 1)); this.cols = VS.beads[Ru.goalOf(VS, 1)].slice(); VS.beads[Ru.goalOf(VS, 1)] = []; },
        draw(p) { this.cols.forEach((c, j) => { const q = clamp(p * 1.4 - j * 0.04); marble(lerp(this.g[0], 195, q), lerp(this.g[1], 60, eio(q)), 6, [150, 70, 200], 1 - q * 0.6); }); },
        finish() { VR = e.total; pop(`いかり +${e.n}`, 330, 66, { size: 16, color: [190, 110, 255], kind: 'dmg' }); },
      });
    } else if (e.t === 'enemyHit') {
      add(0.85, {
        start() { this.hit = false; VE[e.enemy].lungeFrom = now; },
        draw(p) {
          if (p > 0.38 && !this.hit) {
            this.hit = true;
            VT.hp = Math.max(0, VT.hp - e.dmg);
            VR = 0;
            shake(12);
            redFlash = 1;
            clawFrom = now;
            pop(String(e.dmg), 300, 300, { kind: 'dmg', size: 34, color: [255, 80, 100] });
            A.SE.hurt();
          }
        },
      });
    } else if (e.t === 'tech') {
      add(1.15, {
        start() { const [x, y] = enemyCenter(e.enemy); VE[e.enemy].glowFrom = now; pop(`${VE[e.enemy].name}の ${D.TECH_NAME[e.kind]}！`, 195, Math.max(80, y - 60), { size: 19, dur: 1.4 }); A.SE.tech(); this.done = false; },
        draw(p) {
          if (e.kind === 'steal' && e.cells.length === 2 && p > 0.4) {
            const q = clamp((p - 0.4) / 0.5), a = cellPos(e.cells[0]), b = cellPos(e.cells[1]);
            for (let j = 0; j < (e.n || 3); j++) marble(lerp(a[0], b[0], eio(q)) + j * 3, lerp(a[1], b[1], eio(q)) - Math.sin(q * Math.PI) * 60, 6, [150, 70, 200]);
          }
          if (p > 0.45 && !this.done) {
            this.done = true;
            if (e.kind === 'freeze') e.cells.forEach(c => { VS.frozen[c] = D.TUNE.freezeTurns; burst(...cellPos(c), [200, 240, 255], 12, 120); });
            if (e.kind === 'paint') e.cells.forEach(c => { VS.owner[c] = 1; burst(...cellPos(c), [40, 20, 60], 16, 120); });
            if (e.kind === 'steal' && e.cells.length === 2) { this.moved = VS.beads[e.cells[0]]; VS.beads[e.cells[0]] = []; }
            if (e.miss) pop('でも、なにも取れなかった', 195, 612, { size: 16 });
            if (e.kind === 'reverse') { VS.dir *= -1; pop('流れが逆まわりに！', 195, 612, { size: 20 }); }
            if (e.kind === 'recolor') {
              e.slots.forEach(([c, k]) => { if (VS.beads[c][k] != null) VS.beads[c][k] = e.color; });
              e.cells.forEach(c => burst(...cellPos(c), ELC(e.color), 8, 90));
            }
          }
        },
        finish() { if (e.kind === 'steal' && this.moved) VS.beads[e.cells[1]].push(...this.moved); },
      });
    } else if (e.t === 'skill') {
      add(1.25, {
        start() { this.a = R.allies[e.ally]; this.done = false; enemyBanner = 0; A.SE.skill(); },
        draw(p) {
          cutIn(this.a, p);
          if (p > 0.6 && !this.done) {
            this.done = true;
            const k = e.kind;
            if (k === 'evenFire') e.cells.forEach(c => { VS.beads[c] = VS.beads[c].map(x => (x >= 5 ? 5 : 0)); burst(...cellPos(c), D.EL_COLOR.fire, 10, 100); });
            if (k === 'thaw') e.cells.forEach(c => { if (VS.owner[c] === 1) VS.owner[c] = 0; else VS.frozen[c] = 0; burst(...cellPos(c), [200, 240, 255], 12, 120); });
            if (k === 'heal') { const n = Math.round(VT.max * D.TUNE.healRate); VT.hp = Math.min(VT.max, VT.hp + n); pop(`+${n}`, 300, 300, { kind: 'dmg', size: 26, color: [120, 255, 150] }); A.SE.heal(); e.cells.forEach(c => { VS.beads[c] = VS.beads[c].map(x => (x >= 5 ? 7 : 2)); }); }
            if (k === 'bless') { (e.slots || []).forEach(([c, j]) => { if (VS.beads[c][j] != null && VS.beads[c][j] < 5) VS.beads[c][j] += 5; }); e.cells.forEach(c => burst(...cellPos(c), [255, 230, 140], 12, 110)); }
            if (k === 'boost') { pop('このターン 攻撃×2！', 195, 300, { size: 22, kind: 'rainbow', dur: 1.4 }); }
            if (k === 'seize') e.cells.forEach(c => { VS.owner[c] = 0; VS.seized[c] = D.TUNE.seizeTurns; burst(...cellPos(c), [255, 255, 255], 14, 120); });
          }
        },
      });
    } else if (e.t === 'unseize') {
      add(0.3, { start() { VS.owner[e.cell] = 1; VS.seized[e.cell] = 0; } });
    } else if (e.t === 'skip') {
      add(1.0, { start() { pop('動かせる玉がない…', 195, 612, { size: 18, dur: 1.2 }); } });
    } else if (e.t === 'floor') {
      add(2.1, {
        start() { this.done = false; A.SE.floor(); BM.music.play(e.n === D.FLOORS.length - 1 ? 'boss' : 'battle'); },
        draw(p) {
          if (p > 0.42 && !this.done) {
            this.done = true;
            VS = Ru.clone(e.S);
            VE = e.enemies.map(x => ({ ...x, alive: true }));
            VR = 0;
            VF = e.n;
            enemyBanner = 0;
          }
          floorCard(e, p);
        },
      });
    } else if (e.t === 'win' || e.t === 'lose') {
      add(0.6, { start() { enemyBanner = 0; } });
    }
  }
  busy = steps.length > 0 || !!cur;
}

// ---------- 入力 ----------
function toLocal(ev) {
  const r = cv.getBoundingClientRect();
  return [(ev.clientX - r.left - ox) / scale, (ev.clientY - r.top - oy) / scale];
}
function onTap(ev) {
  A.wake();
  if (!R || R.over || !$('title').hidden) return;
  const [x, y] = toLocal(ev);
  if (Math.hypot(x - 126, y - 26) < 18) { BM.music.setOn(!BM.music.on); A.SE.select(); return; }
  if (busy) return;
  for (let i = 0; i < R.allies.length; i++) {
    const [ax, ay] = allyPos(i);
    if (Math.hypot(x - ax, y - ay) < 32) { openSkill(i); return; }
  }
  closeSkill();
  for (let i = 0; i < VE.length; i++) {
    const s = enemySlot(i);
    if (VE[i].alive && Math.abs(x - s.cx) < s.slotW / 2 && y > s.by - s.h && y < s.by + 20) {
      Bt.setTarget(R, i);
      A.SE.select();
      return;
    }
  }
  const legal = Ru.legalMoves(R.S, 0);
  for (const c of legal) {
    const [px, py] = cellPos(c);
    if (Math.hypot(x - px, y - py) < cellR(c) + 8) {
      if (sel === c) {
        sel = -1;
        enqueue(Bt.playerMove(R, c));
      } else {
        sel = c;
        A.SE.select();
      }
      return;
    }
  }
  for (let i = 0; i < VS.beads.length; i++) {
    const [px, py] = cellPos(i);
    if (Math.hypot(x - px, y - py) < cellR(i) + 4) { A.SE.nope(); break; }
  }
  sel = -1;
}

// ---------- スキルの窓 ----------
let skillOpen = -1;
function openSkill(i) {
  const a = R.allies[i], ok = Bt.canUseSkill(R, i);
  skillOpen = i;
  $('skName').textContent = `${a.name}（${D.EL_NAME[a.el]}）`;
  $('skSkill').textContent = a.skillName;
  $('skText').textContent = D.SKILL_TEXT[a.skill];
  $('skCharge').textContent = a.charge >= a.cost ? (ok ? 'たまった！' : 'いまは使える場所がない') : `あと ${a.cost - a.charge} ターン`;
  $('skUse').disabled = !ok;
  $('skill').hidden = false;
  A.SE.select();
}
function closeSkill() { $('skill').hidden = true; skillOpen = -1; }

// ---------- 描画 ----------
const THEMES = [
  ['#1b1036', '#4a2a6e', '#120a24'],
  ['#0f1a3a', '#2d4a7e', '#0a1226'],
  ['#0d1834', '#3a3a7a', '#0b0f22'],
  ['#0d2420', '#2d5a46', '#08140f'],
  ['#14061f', '#5a1a60', '#0a0312'],
];
function drawBg() {
  const th = THEMES[R ? VF : 0];
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, th[0]); gr.addColorStop(0.4, th[1]); gr.addColorStop(1, th[2]);
  g.fillStyle = gr;
  g.fillRect(-200, -200, W + 400, H + 400);
  const bgi = IMG[R ? FLOOR_BG[VF] : 'title_art'];
  if (bgi) {
    const z = 1.04 + Math.sin(now * 0.05) * 0.03, bw = W * z * (R ? 1 : H / (W * 1.5)), bh = bw * bgi.height / bgi.width;
    const bx = (W - bw) / 2 + Math.sin(now * 0.07) * 6, by = R ? -30 : (H - bh) / 2;
    g.drawImage(bgi, bx, by, bw, bh);
    const dk = g.createLinearGradient(0, 0, 0, H);
    if (R) { dk.addColorStop(0, 'rgba(8,4,20,0.15)'); dk.addColorStop(0.3, 'rgba(8,4,20,0.05)'); dk.addColorStop(0.42, 'rgba(8,4,20,0.35)'); dk.addColorStop(0.62, 'rgba(8,4,20,0.85)'); dk.addColorStop(1, 'rgba(8,4,20,0.95)'); }
    else { dk.addColorStop(0, 'rgba(8,4,20,0.1)'); dk.addColorStop(1, 'rgba(8,4,20,0.45)'); }
    g.fillStyle = dk; g.fillRect(-200, -200, W + 400, H + 400);
  }
  // 星雲のようなやわらかい光
  g.save();
  g.globalCompositeOperation = 'lighter';
  [[0.2, 0.18, 220, th[1]], [0.85, 0.3, 200, '#6a3aa0'], [0.5, 0.05, 260, '#2a4a9a']].forEach(([px, py, rad, c], k) => {
    const x = W * px + Math.sin(now * 0.15 + k) * 30, y = H * py + Math.cos(now * 0.12 + k * 2) * 20;
    const ng = g.createRadialGradient(x, y, 0, x, y, rad);
    ng.addColorStop(0, c + '55'); ng.addColorStop(1, c + '00');
    g.fillStyle = ng; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  });
  g.restore();
  if (R && VF === 4) {
    g.save();
    g.translate(195, 160);
    g.rotate(now * 0.08);
    for (let i = 0; i < 12; i++) {
      g.rotate(Math.PI / 6);
      g.fillStyle = `rgba(${i % 2 ? '200,120,255' : '255,160,220'},0.07)`;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-40, -300); g.lineTo(40, -300); g.fill();
    }
    g.restore();
  }
  for (let i = 0; i < 30; i++) {
    const s = Math.sin(i * 127.1) * 43758.5, r1 = s - Math.floor(s), s2 = Math.sin(i * 311.7) * 23421.6, r2 = s2 - Math.floor(s2);
    const x = (r1 * W + Math.sin(now * 0.3 + i) * 20 + W) % W, y = (r2 * 300 - now * (6 + r1 * 10) + 3000) % 300;
    const tw = 0.5 + 0.5 * Math.sin(now * (1 + r1 * 2) + i);
    g.fillStyle = `rgba(255,255,255,${(0.12 + r2 * 0.3) * tw})`;
    g.beginPath(); g.arc(x, y, 0.8 + r1 * 1.6, 0, 7); g.fill();
  }
}

function magicCircle(cx, cy, rx, col, a) {
  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.3);
  g.globalAlpha = a;
  g.globalCompositeOperation = 'lighter';
  const gl = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gl.addColorStop(0, rgb(col, 0.3)); gl.addColorStop(1, rgb(col, 0));
  g.fillStyle = gl; g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill();
  g.strokeStyle = rgb(col, 0.8); g.lineWidth = 2.5;
  g.beginPath(); g.arc(0, 0, rx, 0, 7); g.stroke();
  g.lineWidth = 1.2;
  g.beginPath(); g.arc(0, 0, rx * 0.8, 0, 7); g.stroke();
  g.rotate(now * 0.5);
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let j = 0; j <= 3; j++) { const t = (j / 3) * Math.PI * 2 + k * Math.PI / 3; g.lineTo(Math.cos(t) * rx * 0.8, Math.sin(t) * rx * 0.8); }
    g.stroke();
  }
  for (let k = 0; k < 24; k++) {
    const t = k * Math.PI / 12;
    g.beginPath(); g.moveTo(Math.cos(t) * rx * 0.84, Math.sin(t) * rx * 0.84); g.lineTo(Math.cos(t) * rx * (k % 2 ? 0.92 : 0.97), Math.sin(t) * rx * (k % 2 ? 0.92 : 0.97)); g.stroke();
  }
  g.restore();
}

function drawEnemies() {
  VE.forEach((v, i) => {
    const s = enemySlot(i), im = IMG[v.img], col = D.EL_COLOR[v.el];
    let alpha = 1, sc = 1, dy = Math.sin(now * 2 + i) * 4, dx = 0;
    if (v.dyingFrom != null || !v.alive) {
      const k = v.dyingFrom != null ? clamp((now - v.dyingFrom) * SPD / 0.6) : 1;
      alpha = 1 - k; sc = 1 + k * 0.15;
    }
    if (alpha <= 0) return;
    if (v.lungeFrom != null) {
      const k = clamp((now - v.lungeFrom) * SPD / 0.8), l = k < 0.35 ? eout(k / 0.35) : 1 - eio((k - 0.35) / 0.65);
      sc *= 1 + 0.22 * l; dy += 40 * l;
    }
    const fl = v.flash || 0;
    if (fl) { dx = Math.sin(now * 80) * 6 * fl; dy -= 6 * fl; v.flash = Math.max(0, fl - 0.04 * SPD); }
    magicCircle(s.cx, s.by - 2, s.w * (v.boss ? 0.62 : 0.5), col, alpha * (v.boss ? 0.95 : 0.7));
    g.save();
    g.globalAlpha = alpha;
    if (v.boss) {
      const ag = g.createRadialGradient(s.cx, s.by - s.h * 0.5, 10, s.cx, s.by - s.h * 0.5, s.h * 0.6);
      ag.addColorStop(0, `rgba(200,120,255,${0.35 + Math.sin(now * 3) * 0.1})`); ag.addColorStop(1, 'rgba(200,120,255,0)');
      g.fillStyle = ag; g.fillRect(s.cx - s.h, s.by - s.h * 1.1, s.h * 2, s.h * 1.2);
    }
    if (v.glowFrom != null && now - v.glowFrom < 1.2 / SPD) {
      const k = (now - v.glowFrom) * SPD / 1.2;
      g.shadowColor = rgb(col); g.shadowBlur = 40 * Math.sin(k * Math.PI);
    }
    g.translate(s.cx + dx, s.by + dy);
    g.scale(sc, sc);
    if (im) {
      g.drawImage(im, -s.w / 2, -s.h, s.w, s.h);
      const wh = WHITE[v.img];
      if (wh && fl > 0.02) { g.globalAlpha = alpha * Math.min(1, fl * 1.3); g.drawImage(wh, -s.w / 2, -s.h, s.w, s.h); }
    } else { g.fillStyle = rgb(col, 0.6); g.beginPath(); g.ellipse(0, -s.h / 2, s.w / 2.5, s.h / 2.4, 0, 0, 7); g.fill(); }
    g.restore();
    if (!v.alive) return;
    if (R.target === i) {
      const [cx, cy] = enemyCenter(i), r = 28 + Math.sin(now * 5) * 3;
      g.save(); g.strokeStyle = 'rgba(255,225,80,0.95)'; g.lineWidth = 2.5; g.shadowColor = '#ffd84d'; g.shadowBlur = 10;
      g.rotate(0);
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + now; g.beginPath(); g.arc(cx, cy, r, a, a + 0.9); g.stroke(); }
      g.restore();
    }
    // 名前とHP
    const bw = Math.min(s.slotW * 0.84, 230), bx = s.cx - bw / 2;
    v.trail = v.trail == null ? v.hp : Math.max(v.hp, v.trail - (v.max * 0.6) * (1 / 60) * SPD);
    elBadge(bx + 9, 271, v.el, 9);
    g.font = `800 ${VE.length > 2 ? 11 : 13}px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 3; g.strokeStyle = 'rgba(10,6,24,0.9)'; g.strokeText(v.name, bx + 22, 271);
    g.fillStyle = '#fff'; g.fillText(v.name, bx + 22, 271);
    hpBar(bx, 281, bw, 9, v.hp / v.max, v.trail / v.max, ['#ff4d7e', '#ffb0c8']);
    // あと○（宝石の形）
    const cdN = v.cd, cx2 = s.cx + s.w * 0.4, cy2 = s.by - s.h + 16, hot = cdN <= 1, pz = hot ? 1 + Math.sin(now * 10) * 0.08 : 1;
    g.save(); g.translate(cx2, cy2); g.scale(pz, pz);
    const gg = g.createLinearGradient(0, -18, 0, 18);
    gg.addColorStop(0, hot ? '#ff8aa0' : '#5a4a9a'); gg.addColorStop(1, hot ? '#c0123a' : '#1a1238');
    g.beginPath(); g.moveTo(0, -19); g.lineTo(17, -6); g.lineTo(11, 17); g.lineTo(-11, 17); g.lineTo(-17, -6); g.closePath();
    g.fillStyle = gg; g.fill(); g.strokeStyle = hot ? '#ffe0e6' : 'rgba(220,210,255,0.8)'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 8px ${FONT}`; g.fillText('あと', 0, -8);
    g.font = `400 15px ${NUMF}`; g.fillText(cdN, 0, 6);
    g.restore();
  });
}
function hpBar(x, y, w, h, k, trail, cols) {
  rr(x - 1.5, y - 1.5, w + 3, h + 3, (h + 3) / 2); g.fillStyle = 'rgba(8,4,20,0.85)'; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.stroke();
  if (trail > k) { rr(x, y, w * clamp(trail), h, h / 2); g.fillStyle = 'rgba(255,240,240,0.8)'; g.fill(); }
  if (k > 0) {
    const hg = g.createLinearGradient(x, 0, x + w, 0); hg.addColorStop(0, cols[0]); hg.addColorStop(1, cols[1]);
    rr(x, y, Math.max(h, w * clamp(k)), h, h / 2); g.fillStyle = hg; g.fill();
    rr(x + 2, y + 1, Math.max(0, w * clamp(k) - 4), h * 0.35, h / 4); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill();
  }
}
function elBadge(x, y, el, r) {
  const c = D.EL_COLOR[el], gg = g.createLinearGradient(x, y - r, x, y + r);
  gg.addColorStop(0, rgb(c.map(v => Math.min(255, v + 70)))); gg.addColorStop(1, rgb(c.map(v => v * 0.7)));
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = gg; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.2; g.stroke();
  g.fillStyle = '#1a1030'; g.font = `900 ${r * 1.2}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(D.EL_NAME[el], x, y + 0.5);
}

function pill(x, y, w, h, c1, c2, stroke) {
  const gg = g.createLinearGradient(0, y, 0, y + h);
  gg.addColorStop(0, c1); gg.addColorStop(1, c2);
  rr(x, y, w, h, h / 2); g.fillStyle = gg; g.fill();
  g.strokeStyle = stroke || 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2; g.stroke();
}
function drawTop() {
  const boss = VF === D.FLOORS.length - 1;
  pill(12, 10, 92, 32, 'rgba(60,40,120,0.85)', 'rgba(20,12,44,0.9)', 'rgba(255,225,140,0.7)');
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = '#ffe9a8'; g.font = `400 20px ${NUMF}`;
  g.fillText(`${VF + 1}F`, 26, 27);
  g.fillStyle = 'rgba(255,255,255,0.65)'; g.font = `800 11px ${FONT}`; g.fillText(boss ? 'ボス' : '/ 5F', 62, 28);
  const mOn = BM.music && BM.music.on;
  g.beginPath(); g.arc(126, 26, 15, 0, 7); g.fillStyle = 'rgba(20,12,44,0.85)'; g.fill();
  g.strokeStyle = 'rgba(255,225,140,0.6)'; g.lineWidth = 1.2; g.stroke();
  g.fillStyle = mOn ? '#ffe9a8' : 'rgba(255,255,255,0.35)'; g.font = `900 15px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', 126, 27);
  if (!mOn) { g.strokeStyle = 'rgba(255,120,140,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(116, 36); g.lineTo(136, 16); g.stroke(); }
  if (VR > 0) {
    pill(W - 118, 10, 106, 32, 'rgba(120,40,160,0.9)', 'rgba(50,10,70,0.9)', 'rgba(220,160,255,0.8)');
    g.fillStyle = '#f2d8ff'; g.font = `800 12px ${FONT}`; g.textAlign = 'center';
    g.fillText(`いかり ×${VR}`, W - 65, 27);
  }
  if (enemyBanner) {
    pill(140, 10, 110, 32, 'rgba(230,60,90,0.95)', 'rgba(120,10,40,0.95)', 'rgba(255,200,210,0.8)');
    g.fillStyle = '#fff'; g.font = `900 14px ${FONT}`; g.textAlign = 'center'; g.fillText('敵の番', 195, 27);
  } else if (R.boost > 1) {
    pill(140, 10, 110, 32, 'rgba(150,70,230,0.95)', 'rgba(60,20,110,0.95)', 'rgba(230,200,255,0.9)');
    g.fillStyle = '#fff'; g.font = `900 13px ${FONT}`; g.textAlign = 'center'; g.fillText('攻撃×2 中', 195, 27);
  }
}

function heart(x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
  g.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s * 1.1, y - s * 0.35, x, y + s * 0.35);
  g.closePath();
}
function drawBand() {
  VT.trail = VT.trail == null ? VT.hp : (VT.trail > VT.hp ? Math.max(VT.hp, VT.trail - VT.max * 0.012 * SPD) : VT.hp);
  const k = clamp(VT.hp / VT.max), low = k < 0.3;
  hpBar(40, 301, W - 54, 14, k, VT.trail / VT.max, low ? ['#ff5a5a', '#ffb08a'] : ['#2fd6a0', '#9ef0ff']);
  g.save();
  g.shadowColor = '#ff6a8a'; g.shadowBlur = low ? 12 + Math.sin(now * 8) * 6 : 6;
  heart(24, 308, 12); g.fillStyle = '#ff5a7e'; g.fill();
  g.restore();
  heart(24, 308, 12); g.strokeStyle = '#ffe0e8'; g.lineWidth = 1.5; g.stroke();
  g.font = `400 13px ${NUMF}`; g.textAlign = 'right'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const txt = `${Math.round(VT.hp)} / ${VT.max}`;
  g.lineWidth = 3.5; g.strokeStyle = 'rgba(8,4,20,0.9)'; g.strokeText(txt, W - 20, 308.5);
  g.fillStyle = '#fff'; g.fillText(txt, W - 20, 308.5);
  R.allies.forEach((a, i) => {
    const [x, y] = allyPos(i), im = IMG[a.img], col = D.EL_COLOR[a.el], ready = a.charge >= a.cost;
    g.save();
    if (ready) { g.shadowColor = rgb(col); g.shadowBlur = 18 + Math.sin(now * 6) * 6; }
    const rg = g.createLinearGradient(x - 28, y - 28, x + 28, y + 28);
    rg.addColorStop(0, '#fff2c4'); rg.addColorStop(0.5, rgb(col)); rg.addColorStop(1, '#3a2a10');
    g.beginPath(); g.arc(x, y, 28, 0, 7); g.fillStyle = rg; g.fill();
    g.restore();
    g.save();
    g.beginPath(); g.arc(x, y, 24, 0, 7); g.clip();
    g.fillStyle = rgb(col, 0.4); g.fillRect(x - 24, y - 24, 48, 48);
    if (im) {
      const f = FACE[a.img] || [0.5, 0.15, 0.3], sw = im.width * f[2];
      g.drawImage(im, im.width * f[0] - sw / 2, im.height * f[1] - sw / 2, sw, sw, x - 24, y - 24, 48, 48);
    }
    const sh = g.createLinearGradient(0, y - 24, 0, y + 24); sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.fillRect(x - 24, y - 24, 48, 48);
    g.restore();
    g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(x, y, 26, 0, 7); g.stroke();
    g.save(); g.strokeStyle = rgb(col.map(v => Math.min(255, v + 60))); g.shadowColor = rgb(col); g.shadowBlur = 8; g.lineCap = 'round';
    g.beginPath(); g.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(a.charge / a.cost)); g.stroke(); g.restore();
    if (ready) {
      const sweep = now * 3 + i;
      g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 26, sweep, sweep + 0.6); g.stroke(); g.restore();
      const pz = 1 + Math.sin(now * 6) * 0.06;
      g.save(); g.translate(x, y + 30); g.scale(pz, pz);
      pill(-22, -8, 44, 16, rgb(col.map(v => Math.min(255, v + 60))), rgb(col.map(v => v * 0.6)), '#ffffff');
      g.fillStyle = '#fff'; g.font = `900 10px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.strokeText('スキル', 0, 0.5); g.fillText('スキル', 0, 0.5);
      g.restore();
    }
    elBadge(x - 20, y + 19, a.el, 8);
  });
}

function drawBoard() {
  rr(4, 388, W - 8, 450, 24);
  const base = g.createLinearGradient(0, 388, 0, 838);
  base.addColorStop(0, 'rgba(46,34,100,0.82)'); base.addColorStop(1, 'rgba(14,10,36,0.92)');
  g.fillStyle = base; g.fill();
  const glow = g.createRadialGradient(195, 612, 20, 195, 612, 240);
  glow.addColorStop(0, 'rgba(150,120,255,0.16)'); glow.addColorStop(1, 'rgba(150,120,255,0)');
  g.fillStyle = glow; g.fill();
  const bd = g.createLinearGradient(0, 388, 0, 838);
  bd.addColorStop(0, 'rgba(255,240,200,0.75)'); bd.addColorStop(0.15, 'rgba(255,255,255,0.25)'); bd.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.strokeStyle = bd; g.lineWidth = 1.6; g.stroke();
  rr(8, 392, W - 16, 442, 21); g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1; g.stroke();
  [[16, 400], [W - 16, 400], [16, 826], [W - 16, 826]].forEach(([cx, cy]) => {
    g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
    const dg = g.createLinearGradient(-5, -5, 5, 5); dg.addColorStop(0, '#fff2c4'); dg.addColorStop(1, '#b8862e');
    g.fillStyle = dg; g.fillRect(-4, -4, 8, 8); g.restore();
  });
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `700 11px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(D.BOARDS[VS.id].name, 30, 402);
  if (R.lightNext && sel < 0) { g.textAlign = 'right'; g.fillStyle = '#ffe48a'; g.fillText('さかさ流し：次の1回は逆向き', W - 20, 402); }
  const n = VS.beads.length;
  // 流れる向きの矢印
  for (let i = 0; i < n; i++) {
    const j = (i + VS.dir + n) % n, a = cellPos(i), b = cellPos(j), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ra = cellR(i), rb = cellR(j), mx = (a[0] + Math.cos(ang) * ra + b[0] - Math.cos(ang) * rb) / 2, my = (a[1] + Math.sin(ang) * ra + b[1] - Math.sin(ang) * rb) / 2;
    g.save(); g.translate(mx, my); g.rotate(ang); g.fillStyle = 'rgba(255,255,255,0.4)';
    g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -4); g.lineTo(-1, 0); g.lineTo(-3, 4); g.closePath(); g.fill(); g.restore();
    const sa = [a[0] + Math.cos(ang) * ra, a[1] + Math.sin(ang) * ra], sb = [b[0] - Math.cos(ang) * rb, b[1] - Math.sin(ang) * rb];
    const q = (now * 0.7 + i * 0.13) % 1;
    g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(190,220,255,${0.55 * Math.sin(q * Math.PI)})`;
    g.beginPath(); g.arc(lerp(sa[0], sb[0], q), lerp(sa[1], sb[1], q), 1.8, 0, 7); g.fill(); g.restore();
  }
  // 向かいの線（選んだ穴のぶんだけ）
  const opp = D.BOARDS[VS.id].opposite;
  if (sel >= 0 && opp[sel] != null) {
    const a = cellPos(sel), b = cellPos(opp[sel]);
    g.save(); g.setLineDash([3, 5]); g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.restore();
  }
  drawPreview();
  for (let i = 0; i < n; i++) drawCell(i);
  if (hand) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(hand.x, hand.y + 14, 14, 5, 0, 0, 7); g.fill();
    const hb = beadR();
    cluster(hand.colors.length).forEach(([dx, dy], j) => drawBead(hand.x + dx * hb * 2.6, hand.y - 12 + dy * hb * 2.6, hb, hand.colors[j], j));
  }
}

function drawCell(i) {
  const [x, y] = cellPos(i), r = cellR(i), goal = isGoal(i), own = VS.owner[i] === 0, legal = !busy && R.turn === 'player' && own && !goal && !VS.frozen[i] && VS.beads[i].length;
  const sg = g.createRadialGradient(x, y - r * 0.3, 2, x, y, r);
  sg.addColorStop(0, 'rgba(0,0,0,0.2)'); sg.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = sg; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  if (own) {
    g.save(); g.shadowColor = '#ffffff'; g.shadowBlur = legal ? 14 + Math.sin(now * 3 + i) * 4 : 5;
    const mg = g.createLinearGradient(x - r, y - r, x + r, y + r);
    mg.addColorStop(0, '#ffffff'); mg.addColorStop(0.5, legal ? '#e8e0ff' : 'rgba(220,214,255,0.7)'); mg.addColorStop(1, legal ? '#b9a8ff' : 'rgba(150,140,200,0.6)');
    g.strokeStyle = mg; g.lineWidth = goal ? 3.5 : 3;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r - 2.2, 0, 7); g.stroke();
  } else {
    g.strokeStyle = '#0b0712'; g.lineWidth = goal ? 5 : 4.5; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(200,205,225,0.55)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, r + 2.4, 0, 7); g.stroke();
  }
  if (sel === i) {
    g.save(); g.shadowColor = '#7fe6ff'; g.shadowBlur = 18; g.strokeStyle = '#9ff0ff'; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, r + 5 + Math.sin(now * 8) * 1.5, 0, 7); g.stroke(); g.restore();
  }
  if (goal) {
    g.fillStyle = own ? 'rgba(255,255,255,0.32)' : 'rgba(200,190,230,0.25)'; g.font = `900 ${own ? 12 : 10}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(own ? 'ゴール' : '敵ゴール', x, y);
  }
  const b = VS.beads[i], br = beadR();
  cluster(Math.min(b.length, goal ? 9 : 7)).forEach(([dx, dy], j) => drawBead(x + dx * r * (goal ? 1.05 : 1.12), y + dy * r * (goal ? 1.05 : 1.12), br, b[j], i * 7 + j));
  if (VS.frozen[i]) {
    g.save(); g.globalAlpha = 0.85;
    const ig = g.createLinearGradient(x - r, y - r, x + r, y + r); ig.addColorStop(0, 'rgba(240,252,255,0.95)'); ig.addColorStop(1, 'rgba(120,190,240,0.8)');
    g.fillStyle = ig; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + 0.3; g.lineTo(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5)); } g.closePath(); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); g.restore();
    g.fillStyle = '#21507a'; g.font = `900 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(VS.frozen[i], x, y + 1);
  }
  if (VS.seized[i]) {
    g.save(); g.setLineDash([3, 3]); g.strokeStyle = '#c69bff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 6, 0, 7); g.stroke(); g.restore();
    g.fillStyle = '#c69bff'; g.font = `900 10px ${FONT}`; g.textAlign = 'center'; g.fillText(VS.seized[i], x, y - r - 9);
  }
  const cnt = b.length;
  if (!VS.frozen[i]) {
    const bx = x + r * 0.64, by = y + r * 0.64;
    g.fillStyle = 'rgba(10,10,28,0.88)'; g.beginPath(); g.arc(bx, by, 9.5, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#fff'; g.font = `800 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(cnt, bx, by + 0.5);
  }

}

function drawPreview() {
  if (sel < 0 || busy) return;
  const r = Ru.sow(R.S, 0, sel, { reverse: R.lightNext });
  const drops = r.ev.filter(e => e.t === 'drop').map(e => e.cell);
  const pts = [cellPos(sel), ...drops.map(cellPos)];
  g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(120,230,255,0.7)'; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round'; g.shadowColor = '#5fd8ff'; g.shadowBlur = 12;
  g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.restore();
  const last = drops[drops.length - 1], [lx, ly] = cellPos(last);
  g.save(); g.strokeStyle = '#ffe14d'; g.lineWidth = 3; g.shadowColor = '#ffe14d'; g.shadowBlur = 14;
  g.beginPath(); g.arc(lx, ly, cellR(last) + 7, 0, 7); g.stroke(); g.restore();
  const cap = r.ev.find(e => e.t === 'capture');
  const label = r.extra ? 'もう1回' : cap ? `${cap.colors.length}個とる` : '';
  if (label) sticker(label, clamp(lx, 50, W - 50), ly - cellR(last) - 20, 15);
  const gain = r.S.beads[Ru.goalOf(r.S, 0)].length - R.S.beads[Ru.goalOf(R.S, 0)].length;
  const tap = 'もう一度タップで流す' + (gain > 0 ? `（ゴールに +${gain}）` : '');
  g.fillStyle = '#ffe48a'; g.font = `700 11px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText(tap, W - 20, 402);
}

function cutIn(a, p) {
  const k = p < 0.2 ? eout(p / 0.2) : p > 0.8 ? 1 - eio((p - 0.8) / 0.2) : 1, col = D.EL_COLOR[a.el], im = IMG[a.img];
  g.save();
  g.globalAlpha = k;
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, W, H);
  g.translate(0, 230);
  g.rotate(-0.08);
  const band = g.createLinearGradient(0, 0, W, 0); band.addColorStop(0, rgb(col, 0.95)); band.addColorStop(1, rgb(col, 0.4));
  g.fillStyle = band; g.fillRect(-40, 0, W + 80, 150);
  g.restore();
  g.save();
  g.globalAlpha = k;
  if (im) {
    const h = 420, w = h * im.width / im.height, x = lerp(-w, 0, k) + 10;
    g.drawImage(im, x, 120, w, h);
  }
  sticker(a.skillName, 265, 262, 26, 0.9 + 0.1 * k, k, RAINBOW);
  g.fillStyle = '#fff'; g.font = `800 13px ${FONT}`; g.textAlign = 'center'; g.fillText(a.name, 265, 300);
  g.restore();
}

function floorCard(e, p) {
  const k = p < 0.35 ? eout(p / 0.35) : p > 0.75 ? 1 - eio((p - 0.75) / 0.25) : 1;
  const boss = e.n === D.FLOORS.length - 1, col = boss ? [255, 90, 140] : [150, 120, 255];
  g.save();
  g.globalAlpha = k;
  g.fillStyle = 'rgba(6,4,16,0.94)'; g.fillRect(-10, -10, W + 20, H + 20);
  g.translate(195, 360);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.rotate(now * 0.3);
  for (let i = 0; i < 16; i++) {
    g.rotate(Math.PI / 8);
    const rg = g.createLinearGradient(0, 0, 0, -320);
    rg.addColorStop(0, rgb(col, 0.35)); rg.addColorStop(1, rgb(col, 0));
    g.fillStyle = rg; g.beginPath(); g.moveTo(0, 0); g.lineTo(-18, -320); g.lineTo(18, -320); g.fill();
  }
  g.restore();
  const s = 0.8 + 0.2 * eback(clamp(p / 0.35));
  g.scale(s, s);
  g.font = `400 84px ${NUMF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = 14; g.strokeStyle = '#1a0a30'; g.strokeText(`${e.n + 1}F`, 0, 0);
  const tg = g.createLinearGradient(0, -40, 0, 40);
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.5, boss ? '#ffb0c8' : '#ffe9a8'); tg.addColorStop(1, boss ? '#ff4d7e' : '#d89a3a');
  g.fillStyle = tg; g.fillText(`${e.n + 1}F`, 0, 0);
  g.restore();
  g.save();
  g.globalAlpha = k;
  g.fillStyle = '#fff'; g.font = `900 18px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(boss ? 'ボス戦' : `${e.enemies.length}体の敵があらわれた`, 195, 440);
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `800 13px ${FONT}`;
  g.fillText(D.BOARDS[e.board].name, 195, 468);
  const lw = 120 * k;
  const lg = g.createLinearGradient(195 - lw, 0, 195 + lw, 0); lg.addColorStop(0, 'rgba(255,225,140,0)'); lg.addColorStop(0.5, 'rgba(255,225,140,0.9)'); lg.addColorStop(1, 'rgba(255,225,140,0)');
  g.fillStyle = lg; g.fillRect(195 - lw, 452, lw * 2, 1.5);
  g.restore();
}

function elemBurst(x, y, el) {
  const col = D.EL_COLOR[el], R2 = Math.random;
  rings.push({ x, y, t: 0, life: 0.45, col, max: 80, w: 6 });
  for (let k = 0; k < 10; k++) { const a = R2() * 7, v = 120 + R2() * 160; fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.35 + R2() * 0.25, r: 2 + R2() * 2, col: [255, 255, 255], kind: 'dot', grav: 0 }); }
  if (el === 'fire') {
    for (let k = 0; k < 24; k++) fx.push({ x: x + (R2() - 0.5) * 40, y: y + (R2() - 0.5) * 30, vx: (R2() - 0.5) * 160, vy: -60 - R2() * 220, t: 0, life: 0.5 + R2() * 0.5, r: 4 + R2() * 7, col: R2() < 0.5 ? [255, 210, 90] : col, kind: 'flame', grav: -60 });
  } else if (el === 'water') {
    rings.push({ x, y, t: -0.12, life: 0.55, col, max: 120, w: 3 });
    for (let k = 0; k < 22; k++) { const a = -Math.PI * R2(), v = 140 + R2() * 220; fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.6 + R2() * 0.4, r: 2.5 + R2() * 3.5, col: R2() < 0.4 ? [210, 240, 255] : col, kind: 'dot', grav: 520 }); }
  } else if (el === 'wood') {
    for (let k = 0; k < 20; k++) { const a = R2() * 7, v = 80 + R2() * 180; fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, t: 0, life: 0.8 + R2() * 0.5, r: 4 + R2() * 4, col: R2() < 0.5 ? [150, 240, 120] : col, kind: 'leaf', grav: 160, rot: R2() * 7, spin: (R2() - 0.5) * 12 }); }
  } else if (el === 'light') {
    for (let k = 0; k < 12; k++) fx.push({ x, y, vx: 0, vy: 0, t: 0, life: 0.45 + R2() * 0.2, r: 70 + R2() * 70, col: [255, 236, 160], kind: 'ray', grav: 0, rot: (k / 12) * Math.PI * 2 + R2() * 0.2 });
  } else {
    for (let k = 0; k < 26; k++) fx.push({ x, y, vx: 0, vy: 0, t: 0, life: 0.6 + R2() * 0.3, r: 2.5 + R2() * 3, col: R2() < 0.4 ? [255, 160, 255] : col, kind: 'swirl', grav: 0, rot: R2() * 7, rad: 70 + R2() * 40 });
  }
}

function drawPops(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const o = rings[i];
    o.t += dt * SPD;
    if (o.t >= o.life) { rings.splice(i, 1); continue; }
    if (o.t < 0) continue;
    const k = o.t / o.life;
    g.save(); g.globalCompositeOperation = 'lighter';
    g.strokeStyle = rgb(o.col.map(v => Math.min(255, v + 80)), 1 - k); g.lineWidth = o.w * (1 - k) + 1;
    g.beginPath(); g.arc(o.x, o.y, 12 + eout(k) * o.max, 0, 7); g.stroke(); g.restore();
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt * SPD;
    if (f.t >= f.life) { fx.splice(i, 1); continue; }
    const k = f.t / f.life, a = 1 - k;
    f.x += f.vx * dt * SPD; f.y += f.vy * dt * SPD; f.vy += (f.grav == null ? 300 : f.grav) * dt * SPD;
    g.save();
    g.globalCompositeOperation = 'lighter';
    if (f.kind === 'flame') {
      const rr2 = f.r * (1 - k * 0.5), fg = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, rr2);
      fg.addColorStop(0, `rgba(255,250,220,${a})`); fg.addColorStop(0.4, rgb(f.col, a * 0.8)); fg.addColorStop(1, rgb(f.col, 0));
      g.fillStyle = fg; g.beginPath(); g.arc(f.x, f.y, rr2, 0, 7); g.fill();
    } else if (f.kind === 'leaf') {
      g.globalCompositeOperation = 'source-over';
      f.rot += f.spin * dt * SPD; f.vx *= 0.97;
      g.translate(f.x, f.y); g.rotate(f.rot); g.fillStyle = rgb(f.col, a);
      g.beginPath(); g.ellipse(0, 0, f.r, f.r * 0.45, 0, 0, 7); g.fill();
      g.strokeStyle = `rgba(40,90,30,${a})`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-f.r, 0); g.lineTo(f.r, 0); g.stroke();
    } else if (f.kind === 'ray') {
      const len = f.r * eout(Math.min(1, k * 2));
      g.translate(f.x, f.y); g.rotate(f.rot);
      const lg = g.createLinearGradient(0, 0, len, 0); lg.addColorStop(0, rgb(f.col, a)); lg.addColorStop(1, rgb(f.col, 0));
      g.fillStyle = lg; g.beginPath(); g.moveTo(0, -3 * a); g.lineTo(len, 0); g.lineTo(0, 3 * a); g.fill();
    } else if (f.kind === 'swirl') {
      const ang = f.rot + k * 6, rad = f.rad * (1 - k);
      g.fillStyle = rgb(f.col, a); g.beginPath(); g.arc(f.x + Math.cos(ang) * rad, f.y + Math.sin(ang) * rad * 0.8, f.r, 0, 7); g.fill();
    } else {
      g.fillStyle = rgb(f.col, a); g.beginPath(); g.arc(f.x, f.y, f.r, 0, 7); g.fill();
    }
    g.restore();
  }
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.t += dt * SPD;
    const k = p.t / p.dur;
    if (k >= 1) { pops.splice(i, 1); continue; }
    const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1, s = eback(clamp(k / 0.2));
    if (p.kind === 'dmg') {
      g.save(); g.globalAlpha = a; g.translate(p.x, p.y - eout(k) * 30); g.scale(s, s);
      g.font = `400 ${p.size}px ${NUMF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = p.size * 0.26; g.strokeStyle = 'rgba(20,8,36,0.95)'; g.strokeText(p.text, 0, 0);
      const c = p.color || [255, 255, 255], dg = g.createLinearGradient(0, -p.size / 2, 0, p.size / 2);
      dg.addColorStop(0, '#ffffff'); dg.addColorStop(0.55, rgb(c.map(v => Math.min(255, v + 90)))); dg.addColorStop(1, rgb(c));
      g.fillStyle = dg; g.fillText(p.text, 0, 0);
      g.restore();
    } else {
      sticker(p.text, p.x, p.y - eout(k) * 10, p.size, s, a, p.kind === 'rainbow' ? RAINBOW : null);
    }
  }
  // 敵の攻撃の爪あと
  const ck = (now - clawFrom) * SPD / 0.6;
  if (ck >= 0 && ck < 1) {
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 3; j++) {
      const d = eout(Math.min(1, ck * 2.5)), x0 = 110 + j * 70, y0 = 230 + j * 6;
      g.strokeStyle = `rgba(255,${120 + j * 40},${140 + j * 30},${1 - ck})`; g.lineWidth = 7 * (1 - ck) + 1; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + 90 * d, y0 + 150 * d); g.stroke();
    }
    g.restore();
  }
}

// ---------- まわす ----------
let last = 0;
function frame(ts) {
  tick(Math.min(0.05, (ts - last) / 1000 || 0));
  last = ts;
  requestAnimationFrame(frame);
}
function tick(dt) {
  now += dt;
  if (!cur && steps.length) {
    cur = steps.shift();
    try { cur.start && cur.start(); } catch (err) { console.error(err); cur = null; hand = null; }
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  shakeT = Math.max(0, shakeT - dt);
  const sh = shakeT > 0 ? shakeAmp * (shakeT / 0.4) : 0;
  if (!shakeT) shakeAmp = 0;
  g.save();
  g.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
  drawBg();
  if (R) {
    drawEnemies();
    drawTop();
    drawBand();
    drawBoard();
  }
  if (cur) {
    cur.t += dt * SPD;
    const p = clamp(cur.t / cur.dur);
    try {
      cur.draw && cur.draw(p);
      if (p >= 1) { cur.finish && cur.finish(); cur = null; }
    } catch (err) {
      // 演出の1つが失敗しても止まらないよう、その演出だけとばす（最後に R へ合わせなおす）
      console.error(err);
      cur = null;
      hand = null;
    }
  }
  drawPops(dt);
  g.restore();
  if (redFlash > 0) {
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(255,30,60,0)'); vg.addColorStop(1, `rgba(255,30,60,${redFlash * 0.55})`);
    g.fillStyle = vg; g.fillRect(-10, -10, W + 20, H + 20); redFlash = Math.max(0, redFlash - dt * 2.5);
  }
  if (busy && !cur && !steps.length) {
    busy = false;
    hand = null;
    enemyBanner = 0;
    syncFromR();
    if (R.over) showResult();
  }
  if (!busy && R && !R.over && auto && $('title').hidden) autoStep();
}

// ---------- はじまり・おわり ----------
function startRun() {
  const seed = Q.get('seed') ? +Q.get('seed') : (Date.now() % 1e9) | 0;
  R = Bt.newRun(seed);
  const f0 = Q.get('floor') ? clamp(+Q.get('floor') - 1, 0, 4) : 0;
  const ev = [];
  Bt.gotoFloor(R, f0, ev);
  if (Q.get('board')) R.S = { ...R.S, id: Q.get('board') };
  VE = [];
  syncFromR();
  sel = -1; morph = null; hand = null; steps = []; cur = null; pops.length = 0; fx.length = 0;
  enqueue(ev);
}
function showResult() {
  const win = R.over === 'win';
  $('rBig').textContent = win ? 'クリア！' : 'まけちゃった…';
  $('rSub').textContent = win ? `万華鏡の魔女をたおした！ のこりHP ${R.team.hp} / ${R.team.max}` : `${R.floor + 1}F で力つきた`;
  $('result').hidden = false;
  BM.music.stop();
  A.SE[win ? 'win' : 'lose']();
}

// 自動で遊ぶ（?auto=1、確かめ用）
const auto = Q.has('auto');
let autoWait = 0;
function autoStep() {
  autoWait += 1;
  if (autoWait < 20) return;
  autoWait = 0;
  const si = R.allies.findIndex((a, i) => Bt.canUseSkill(R, i));
  if (si >= 0) { enqueue(Bt.useSkill(R, si)); return; }
  const ms = Ru.legalMoves(R.S, 0);
  if (!ms.length) { enqueue(Bt.startTurn(R)); return; }
  const val = m => { const r = Ru.sow(R.S, 0, m); return r.S.beads[Ru.goalOf(r.S, 0)].length + (r.extra ? 2 : 0); };
  enqueue(Bt.playerMove(R, ms.reduce((b, m) => (val(m) > val(b) ? m : b), ms[0])));
}

function init() {
  resize();
  window.addEventListener('resize', resize);
  cv.addEventListener('pointerup', onTap);
  $('title').addEventListener('pointerup', () => { A.wake(); setTimeout(() => { if (!$('title').hidden) BM.music.play('title'); }, 60); });
  $('startBtn').addEventListener('click', () => { A.wake(); $('title').hidden = true; startRun(); });
  $('howBtn').addEventListener('click', () => { A.wake(); A.SE.select(); $('how').hidden = false; });
  $('howClose').addEventListener('click', () => { A.SE.select(); $('how').hidden = true; });
  $('againBtn').addEventListener('click', () => { A.wake(); $('result').hidden = true; startRun(); });
  $('skUse').addEventListener('click', () => {
    A.wake();
    const i = skillOpen;
    closeSkill();
    if (i >= 0 && !busy) { sel = -1; enqueue(Bt.useSkill(R, i)); }
  });
  $('skClose').addEventListener('click', closeSkill);
  const fonts = document.fonts ? Promise.all([document.fonts.load('400 20px "Dela Gothic One"'), document.fonts.load('800 14px "M PLUS Rounded 1c"'), document.fonts.load('900 14px "M PLUS Rounded 1c"')]).catch(() => {}) : Promise.resolve();
  Promise.all([loadImages(), fonts]).then(() => {
    if (Q.has('go')) { $('title').hidden = true; startRun(); }
    requestAnimationFrame(frame);
  });
}
init();

// 確かめ用に外から見られるようにしておく
BM.view = { get R() { return R; }, get busy() { return busy; }, enqueue, ff(sec) { for (let k = 0; k < sec * 20; k++) tick(0.05); } };
})(globalThis.BM = globalThis.BM || {});
