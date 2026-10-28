// 属性・キャラ・敵・盤の形・ステージの表（数値はここだけで調整する）
(function (BM) {
'use strict';

const EL = ['fire', 'water', 'wood', 'light', 'dark'];
const EL_NAME = { fire: '火', water: '水', wood: '木', light: '光', dark: '闇' };
const EL_COLOR = { fire: [255, 110, 70], water: [80, 170, 255], wood: [110, 220, 110], light: [255, 220, 110], dark: [190, 110, 255] };
const STRONG = { fire: 'wood', wood: 'water', water: 'fire', light: 'dark', dark: 'light' };

function mult(atk, def) {
  if (STRONG[atk] === def) return 2;
  if (STRONG[def] === atk && atk !== 'light' && atk !== 'dark') return 0.5;
  return 1;
}

// ---------- 盤 ----------
// cells は流れる順。x,y は 0〜1。0〜5 じぶん、6 じぶんのゴール、7〜12 敵、13 敵のゴール（eight だけ持ち主が3つずつ交互）
const KALAH_OWN = i => (i <= 6 ? 0 : 1);
const KALAH_OPP = {};
for (let i = 0; i <= 5; i++) { KALAH_OPP[i] = 12 - i; KALAH_OPP[12 - i] = i; }

function kalahCells(pos) {
  const cells = [];
  for (let i = 0; i < 14; i++) {
    const [x, y] = pos(i);
    cells.push({ x, y, kind: i === 6 || i === 13 ? 'goal' : 'pit', owner: KALAH_OWN(i) });
  }
  return cells;
}
const ang = i => Math.PI - (i + 1) * (Math.PI * 2 / 14);
// 盤の枠（画面の座標で 370×436）。x,y は枠の幅・高さに対する割合
const BOX = { w: 370, h: 436 };
const px = (x, y) => [0.5 + x / BOX.w, 0.5 + y / BOX.h];

const BOARDS = {
  std: {
    name: 'ふつうの盤',
    cells: kalahCells(i => {
      if (i <= 5) return [0.66, 0.8125 - 0.125 * i];
      if (i === 6) return [0.5, 0.075];
      if (i <= 12) return [0.34, 0.1875 + 0.125 * (i - 7)];
      return [0.5, 0.925];
    }),
    opposite: KALAH_OPP,
  },
  ring: {
    name: '輪っかの盤',
    cells: kalahCells(i => px(148 * Math.cos(ang(i)), 160 * Math.sin(ang(i)))),
    opposite: KALAH_OPP,
  },
  tile: {
    name: 'タイルの盤',
    cells: kalahCells(i => {
      const c = Math.cos(ang(i)), s = Math.sin(ang(i)), k = 1 / Math.max(Math.abs(c), Math.abs(s));
      return px(140 * c * k, 160 * s * k);
    }),
    opposite: KALAH_OPP,
  },
  warp: {
    name: 'ゆがんだ盤',
    cells: kalahCells(i => {
      const a = ang(i), r = 1 + 0.17 * Math.sin(2 * a + 2.9), x = 138 * r * Math.cos(a), y = 150 * r * Math.sin(a), t = 0.3;
      return px(x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t));
    }),
    opposite: KALAH_OPP,
  },
  eight: {
    name: '8の字の盤',
    cells: (() => {
      const own = [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1];
      const cells = [];
      for (let i = 0; i < 14; i++) {
        const t = (i - 6) * Math.PI * 2 / 14 + Math.PI, [x, y] = px(128 * Math.sin(2 * t), 176 * Math.cos(t));
        cells.push({ x, y, kind: i === 6 || i === 13 ? 'goal' : 'pit', owner: own[i] });
      }
      return cells;
    })(),
    opposite: KALAH_OPP,
  },
};

// 穴の半径：となりどうしが 6px 以上あき、枠に収まるいちばん大きな大きさ（穴は最大28px、ゴールは穴の1.3倍）
const LAYOUT = {};
function layout(id) {
  if (LAYOUT[id]) return LAYOUT[id];
  const cs = BOARDS[id].cells.map(c => ({ x: c.x * BOX.w, y: c.y * BOX.h, goal: c.kind === 'goal' }));
  const f = c => (c.goal ? 1.3 : 1);
  let r = 28;
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    r = Math.min(r, a.x / f(a), (BOX.w - a.x) / f(a), a.y / f(a), (BOX.h - a.y) / f(a));
    for (let j = i + 1; j < cs.length; j++) {
      const b = cs[j];
      r = Math.min(r, (Math.hypot(a.x - b.x, a.y - b.y) - 6) / (f(a) + f(b)));
    }
  }
  LAYOUT[id] = { cells: cs.map(c => ({ ...c, r: r * f(c) })), pitR: r };
  return LAYOUT[id];
}

