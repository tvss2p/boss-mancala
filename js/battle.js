// 番の流れ・攻撃・敵の行動・スキル・階の進行（できごとの列 ev を返す。描画はしない）
(function (BM) {
'use strict';
const D = BM.data, Ru = BM.rules;
const ELI = el => D.EL.indexOf(el);

function makeEnemy(spec) {
  const base = D.ENEMIES[spec.id] || {};
  const e = { ...base, ...spec };
  return {
    id: e.id, name: e.name, el: e.el, img: e.img, boss: !!e.boss,
    hp: e.hp, max: e.hp, atk: e.atk, cd: e.cd, cdMax: e.cd,
    moves: e.moves.slice(), mi: 0, reshape: (e.reshape || []).slice(), shapeStep: 0,
  };
}

function newRun(seed) {
  const rnd = Ru.rng(seed);
  const allies = D.ALLIES.map(a => ({ ...a, charge: 0 }));
  const max = allies.reduce((s, a) => s + a.hp, 0);
  const R = { seed, rnd, floor: 0, team: { hp: max, max }, allies, enemies: [], S: null, target: null, lightNext: false, boost: 1, rage: 0, turn: 'player', over: null };
  gotoFloor(R, 0, []);
  return R;
}

function gotoFloor(R, n, ev) {
  const F = D.FLOORS[n];
  R.floor = n;
  R.S = Ru.newBoard(F.board, R.rnd);
  R.enemies = F.foes.map(makeEnemy);
  R.target = null;
  R.lightNext = false;
  R.rage = 0;
  ev.push({ t: 'floor', n, board: F.board, S: Ru.clone(R.S), enemies: R.enemies.map(e => ({ ...e })) });
}

const alive = R => R.enemies.map((e, i) => i).filter(i => R.enemies[i].hp > 0);

function autoTarget(R, el) {
  const a = alive(R);
  if (!a.length) return -1;
  if (R.target != null && R.enemies[R.target] && R.enemies[R.target].hp > 0) return R.target;
  const strong = a.filter(i => D.mult(el, R.enemies[i].el) === 2);
  const pool = strong.length ? strong : a;
  return pool.reduce((b, i) => (R.enemies[i].hp < R.enemies[b].hp ? i : b), pool[0]);
}

function setTarget(R, i) {
  if (R.enemies[i] && R.enemies[i].hp > 0) R.target = i;
}

function damage(R, i, dmg, ev) {
  const e = R.enemies[i];
  e.hp = Math.max(0, e.hp - dmg);
  if (e.hp <= 0) {
    ev.push({ t: 'kill', enemy: i });
    if (R.target === i) R.target = null;
    return;
  }
  while (e.boss && e.shapeStep < e.reshape.length && e.hp / e.max <= e.reshape[e.shapeStep][0]) {
    const id = e.reshape[e.shapeStep][1];
    e.shapeStep++;
    R.S = { ...Ru.clone(R.S), id };
    ev.push({ t: 'reshape', enemy: i, board: id });
  }
}

// ---------- じぶんの番 ----------
function playerMove(R, cell) {
  if (R.over || R.turn !== 'player' || !Ru.legalMoves(R.S, 0).includes(cell)) return [];
  const ev = [];
  const reverse = R.lightNext;
  R.lightNext = false;
  const r = Ru.sow(R.S, 0, cell, { reverse });
  R.S = r.S;
  ev.push({ t: 'sow', side: 0, cell, reverse, ev: r.ev });
  if (r.extra && Ru.legalMoves(R.S, 0).length) return ev;
  endPlayerTurn(R, ev);
  return ev;
}

function endPlayerTurn(R, ev) {
  const g = Ru.goalOf(R.S, 0), beads = R.S.beads[g];
  const count = [0, 0, 0, 0, 0], plus = [0, 0, 0, 0, 0];
  beads.forEach(c => { count[c % 5]++; if (c >= 5) plus[c % 5]++; });
  const colors = count.filter(n => n > 0).length;
  const bonus = 1 + D.TUNE.multiColorBonus * Math.max(0, colors - 1);
  R.allies.forEach((a, ai) => {
    const n = count[ELI(a.el)], p = plus[ELI(a.el)];
    if (!n) return;
    const t = autoTarget(R, a.el);
    if (t < 0) return;
    const m = D.mult(a.el, R.enemies[t].el);
    const dmg = Math.round(a.atk * (n + D.TUNE.plusExtra * p) * m * bonus * R.boost);
    ev.push({ t: 'attack', ally: ai, enemy: t, n, plus: p, dmg, mult: m, boost: R.boost });
    damage(R, t, dmg, ev);
  });
  R.boost = 1;
  const used = beads.length;
  if (used) {
    R.S.beads[g] = [];
    const f = Ru.refill(R.S, used, R.rnd);
    R.S = f.S;
    ev.push({ t: 'refill', ev: f.ev });
  }
  R.allies.forEach(a => { a.charge = Math.min(a.cost, a.charge + 1); });
  tickCells(R, ev);
  if (checkFloor(R, ev)) return;
  enemyTurn(R, ev);
  if (R.team.hp <= 0) {
    R.team.hp = 0;
    R.over = 'lose';
    ev.push({ t: 'lose' });
    return;
  }
  startTurn(R, ev);
}

function tickCells(R, ev) {
  const S = R.S;
  S.frozen = S.frozen.map(n => Math.max(0, n - 1));
  S.seized.forEach((n, i) => {
    if (!n) return;
    S.seized[i] = n - 1;
    if (S.seized[i] === 0) {
      S.owner[i] = 1;
      ev.push({ t: 'unseize', cell: i });
    }
  });
}

// 白い穴が動かせないあいだは番を飛ばす
function startTurn(R, ev = []) {
  let guard = 0;
  while (!R.over && !Ru.legalMoves(R.S, 0).length && guard++ < 20) {
    ev.push({ t: 'skip' });
    tickCells(R, ev);
    enemyTurn(R, ev);
    if (R.team.hp <= 0) {
      R.team.hp = 0;
      R.over = 'lose';
      ev.push({ t: 'lose' });
    }
  }
  R.turn = 'player';
  return ev;
}

function checkFloor(R, ev) {
  if (alive(R).length) return false;
  if (R.floor + 1 >= D.FLOORS.length) {
    R.over = 'win';
    ev.push({ t: 'win' });
    return true;
  }
  gotoFloor(R, R.floor + 1, ev);
  startTurn(R, ev);
  return true;
}

// ---------- 敵の番 ----------
function scoreMove(S, cell) {
  const g = Ru.goalOf(S, 1), r = Ru.sow(S, 1, cell);
  return r.S.beads[g].length - S.beads[g].length + (r.extra ? 1.5 : 0);
}

function chooseEnemyMove(R, moves) {
  const smart = R.enemies.some(e => e.boss && e.hp > 0);
  if (!smart && R.rnd() < D.TUNE.weakFoeRandom) return moves[(R.rnd() * moves.length) | 0];
  let best = moves[0], bv = -1;
  for (const m of moves) {
    const v = scoreMove(R.S, m);
    if (v > bv) { bv = v; best = m; }
  }
  return best;
}

function enemyTurn(R, ev) {
  for (let k = 0; k < 3; k++) {
    const moves = Ru.legalMoves(R.S, 1);
    if (!moves.length) break;
    const cell = chooseEnemyMove(R, moves);
    const r = Ru.sow(R.S, 1, cell);
    R.S = r.S;
    ev.push({ t: 'sow', side: 1, cell, ev: r.ev });
    if (!r.extra) break;
  }
  const g = Ru.goalOf(R.S, 1), got = R.S.beads[g].length;
  if (got) {
    R.rage += got;
    R.S.beads[g] = [];
    const f = Ru.refill(R.S, got, R.rnd);
    R.S = f.S;
    ev.push({ t: 'rage', n: got, total: R.rage });
    ev.push({ t: 'refill', ev: f.ev });
  }
  for (const i of alive(R)) {
    const e = R.enemies[i];
    e.cd -= 1;
    if (e.cd > 0) continue;
    e.cd = e.cdMax;
    const move = e.moves[e.mi % e.moves.length];
    e.mi++;
    if (move === 'hit') {
      const dmg = Math.round(e.atk * (1 + D.TUNE.rageStep * R.rage));
      R.rage = 0;
      R.team.hp = Math.max(0, R.team.hp - dmg);
      ev.push({ t: 'enemyHit', enemy: i, dmg });
      if (R.team.hp <= 0) return;
    } else {
      applyTech(R, i, move, ev);
    }
  }
}

const whitePits = S => S.owner.map((o, i) => i).filter(i => !Ru.isGoal(S, i) && S.owner[i] === 0);
const blackPits = S => S.owner.map((o, i) => i).filter(i => !Ru.isGoal(S, i) && S.owner[i] === 1);
const most = (S, list) => list.reduce((b, i) => (b < 0 || S.beads[i].length > S.beads[b].length ? i : b), -1);
const fewest = (S, list) => list.reduce((b, i) => (b < 0 || S.beads[i].length < S.beads[b].length ? i : b), -1);

function applyTech(R, i, kind, ev) {
  const S = R.S, e = R.enemies[i];
  let cells = [];
  if (kind === 'freeze') {
    const w = whitePits(S).filter(c => !S.frozen[c]).sort((a, b) => S.beads[b].length - S.beads[a].length);
    cells = w.slice(0, 2);
    cells.forEach(c => { S.frozen[c] = D.TUNE.freezeTurns; });
  } else if (kind === 'paint') {
    const w = whitePits(S).filter(c => !S.seized[c]);
    if (w.length > D.TUNE.minWhite) {
      const c = most(S, w);
      S.owner[c] = 1;
      cells = [c];
    }
  } else if (kind === 'steal') {
    const from = most(S, whitePits(S).filter(c => !S.frozen[c] && S.beads[c].length));
    const to = fewest(S, blackPits(S).filter(c => !S.frozen[c]));
    if (from >= 0 && to >= 0) {
      const n = S.beads[from].length;
      S.beads[to].push(...S.beads[from]);
      S.beads[from] = [];
      ev.push({ t: 'tech', enemy: i, kind, cells: [from, to], n });
      return;
    }
    ev.push({ t: 'tech', enemy: i, kind, cells: [], miss: true });
    return;
  } else if (kind === 'reverse') {
    S.dir *= -1;
  } else if (kind === 'recolor') {
    const weak = D.EL.find(x => D.mult(x, e.el) === 0.5) || e.el;
    const pool = [], picked = [];
    whitePits(S).forEach(c => S.beads[c].forEach((_, k) => pool.push([c, k])));
    for (let n = 0; n < D.TUNE.recolorCount && pool.length; n++) {
      const [c, k] = pool.splice((R.rnd() * pool.length) | 0, 1)[0];
      S.beads[c][k] = ELI(weak);
      picked.push([c, k]);
      if (!cells.includes(c)) cells.push(c);
    }
    ev.push({ t: 'tech', enemy: i, kind, cells, color: ELI(weak), slots: picked });
    return;
  }
  ev.push({ t: 'tech', enemy: i, kind, cells });
}

// ---------- スキル ----------
function skillTargets(R, a) {
  const S = R.S, home = D.BOARDS[S.id].cells;
  if (a.skill === 'thaw') {
    const painted = S.owner.map((o, i) => i).filter(i => home[i].kind === 'pit' && home[i].owner === 0 && S.owner[i] === 1);
    if (painted.length) return { painted: painted[0] };
    const fz = whitePits(S).filter(c => S.frozen[c]);
    return fz.length ? { frozen: fz[0] } : null;
  }
  if (a.skill === 'seize') {
    const b = blackPits(S).filter(c => !Ru.isGoal(S, c));
    return b.length ? { cell: most(S, b) } : null;
  }
  if (a.skill === 'bless') return whitePits(S).some(c => S.beads[c].some(x => x < 5)) ? {} : null;
  if (a.skill === 'boost') return R.boost > 1 ? null : {};
  return {};
}

function canUseSkill(R, i) {
  const a = R.allies[i];
  return !R.over && R.turn === 'player' && a.charge >= a.cost && !!skillTargets(R, a);
}

function useSkill(R, i) {
  if (!canUseSkill(R, i)) return [];
  const a = R.allies[i], S = R.S, tg = skillTargets(R, a);
  let cells = [];
  if (a.skill === 'evenFire') {
    cells = whitePits(S).filter((c, k) => k % 2 === 1);
    cells.forEach(c => { S.beads[c] = S.beads[c].map(x => ELI('fire') + (x >= 5 ? 5 : 0)); });
  } else if (a.skill === 'thaw') {
    if (tg.painted != null) { S.owner[tg.painted] = 0; cells = [tg.painted]; }
    else { S.frozen[tg.frozen] = 0; cells = [tg.frozen]; }
  } else if (a.skill === 'heal') {
    R.team.hp = Math.min(R.team.max, R.team.hp + Math.round(R.team.max * D.TUNE.healRate));
    const c = most(S, whitePits(S));
    if (c >= 0) { S.beads[c] = S.beads[c].map(x => ELI('wood') + (x >= 5 ? 5 : 0)); cells = [c]; }
  } else if (a.skill === 'reverseOnce') {
    R.lightNext = true;
  } else if (a.skill === 'seize') {
    S.owner[tg.cell] = 0;
    S.seized[tg.cell] = D.TUNE.seizeTurns;
    cells = [tg.cell];
  }
  let slots;
  if (a.skill === 'bless') {
    const pool = [];
    whitePits(S).forEach(c => S.beads[c].forEach((x, k) => { if (x < 5) pool.push([c, k]); }));
    slots = [];
    for (let n = 0; n < D.TUNE.blessCount && pool.length; n++) {
      const [c, k] = pool.splice((R.rnd() * pool.length) | 0, 1)[0];
      S.beads[c][k] += 5;
      slots.push([c, k]);
      if (!cells.includes(c)) cells.push(c);
    }
  } else if (a.skill === 'boost') {
    R.boost = D.TUNE.boostRate;
  }
  a.charge = 0;
  return [{ t: 'skill', ally: i, kind: a.skill, cells, slots }];
}

BM.battle = { makeEnemy, newRun, gotoFloor, setTarget, autoTarget, damage, playerMove, startTurn, checkFloor, enemyTurn, applyTech, canUseSkill, useSkill, alive };
})(globalThis.BM = globalThis.BM || {});
