// Q版角色生成器：24x32，头大身小比例，自动描边
// 用法: node scripts/chibi-chars.mjs        —— 打印预览行（不落盘）
//       node scripts/chibi-chars.mjs apply  —— 替换 sprites.ts 角色段
import fs from 'node:fs';
import path from 'node:path';

const W = 24, H = 32;
const K = 0x1a1420;

const grid = () => Array.from({ length: H }, () => Array(W).fill('.'));
const px = (g, x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
const rect = (g, x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(g, x + i, y + j, c); };
// 自动描边：透明像素若与实色像素 4 邻接 -> K
function outline(g) {
  const n = g.map((r) => [...r]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] !== '.') continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = g[y + dy]?.[x + dx];
      if (v && v !== '.' && v !== 'K') { n[y][x] = 'K'; break; }
    }
  }
  return n;
}
const rowsOf = (g) => outline(g).map((r) => r.join(''));

// ---------- 基础身体 ----------
// 头 x6..17 y3..13 | 躯干 x7..16 y14..22 | 手臂 x4-5/x18-19 | 腿 y23..29 | 脚 y30-31
// pose: stand | walkA（左腿领前）| walkB（右腿领前）；跨步帧交错腿+反向摆臂
function body(g, pose = 'stand') {
  const walk = pose !== 'stand';
  const lead = pose === 'walkB' ? 'R' : 'L';
  rect(g, 7, 2, 10, 1, 'H'); rect(g, 6, 3, 12, 9, 'H'); rect(g, 7, 12, 10, 1, 'H');
  rect(g, 9, 8, 2, 2, 'E'); rect(g, 14, 8, 2, 2, 'E');
  rect(g, 8, 14, 8, 1, 'T'); rect(g, 7, 15, 10, 7, 'T');
  const armDyL = walk ? (lead === 'L' ? 1 : -1) : 0;
  rect(g, 5, 15 + armDyL, 2, 6, 'S'); rect(g, 18, 15 - armDyL, 2, 6, 'S');
  rect(g, 5, 21 + armDyL, 2, 2, 'H'); rect(g, 18, 21 - armDyL, 2, 2, 'H');
  if (walk) {
    const lx = lead === 'L' ? 7 : 13, rx = lead === 'L' ? 14 : 8;
    rect(g, lx, 23, 3, 6, 'B'); rect(g, lx - 1, 29, 4, 2, 'F');
    rect(g, rx, 22, 3, 5, 'B'); rect(g, rx + 1, 27, 4, 2, 'F');
  } else {
    rect(g, 8, 23, 3, 6, 'B'); rect(g, 13, 23, 3, 6, 'B');
    rect(g, 7, 29, 4, 2, 'F'); rect(g, 13, 29, 4, 2, 'F');
  }
}

function bodyUp(g, pose = 'stand') {
  const walk = pose !== 'stand';
  const lead = pose === 'walkB' ? 'R' : 'L';
  rect(g, 7, 2, 10, 1, 'C'); rect(g, 6, 3, 12, 9, 'C'); rect(g, 7, 12, 10, 1, 'C');
  rect(g, 8, 14, 8, 1, 'T'); rect(g, 7, 15, 10, 7, 'T');
  const armDyL = walk ? (lead === 'L' ? 1 : -1) : 0;
  rect(g, 5, 15 + armDyL, 2, 6, 'S'); rect(g, 18, 15 - armDyL, 2, 6, 'S');
  rect(g, 5, 21 + armDyL, 2, 2, 'H'); rect(g, 18, 21 - armDyL, 2, 2, 'H');
  if (walk) {
    const lx = lead === 'L' ? 7 : 13, rx = lead === 'L' ? 14 : 8;
    rect(g, lx, 23, 3, 6, 'B'); rect(g, lx - 1, 29, 4, 2, 'F');
    rect(g, rx, 22, 3, 5, 'B'); rect(g, rx + 1, 27, 4, 2, 'F');
  } else {
    rect(g, 8, 23, 3, 6, 'B'); rect(g, 13, 23, 3, 6, 'B');
    rect(g, 7, 29, 4, 2, 'F'); rect(g, 13, 29, 4, 2, 'F');
  }
}

