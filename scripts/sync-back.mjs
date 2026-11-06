// 一次性反同步：把 sprites.ts 的当前贴图数据写回 e-*/i-* 数据模块
// 原因：EPX 放大 + 手工修补都直接改 sprites.ts，模块数据已整体脱节
import fs from 'node:fs';

const SRC = 'src/art/sprites.ts';
const src = fs.readFileSync(SRC, 'utf8');
const KVAL = 0x1a1420;

// ---- 1) 解析 sprites.ts 全部条目 ----
// 按 "key: '" 位置切段，段内提取 palette / rows / extraFrames
const keyPos = [...src.matchAll(/key: '([^']+)'/g)];
const entries = {};
for (let i = 0; i < keyPos.length; i++) {
  const key = keyPos[i][1];
  const start = keyPos[i].index;
  const end = i + 1 < keyPos.length ? keyPos[i + 1].index : src.length;
  const seg = src.slice(start, end);

  const palM = seg.match(/palette: \{([^}]*)\}/);
  if (!palM) continue;
  const palette = {};
  for (const pm of palM[1].matchAll(/\b([A-Za-z])\s*(:)?\s*(0x[0-9a-fA-F]+|\d+)?/g)) {
    if (!pm[2] && !pm[3]) { palette[pm[1]] = KVAL; continue; } // 简写 K
    palette[pm[1]] = pm[3].startsWith('0x') ? parseInt(pm[3]) : parseInt(pm[3], 10);
  }

  const rowsM = seg.match(/rows: \[([\s\S]*?)\]/);
  if (!rowsM) continue;
  const frames = [[...rowsM[1].matchAll(/'([^']*)'/g)].map(x => x[1])];

  const exM = seg.match(/extraFrames: \[([\s\S]*)\],\n\s*\}/);
  if (exM) {
    for (const fm of exM[1].matchAll(/\[([\s\S]*?)\]/g)) {
      const rows = [...fm[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
      if (rows.length) frames.push(rows);
    }
  }
  entries[key] = { palette, frames };
}
console.log('解析条目:', Object.keys(entries).length);

// ---- 2) 逐模块重写 E 数组 ----
const mods = process.argv[2]
  ? [process.argv[2]]
  : ['e-forest', 'e-castle', 'e-boss', 'e-minion',
     'i-pick', 'i-icon-weapons', 'i-icon-evolved', 'i-icon-passives',
     'i-bld-forest', 'i-bld-castle', 'i-prop-forest', 'i-prop-castle'];

const hex = (n) => '0x' + n.toString(16).padStart(6, '0');
const emitFrames = (frames) =>
  frames.map(f => '[\n' + f.map(r => `        '${r}',`).join('\n') + '\n      ]').join(',\n      ');

let totalUpdated = 0;
for (const mod of mods) {
  const path = `scripts/${mod}.mjs`;
  const orig = fs.readFileSync(path, 'utf8');

  // 提取该模块声明的 key 顺序 + 每条目前的注释
  const keyRe = /((?:\s*\/\/[^\n]*)*)\s*\{\s*key: '([^']+)'/g;
  const metas = [];
  let km;
  while ((km = keyRe.exec(orig))) {
    metas.push({ comment: km[1].replace(/^\s+/, '  ').trimEnd(), key: km[2] });
  }
  if (!metas.length) { console.log(`${mod}: 无 key，跳过`); continue; }

  // 保留头部 const 声明（K 常量、S 助手等）
  const headM = orig.match(/^[\s\S]*?(?=export const E)/);
  const head = (headM ? headM[0] : "const K = 0x1a1420;\n").replace(/const S = [^\n]*\n/, '');

  let body = 'export const E = [\n';
  let missing = 0;
  for (const { comment, key } of metas) {
    const e = entries[key];
    if (!e) { console.log(`  ! ${key} 在 sprites.ts 中不存在`); missing++; continue; }
    const w = Math.max(...e.frames[0].map(r => r.length));
    const h = e.frames[0].length;
    const pal = Object.entries(e.palette).map(([c, v]) => `${c}: ${hex(v)}`).join(', ');
    if (comment) body += comment + '\n';
    body += `  { key: '${key}', w: ${w}, h: ${h},\n`;
    body += `    palette: { ${pal} },\n`;
    body += `    frames: [\n      ${emitFrames(e.frames)},\n    ],\n  },\n`;
  }
  body += '];\n';

  fs.writeFileSync(path, head + body);
  console.log(`${mod}: ${metas.length - missing}/${metas.length} 条目已同步`);
  totalUpdated += metas.length;
}
console.log('完成, 共', totalUpdated, '条');