// ---------- 味方 ----------
const ALLIES = [
  { id: 'fire', el: 'fire', name: 'カレン', atk: 60, hp: 200, skill: 'evenFire', skillName: 'ほのおの陣', cost: 4, img: 'ally_fire' },
  { id: 'water', el: 'water', name: 'セイラン', atk: 55, hp: 200, skill: 'thaw', skillName: 'とかす水', cost: 4, img: 'ally_water' },
  { id: 'wood', el: 'wood', name: 'リーフィ', atk: 45, hp: 200, skill: 'heal', skillName: 'いやしの森', cost: 5, img: 'ally_wood' },
  { id: 'light', el: 'light', name: 'アルト', atk: 50, hp: 200, skill: 'bless', skillName: '祝福の光', cost: 4, img: 'ally_light' },
  { id: 'dark', el: 'dark', name: 'ノクス', atk: 70, hp: 200, skill: 'boost', skillName: '闇の契約', cost: 5, img: 'ally_dark' },
];
const SKILL_TEXT = {
  evenFire: '偶数番目の白い穴の玉を、ぜんぶ火にする',
  thaw: '塗られた穴を1つ白にもどす（なければ、こおりを1つとかす）',
  heal: 'チームのHPを30%回復。玉がいちばん多い白い穴を木にする',
  reverseOnce: '次の1回だけ、逆向きに流せる',
  seize: '玉がいちばん多い黒い穴を、3ターンのあいだ白にする',
  bless: '白い穴の玉6個を、光る強化玉にする（ゴールに入れると1.5倍）',
  boost: 'このターンの攻撃が、ぜんぶ2倍になる',
};

// ---------- 敵 ----------
const ENEMIES = {
  imp: { name: 'ほのおの小鬼', el: 'fire', hp: 320, atk: 80, cd: 2, moves: ['hit'], img: 'enemy_fire' },
  jelly: { name: 'みずクラゲ', el: 'water', hp: 360, atk: 70, cd: 3, moves: ['freeze', 'hit'], img: 'enemy_water' },
  shroom: { name: 'きのこ兵', el: 'wood', hp: 400, atk: 65, cd: 3, moves: ['hit'], img: 'enemy_wood' },
  angel: { name: 'ガラスの天使', el: 'light', hp: 380, atk: 75, cd: 3, moves: ['hit'], img: 'enemy_light' },
  bat: { name: 'かげコウモリ', el: 'dark', hp: 340, atk: 90, cd: 2, moves: ['hit', 'recolor'], img: 'enemy_dark' },
  witch: {
    name: '万華鏡の魔女', el: 'dark', hp: 3400, atk: 135, cd: 2, boss: true, img: 'boss_dark',
    moves: ['hit', 'steal', 'hit', 'reverse', 'hit', 'freeze'],
    reshape: [[0.66, 'tile'], [0.33, 'warp']],
  },
};
const TECH_NAME = { freeze: 'こおらせる', paint: '塗りかえ', steal: 'さらう', reverse: '逆まわり', recolor: '色を変える', reshape: '組みかえ' };

// ---------- ステージ ----------
const FLOORS = [
  { board: 'std', foes: [{ id: 'imp' }, { id: 'shroom' }] },
  { board: 'std', foes: [{ id: 'jelly' }, { id: 'imp' }, { id: 'shroom' }] },
  { board: 'ring', foes: [{ id: 'angel' }, { id: 'bat' }] },
  { board: 'eight', foes: [{ id: 'shroom' }, { id: 'jelly' }, { id: 'angel', moves: ['paint', 'hit'] }] },
  { board: 'ring', foes: [{ id: 'witch' }] },
];

const TUNE = {
  beadsPerPit: 4,
  multiColorBonus: 0.25,
  rageStep: 0.15,
  healRate: 0.3,
  freezeTurns: 3,
  seizeTurns: 3,
  recolorCount: 6,
  minWhite: 2,
  weakFoeRandom: 0.5,
  plusRate: 0.1,
  plusExtra: 0.5,
  blessCount: 6,
  boostRate: 2,
};

BM.data = { BOX, layout, EL, EL_NAME, EL_COLOR, STRONG, mult, BOARDS, ALLIES, SKILL_TEXT, ENEMIES, TECH_NAME, FLOORS, TUNE };
})(globalThis.BM = globalThis.BM || {});