function bodySide(g, pose = 'stand') {
  const walk = pose !== 'stand';
  rect(g, 7, 2, 10, 1, 'H'); rect(g, 6, 3, 12, 9, 'H'); rect(g, 7, 12, 10, 1, 'H');
  rect(g, 7, 8, 2, 2, 'E'); px(g, 6, 10, 'h');
  rect(g, 8, 14, 8, 1, 'T'); rect(g, 7, 15, 10, 7, 'T');
  const armDy = walk ? (pose === 'walkA' ? 1 : -1) : 0;
  rect(g, 6, 15 + armDy, 2, 6, 'S'); rect(g, 6, 21 + armDy, 2, 2, 'H');
  if (walk) {
    const fwd = pose === 'walkA';
    rect(g, fwd ? 8 : 13, 23, 3, 6, 'B'); rect(g, fwd ? 7 : 14, 29, 4, 2, 'F');
    rect(g, fwd ? 13 : 9, 22, 3, 5, 'B'); rect(g, fwd ? 14 : 8, 27, 4, 2, 'F');
  } else {
    rect(g, 9, 23, 3, 6, 'B'); rect(g, 13, 23, 3, 6, 'B');
    rect(g, 8, 29, 4, 2, 'F'); rect(g, 13, 29, 4, 2, 'F');
  }
}

// 头部区域整行平移（跨步帧的头身起伏：A上拔/B下压）
function shiftHead(g, dy) {
  if (dy < 0) {
    for (let y = 0; y < 13; y++) g[y] = g[y + 1];
    g[13] = Array(W).fill('.');
  } else {
    for (let y = 13; y > 0; y--) g[y] = g[y - 1];
    g[0] = Array(W).fill('.');
  }
}

// ---------- 头饰 ----------
const HATS = {
  knightHelm: (g, v) => {
    if (v === 'up') { rect(g, 6, 2, 12, 11, 'M'); rect(g, 10, 0, 4, 3, 'R'); }
    else if (v === 'side') { rect(g, 6, 2, 12, 6, 'M'); rect(g, 6, 2, 12, 1, 'm'); rect(g, 10, 0, 5, 3, 'R'); }
    else {
      rect(g, 6, 2, 12, 6, 'M'); rect(g, 6, 2, 12, 1, 'm'); // 盔体
      rect(g, 10, 0, 4, 3, 'R'); // 红缨
      rect(g, 7, 7, 3, 1, 'm'); rect(g, 15, 7, 3, 1, 'm'); // 颊甲
    }
  },
  pointyHat: (g, v, c1 = 'T', c2 = 't') => {
    px(g, 11, 0, c1); px(g, 12, 0, c1); rect(g, 10, 1, 4, 1, c1); rect(g, 9, 2, 6, 1, c1);
    rect(g, 8, 3, 8, 1, c1); rect(g, 7, 4, 10, 1, c1); // 尖顶
    rect(g, 4, 5, 16, 2, c1); rect(g, 4, 5, 16, 1, c2); // 大帽檐
    if (v === 'up') rect(g, 6, 7, 12, 6, c1); else rect(g, 6, 7, 12, 1, c2); // 帽檐下沿
  },
  hood: (g, v, c1 = 'T', c2 = 't') => {
    rect(g, 6, 1, 12, 3, c1); rect(g, 5, 3, 14, 9, c1);
    if (v === 'up') { rect(g, 5, 3, 14, 10, c1); }
    else {
      rect(g, 8, 4, 8, 8, 'H'); // 露出脸
      rect(g, 9, 8, 2, 2, 'E'); rect(g, 14, 8, 2, 2, 'E');
      if (v === 'side') { rect(g, 7, 4, 6, 8, 'H'); rect(g, 7, 8, 2, 2, 'E'); px(g, 6, 10, 'h'); }
    }
  },
  circlet: (g, v) => rect(g, 6, 4, 12, 1, 'A'), // 额环
  feather: (g, v) => { rect(g, 6, 1, 12, 4, 'T'); rect(g, 6, 4, 12, 1, 't'); px(g, 17, 1, 'R'); px(g, 18, 0, 'R'); px(g, 18, 1, 'R'); px(g, 19, 0, 'R'); },
  bare: () => {},
};

