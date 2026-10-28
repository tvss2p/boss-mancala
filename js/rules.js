// 盤の状態と1手の処理（描画とは切りはなした純粋な関数）
(function (BM) {
'use strict';
const D = BM.data;

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const board = S => D.BOARDS[S.id];
const isGoal = (S, i) => board(S).cells[i].kind === 'goal';
const goalOf = (S, side) => board(S).cells.findIndex(c => c.kind === 'goal' && c.owner === side);

function newBoard(id, rnd) {
  const cells = D.BOARDS[id].cells;
  return {
    id,
    beads: cells.map(c => (c.kind === 'goal' ? [] : Array.from({ length: D.TUNE.beadsPerPit }, () => (rnd() * 5) | 0))),
    owner: cells.map(c => c.owner),
    frozen: cells.map(() => 0),
    seized: cells.map(() => 0),
    dir: 1,
  };
}

function clone(S) {
  return { ...S, beads: S.beads.map(b => b.slice()), owner: S.owner.slice(), frozen: S.frozen.slice(), seized: S.seized.slice() };
}

function legalMoves(S, side) {
  const m = [];
  S.beads.forEach((b, i) => { if (!isGoal(S, i) && S.owner[i] === side && !S.frozen[i] && b.length) m.push(i); });
  return m;
}

function sow(S0, side, cell, opt = {}) {
  const S = clone(S0), n = S.beads.length, dir = opt.reverse ? -S.dir : S.dir;
  const myG = goalOf(S, side), opG = goalOf(S, 1 - side);
  const hand = S.beads[cell];
  S.beads[cell] = [];
  const ev = [{ t: 'pick', cell, colors: hand.slice() }];
  let pos = cell;
  for (const c of hand) {
    let guard = 0;
    do { pos = (pos + dir + n) % n; } while ((pos === opG || S.frozen[pos]) && ++guard < n);
    S.beads[pos].push(c);
    ev.push({ t: 'drop', cell: pos, color: c });
  }
  if (pos === myG) {
    ev.push({ t: 'extra' });
    return { S, ev, extra: true };
  }
  const opp = board(S).opposite[pos];
  if (!isGoal(S, pos) && S.owner[pos] === side && S.beads[pos].length === 1 && opp != null && S.beads[opp].length && !S.frozen[opp]) {
    const colors = S.beads[opp].concat(S.beads[pos]);
    S.beads[opp] = [];
    S.beads[pos] = [];
    S.beads[myG].push(...colors);
    ev.push({ t: 'capture', from: opp, cell: pos, to: myG, colors });
  }
  return { S, ev, extra: false };
}

function refill(S0, n, rnd) {
  const S = clone(S0), ev = [];
  for (let k = 0; k < n; k++) {
    let cand = S.beads.map((b, i) => i).filter(i => !isGoal(S, i) && !S.frozen[i]);
    if (!cand.length) cand = S.beads.map((b, i) => i).filter(i => !isGoal(S, i));
    const min = Math.min(...cand.map(i => S.beads[i].length));
    const low = cand.filter(i => S.beads[i].length === min);
    const cell = low[(rnd() * low.length) | 0], color = ((rnd() * 5) | 0) + (rnd() < D.TUNE.plusRate ? 5 : 0);
    S.beads[cell].push(color);
    ev.push({ t: 'fall', cell, color });
  }
  return { S, ev };
}

const totalBeads = S => S.beads.reduce((a, b) => a + b.length, 0);

BM.rules = { rng, isGoal, goalOf, newBoard, clone, legalMoves, sow, refill, totalBeads };
})(globalThis.BM = globalThis.BM || {});
