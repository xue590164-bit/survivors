import fs from 'node:fs';
// 敌人/Boss 高清化：画布 ~1.5×，双色调明暗，每怪 3 帧
import { E as FOREST } from './e-forest.mjs';
import { E as CASTLE } from './e-castle.mjs';
import { E as DESERT } from './e-desert.mjs';
import { E as TUNDRA } from './e-tundra.mjs';
import { E as BOSS } from './e-boss.mjs';
import { E as MINION } from './e-minion.mjs';

const ALL = [...FOREST, ...CASTLE, ...BOSS, ...DESERT, ...TUNDRA];

function norm(rows, W, H) {
  const out = rows.map((r) => {
    const s = r.replace(/ /g, '.');
    if (s.length > W) return s.slice(0, W);
    const pad = W - s.length;
    const l = Math.floor(pad / 2);
    return '.'.repeat(l) + s + '.'.repeat(pad - l);
  });
  while (out.length < H) out.push(out[out.length - 1]);
  return out.slice(0, H);
}

function esc(rows) {
  return rows.map((r) => `      '${r}',`).join('\n');
}
function palStr(p) {
  return Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(', ');
}

function gen(list) {
  let code = '';
  for (const e of list) {
    const P = palStr(e.palette);
    const [f0, ...rest] = e.frames.map((r) => norm(r, e.w, e.h));
    code += `  {\n    key: '${e.key}',\n    palette: { ${P} },\n    rows: [\n${esc(f0)}\n    ],\n`;
    if (rest.length) code += `    extraFrames: [${rest.map((f) => `[\n${esc(f)}\n    ]`).join(',\n')}],\n`;
    code += '  },\n';
  }
  return code;
}

function lint() {
  let bad = 0;
  for (const e of [...ALL, ...MINION]) {
    const pal = new Set(Object.keys(e.palette));
    for (const [fi, frame] of e.frames.entries()) {
      const over = frame.some((r) => r.length > e.w);
      if (over) { console.log(`${e.key}#${fi} 行宽超${e.w}`); bad++; }
      for (const r of frame) for (const ch of r) {
        if (ch !== '.' && ch !== ' ' && !pal.has(ch)) { console.log(`${e.key}#${fi} 未知字符 '${ch}' 于 ${r}`); bad++; }
      }
    }
  }
  return bad;
}

if (process.argv[2] === 'apply') {
  const path = 'src/art/sprites.ts';
  let src = fs.readFileSync(path, 'utf8');
  const rep = (markA, markB, code) => {
    const a = src.indexOf(markA), b = src.indexOf(markB);
    if (a < 0 || b < 0) throw 'marker missing: ' + markA;
    src = src.slice(0, a) + markA + '\n' + code + src.slice(b);
  };
  const DESERT_MOBS = DESERT.filter((e) => e.key.startsWith('tex_enemy_'));
  const DESERT_BOSSES = DESERT.filter((e) => e.key.startsWith('tex_boss_'));
  const TUNDRA_MOBS = TUNDRA.filter((e) => e.key.startsWith('tex_enemy_'));
  const TUNDRA_BOSSES = TUNDRA.filter((e) => e.key.startsWith('tex_boss_'));
  rep('  // ============ 敌人 ============', '  // ============ 古堡敌人 ============', gen(FOREST));
  rep('  // ============ 古堡敌人 ============', '  // ============ 沙漠敌人 ============', gen(CASTLE));
  rep('  // ============ 沙漠敌人 ============', '  // ============ 冰原敌人 ============', gen(DESERT_MOBS));
  rep('  // ============ 冰原敌人 ============', '  // ============ Boss ============', gen(TUNDRA_MOBS));
  rep('  // ============ Boss ============', '  // ============ 特效 ============', gen([...BOSS, ...DESERT_BOSSES, ...TUNDRA_BOSSES]));
  // minion：逐 key 替换（3 个独立条目，不连续）——整对象跨距替换
  const minionSpans = [];
  for (const m of MINION) {
    const i = src.indexOf(`key: '${m.key}'`);
    if (i < 0) { console.log(m.key, '未找到'); continue; }
    const objStart = src.lastIndexOf('\n  {', i);
    let objEnd = src.indexOf('\n  },', i);
    const noComma = src.indexOf('\n  }\n];', i);
    if (noComma >= 0 && (objEnd < 0 || noComma < objEnd)) objEnd = noComma + 4;
    else objEnd += 5;
    const [f0] = m.frames.map((r) => norm(r, m.w, m.h));
    const text = `\n  {\n    key: '${m.key}',\n    palette: { ${palStr(m.palette)} },\n    rows: [\n${esc(f0)}\n    ],\n  },`;
    minionSpans.push([objStart, objEnd, text]);
  }
  for (const [s, e, text] of minionSpans.sort((a, b) => b[0] - a[0])) {
    src = src.slice(0, s) + text + src.slice(e);
  }
  fs.writeFileSync(path, src);
  console.log('敌人段已重写');
} else {
  const bad = lint();
  console.log(bad ? `${bad} 个问题` : `lint 通过：${ALL.length + MINION.length} 怪`);
}