// ---------- 手持物（画在身体右侧/前侧） ----------
const HELD = {
  sword: (g, v) => {
    if (v === 'up') { rect(g, 19, 10, 2, 9, 'M'); px(g, 19, 9, 'A'); px(g, 20, 9, 'A'); return; }
    const x = v === 'side' ? 4 : 20;
    rect(g, x, 8, 1, 11, 'M'); rect(g, x + 1, 8, 1, 11, 'm');
    px(g, x - 1, 19, 'A'); px(g, x, 19, 'A'); px(g, x + 1, 19, 'A'); px(g, x + 2, 19, 'A');
    rect(g, x, 20, 2, 3, 'x'); // 柄
  },
  staff: (g, v) => {
    const x = v === 'side' ? 4 : 20;
    rect(g, x, 6, 1, 17, 'x'); px(g, x + 1, 6, 'x');
    rect(g, x - 1, 3, 3, 3, 'X'); px(g, x, 2, 'X'); px(g, x, 4, 'W'); // 顶珠+高光
    if (v === 'up') { rect(g, 19, 8, 1, 12, 'x'); }
  },
  dagger: (g, v) => {
    const xs = v === 'side' ? [4] : [4, 20];
    for (const x of xs) { rect(g, x, 17, 1, 4, 'M'); rect(g, x + 1, 17, 1, 4, 'm'); rect(g, x, 21, 2, 2, 'x'); }
  },
  axe: (g, v) => {
    const x = v === 'side' ? 3 : 20;
    rect(g, x, 10, 1, 13, 'x');
    rect(g, x - 1, 10, 3, 4, 'M'); px(g, x - 1, 9, 'M'); px(g, x + 1, 9, 'M');
  },
  bow: (g, v) => {
    const x = v === 'side' ? 3 : 19;
    px(g, x, 8, 'x'); px(g, x + 1, 9, 'x'); px(g, x + 1, 10, 'x'); px(g, x, 11, 'x');
    px(g, x, 12, 'x'); px(g, x + 1, 13, 'x'); px(g, x + 1, 14, 'x'); px(g, x, 15, 'x');
    for (let y = 9; y <= 14; y++) px(g, x + 2, y, 'W'); // 弦
  },
  mace: (g, v) => {
    const x = v === 'side' ? 4 : 20;
    rect(g, x, 14, 1, 9, 'x'); rect(g, x - 1, 11, 3, 3, 'M'); px(g, x, 10, 'M');
  },
  lantern: (g, v) => {
    const x = v === 'side' ? 4 : 20;
    rect(g, x, 16, 1, 4, 'x'); rect(g, x - 1, 20, 3, 4, 'x'); px(g, x, 21, 'W'); px(g, x, 22, 'W'); // 灯光
  },
  flask: (g, v) => {
    const x = v === 'side' ? 4 : 19;
    rect(g, x, 18, 3, 4, 'X'); px(g, x + 1, 17, 'x'); px(g, x, 18, 'W'); // 圆瓶+塞+高光
  },
  broom: (g, v) => {
    const x = v === 'side' ? 3 : 19;
    for (let i = 0; i < 10; i++) px(g, x + (i >> 2), 14 + i, 'x'); // 斜杆
    rect(g, x + 2, 24, 4, 5, 'X'); px(g, x + 5, 26, 'X'); px(g, x + 5, 28, 'X'); // 帚头
  },
  beads: (g, v) => { // 手持念珠串
    const x = v === 'side' ? 4 : 19;
    px(g, x, 20, 'A'); px(g, x + 1, 21, 'A'); px(g, x + 2, 22, 'A'); px(g, x + 1, 23, 'A'); px(g, x, 22, 'A');
  },
  rapier: (g, v) => {
    const x = v === 'side' ? 3 : 20;
    for (let i = 0; i < 9; i++) px(g, x - (i >> 1), 8 + i, 'M'); // 斜细剑
    px(g, x - 1, 17, 'A'); px(g, x, 17, 'A'); px(g, x + 1, 17, 'A'); rect(g, x, 18, 1, 3, 'x');
  },
  lute: (g, v) => {
    const x = v === 'side' ? 3 : 18;
    rect(g, x, 16, 4, 5, 'x'); px(g, x + 3, 15, 'x'); px(g, x + 4, 14, 'x'); px(g, x + 4, 15, 'x'); // 琴身+琴颈
    px(g, x + 1, 18, 'K'); // 音孔
  },
  none: () => {},
};

// ---------- 角色定义 ----------
// H=肤亮 h=肤暗 E=眼 C=发 c=发暗 T=服亮 t=服暗 A=点缀 B=裤 F=鞋 M=金亮 m=金暗 X=持物亮 x=持物暗 W=高光白 R=特殊 R2
const CHARS = [
  {
    id: 'knight',
    palette: { S: 0x6a7288, H: 0xe8c090, h: 0xc89868, E: K, C: 0x6a6a7a, c: 0x4a4a58, T: 0x8890a8, t: 0x5a627a, A: 0xd8a832, B: 0x4a4a58, F: 0x3a3430, M: 0xd0d8e8, m: 0x98a0b8, X: 0xd0d8e8, x: 0x6a4a2a, W: 0xffffff, R: 0xd04030 },
    draw: (g, v) => {
      HATS.knightHelm(g, v);
      rect(g, 10, 16, 4, 3, 'A'); // 胸口金徽
      HELD.sword(g, v);
      if (v !== 'up') { rect(g, 9, 22, 2, 1, 't'); rect(g, 14, 22, 2, 1, 't'); }
    },
  },
  {
    id: 'mage',
    palette: { S: 0x4a2a78, H: 0xf0d0a8, h: 0xd0a878, E: K, C: 0x8a6a4a, c: 0x5a4a3a, T: 0x6a3fa0, t: 0x4a2a78, A: 0x53d8fb, B: 0x4a2a78, F: 0x3a3430, M: 0x8a6a4a, m: 0x5a4a3a, X: 0x53d8fb, x: 0x6a4a2a, W: 0xffffff, R: 0x53d8fb },
    draw: (g, v) => {
      HATS.pointyHat(g, v, 'T', 't');
      rect(g, 7, 21, 10, 1, 'A'); // 袍摆青纹
      HELD.staff(g, v);
    },
  },
  {
    id: 'rogue',
    palette: { S: 0x28282f, H: 0xe8c090, h: 0xc89868, E: 0x53d85c, C: 0x3a3a46, c: 0x28282f, T: 0x3a3a46, t: 0x28282f, A: 0x8a5a2a, B: 0x28282f, F: 0x201c18, M: 0xd0d8e8, m: 0x98a0b8, X: 0xd0d8e8, x: 0x4a3428, W: 0xffffff, R: 0x8a5a2a },
    draw: (g, v) => {
      HATS.hood(g, v, 'C', 'c');
      rect(g, 7, 19, 10, 2, 'A'); // 皮甲胸带
      HELD.dagger(g, v);
    },
  },
  {
    id: 'berserker',
    palette: { S: 0xb08858, H: 0xd8a878, h: 0xb08858, E: K, C: 0xa03828, c: 0x78281c, T: 0x8a5a30, t: 0x6a4020, A: 0xd0d8e8, B: 0x6a4a2a, F: 0x3a2a1a, M: 0xd0d8e8, m: 0x98a0b8, X: 0xd0d8e8, x: 0x6a4a2a, W: 0xffffff, R: 0xe8e0d0 },
    draw: (g, v) => {
      // 双角盔
      rect(g, 6, 2, 12, 5, 'M'); px(g, 4, 2, 'R'); px(g, 3, 1, 'R'); px(g, 4, 1, 'R'); px(g, 19, 2, 'R'); px(g, 20, 1, 'R'); px(g, 19, 1, 'R');
      rect(g, 8, 5, 8, 1, 'm');
      if (v !== 'up') { rect(g, 9, 5, 6, 2, 'C'); } // 红发露出
      rect(g, 7, 15, 10, 3, 'C'); // 毛皮护肩
      rect(g, 9, 19, 6, 1, 'A');
      HELD.axe(g, v);
    },
  },
  {
    id: 'hunter',
    palette: { S: 0x34582a, H: 0xe8c090, h: 0xc89868, E: K, C: 0x6a4a2a, c: 0x4a3420, T: 0x4a7a3c, t: 0x34582a, A: 0x8a5a2a, B: 0x6a4a2a, F: 0x3a2a1a, M: 0x8a5a2a, m: 0x6a4020, X: 0x8a5a2a, x: 0x6a4a2a, W: 0xe8e0d0, R: 0x4a7a3c },
    draw: (g, v) => {
      HATS.hood(g, v, 'R', 't'); // 绿兜帽
      rect(g, 7, 17, 10, 2, 'A'); // 皮甲
      HELD.bow(g, v);
    },
  },
  {
    id: 'cleric',
    palette: { S: 0xd0c8b0, H: 0xf0d0a8, h: 0xd0a878, E: K, C: 0xe8e0d0, c: 0xc0b8a8, T: 0xf0e8d0, t: 0xd0b860, A: 0xd8a832, B: 0xf0e8d0, F: 0x6a4a2a, M: 0xe8e8f0, m: 0xb0b8c8, X: 0xd0d8e8, x: 0x8a6a4a, W: 0xffffff, R: 0xd8a832 },
    draw: (g, v) => {
      HATS.circlet(g, v);
      rect(g, 10, 15, 4, 1, 'A'); rect(g, 11, 16, 2, 4, 'A'); // 胸前金十字
      HELD.mace(g, v);
    },
  },
  {
    id: 'necro',
    palette: { S: 0x28203a, H: 0xe8e0d0, h: 0xc8c0b0, E: 0x7ce85c, C: 0x3a2a4a, c: 0x28203a, T: 0x3a2a4a, t: 0x28203a, A: 0x7ce85c, B: 0x28203a, F: 0x201c28, M: 0x8a8a9a, m: 0x5a5a6a, X: 0xd8a832, x: 0x4a3428, W: 0xd8ffb0, R: 0x7ce85c },
    draw: (g, v) => {
      HATS.hood(g, v, 'C', 'c');
      if (v !== 'up') rect(g, 9, 5, 6, 2, 'h'); // 阴影面罩上沿
      px(g, 11, 16, 'A'); px(g, 12, 16, 'A'); px(g, 11, 17, 'A'); px(g, 12, 17, 'A'); // 绿宝石
      HELD.lantern(g, v);
    },
  },
  {
    id: 'assassin',
    palette: { S: 0x1c1a24, H: 0xe8c090, h: 0xc89868, E: 0xf0f0f0, C: 0x2a2832, c: 0x1c1a24, T: 0x2a2832, t: 0x1c1a24, A: 0xd04030, B: 0x1c1a24, F: 0x18151c, M: 0xd0d8e8, m: 0x98a0b8, X: 0xe8e8f0, x: 0x3a2a20, W: 0xffffff, R: 0xd04030 },
    draw: (g, v) => {
      HATS.hood(g, v, 'C', 'c');
      if (v !== 'up') rect(g, 8, 10, 8, 2, 'A'); // 红面罩
      HELD.dagger(g, v);
    },
  },
  {
    id: 'alchemist',
    palette: { S: 0x34582a, H: 0xf0d0a8, h: 0xd0a878, E: K, C: 0x8a4a2a, c: 0x6a3420, T: 0x4a7a3c, t: 0x34582a, A: 0xd8a832, B: 0x5a4a3a, F: 0x3a2a1a, M: 0x53d8fb, m: 0x3898b8, X: 0x7ce85c, x: 0x8a5a2a, W: 0xffffff, R: 0x53d8fb },
    draw: (g, v) => {
      HATS.bare(g, v);
      rect(g, 7, 1, 10, 3, 'C'); rect(g, 6, 3, 12, 2, 'C'); // 棕发
      if (v !== 'up') { rect(g, 7, 5, 10, 2, 'M'); px(g, 10, 5, 'W'); px(g, 15, 5, 'W'); } // 额前护目镜
      rect(g, 7, 18, 10, 2, 'A'); rect(g, 9, 19, 2, 1, 'X'); rect(g, 13, 19, 2, 1, 'X'); // 药瓶腰带
      HELD.flask(g, v);
    },
  },
  {
    id: 'witch',
    palette: { S: 0x40205a, H: 0xf0d0a8, h: 0xd0a878, E: 0x7ce85c, C: 0x28202a, c: 0x1c1820, T: 0x5a2a78, t: 0x40205a, A: 0x7ce85c, B: 0x40205a, F: 0x28202a, M: 0xd8a832, m: 0xa07828, X: 0x8a6a4a, x: 0x6a4a2a, W: 0xd8ffb0, R: 0x7ce85c },
    draw: (g, v) => {
      // 歪尖帽（尖往右歪）
      px(g, 15, 0, 'T'); px(g, 14, 1, 'T'); rect(g, 13, 2, 4, 1, 'T'); rect(g, 11, 3, 6, 1, 'T'); rect(g, 9, 4, 9, 1, 'T');
      rect(g, 4, 5, 16, 2, 'T'); rect(g, 4, 5, 16, 1, 't');
      px(g, 10, 3, 'M'); // 帽上金星
      if (v === 'up') rect(g, 6, 7, 12, 6, 'T'); else rect(g, 6, 7, 12, 1, 't');
      rect(g, 7, 21, 10, 1, 'A');
      HELD.broom(g, v);
    },
  },
  {
    id: 'monk',
    palette: { S: 0xb08858, H: 0xd8a878, h: 0xb08858, E: K, C: 0xd8a878, c: 0xb08858, T: 0xe07820, t: 0xb05818, A: 0xf0e8d0, B: 0xb05818, F: 0x6a4a2a, M: 0xd0d8e8, m: 0x98a0b8, X: 0xa03828, x: 0x6a4a2a, W: 0xffffff, R: 0xf0e8d0 },
    draw: (g, v) => {
      HATS.bare(g, v); // 光头
      if (v === 'up') rect(g, 6, 3, 12, 9, 'H'); // 后脑也是皮肤
      rect(g, 7, 15, 10, 3, 'T'); rect(g, 9, 15, 6, 7, 'T'); // 橙袍（斜披感：右肩露肤）
      if (v !== 'up') { rect(g, 13, 15, 4, 3, 'H'); }
      rect(g, 10, 20, 4, 2, 'A'); // 白腰带
      HELD.beads(g, v);
    },
  },
  {
    id: 'duelist',
    palette: { S: 0x1c3464, H: 0xf0d0a8, h: 0xd0a878, E: K, C: 0x3a3a46, c: 0x28282f, T: 0x2a4a8a, t: 0x1c3464, A: 0xd8a832, B: 0xe8e0d0, F: 0x3a2a1a, M: 0xd0d8e8, m: 0x98a0b8, X: 0xe8e8f0, x: 0x6a4a2a, W: 0xffffff, R: 0xd04030 },
    draw: (g, v) => {
      HATS.feather(g, v); // 蓝帽+红羽
      if (v !== 'up') { rect(g, 9, 11, 6, 1, 'C'); } // 小胡子
      rect(g, 7, 15, 10, 2, 'A'); rect(g, 10, 17, 4, 5, 't'); // 金胸衬+深蓝开襟
      HELD.rapier(g, v);
    },
  },
  {
    id: 'ronin',
    // 浪人：斗笠遮脸+靛蓝和服+腰刀（隐藏角色，斗场霸主解锁）
    palette: { H: 0xd8b088, h: 0xb08858, E: K, C: 0x2a2228, c: 0x1c161a, T: 0x2e3a52, t: 0x1e2838, S: 0x2e3a52, A: 0xd8b060, B: 0x3a3230, F: 0x2a2428, M: 0xd0d8e8, m: 0x98a0b8, X: 0xf0e8d0, x: 0x4a3020, W: 0xffffff, R: 0xa03828 },
    draw: (g, v) => {
      // 斗笠：尖顶三角笠盖住大半头，笠缘压到眼上
      px(g, 12, 0, 'A'); px(g, 11, 0, 'A');
      rect(g, 9, 1, 6, 1, 'A');
      rect(g, 7, 2, 10, 1, 'A'); rect(g, 7, 2, 10, 1, 'x');
      rect(g, 5, 3, 14, 1, 'A'); rect(g, 5, 3, 14, 1, 'x');
      rect(g, 4, 4, 16, 1, 'x');
      if (v === 'up') rect(g, 6, 5, 12, 8, 'x'); else rect(g, 6, 4, 12, 1, 'x');
      // 和服：白襟领 + 腰带
      if (v !== 'up') {
        px(g, 11, 15, 'W'); px(g, 12, 15, 'W');
        px(g, 10, 16, 'W'); px(g, 13, 16, 'W');
        px(g, 10, 17, 'W'); px(g, 13, 17, 'W');
      }
      rect(g, 7, 18, 10, 2, 'R'); // 朱红腰带
      HELD.sword(g, v);
    },
  },
  {
    id: 'bard',
    palette: { S: 0x2a5836, H: 0xf0d0a8, h: 0xd0a878, E: K, C: 0x8a5a2a, c: 0x6a4020, T: 0x3c7a4a, t: 0x2a5836, A: 0xd04030, B: 0x3c5a8a, F: 0x3a2a1a, M: 0xd0d8e8, m: 0x98a0b8, X: 0x8a5a2a, x: 0x6a4a2a, W: 0xffffff, R: 0xd04030 },
    draw: (g, v) => {
      // 双色帽+羽
      rect(g, 6, 1, 12, 3, 'T'); rect(g, 12, 1, 6, 3, 'A'); rect(g, 6, 3, 12, 1, 't');
      px(g, 18, 0, 'R'); px(g, 19, 0, 'R'); px(g, 18, 1, 'R');
      rect(g, 7, 17, 10, 1, 'A'); // 红腰带
      HELD.lute(g, v);
    },
  },
];

// ---------- 生成 ----------
function buildChar(c) {
  const mk = (view, pose) => {
    const g = grid();
    if (view === 'up') bodyUp(g, pose); else if (view === 'side') bodySide(g, pose); else body(g, pose);
    c.draw(g, view);
    if (pose === 'walkA') shiftHead(g, -1);
    if (pose === 'walkB') shiftHead(g, 1);
    return rowsOf(g);
  };
  // 四相步法：站立→跨A→站立→跨B
  const fr = (view) => [mk(view, 'walkA'), mk(view, 'stand'), mk(view, 'walkB')];
  return [
    { key: `tex_char_${c.id}`, palette: c.palette, rows: mk('front', 'stand'), extraFrames: fr('front') },
    { key: `tex_char_${c.id}_up`, palette: c.palette, rows: mk('up', 'stand'), extraFrames: fr('up') },
    { key: `tex_char_${c.id}_side`, palette: c.palette, rows: mk('side', 'stand'), extraFrames: fr('side') },
  ];
}

const hex = (n) => '0x' + n.toString(16).padStart(6, '0');
function emit(entries) {
  return entries.map((e) => {
    const pal = 'palette: { K, ' + Object.entries(e.palette).map(([k, v]) => `${k}: ${hex(v)}`).join(', ') + ' }';
    const rows = e.rows.map((r) => `      '${r}',`).join('\n');
    const ex = e.extraFrames.map((f) => `    [\n${f.map((r) => `      '${r}',`).join('\n')}\n    ],`).join('\n');
    return `  {\n    key: '${e.key}',\n    ${pal},\n    rows: [\n${rows}\n    ],\n    extraFrames: [\n${ex}\n    ],\n  },`;
  }).join('\n');
}

const entries = CHARS.flatMap(buildChar);

if (process.argv[2] === 'apply') {
  const file = path.resolve(import.meta.dirname, '../src/art/sprites.ts');
  let src = fs.readFileSync(file, 'utf8');
  const head = '  // ============ 角色 ============\n';
  const tail = '  // ============ 敌人 ============';
  const i = src.indexOf(head), j = src.indexOf(tail);
  if (i < 0 || j < 0) throw new Error('找不到角色段边界');
  src = src.slice(0, i + head.length) + emit(entries) + '\n' + src.slice(j);
  fs.writeFileSync(file, src);
  console.log('角色段已替换:', entries.length, '个条目');
} else {
  const k = process.argv[2];
  const e = entries.find((x) => x.key.includes(k || 'knight')) || entries[0];
  console.log(e.key, '\n' + e.rows.join('\n'));
}
