import fs from 'node:fs';
// 第3批：建筑/道具/掉落物高清化（逐 key 自定义画布）
import { E as BLD_F } from './i-bld-forest.mjs';
import { E as BLD_C } from './i-bld-castle.mjs';
import { E as BLD_D } from './i-bld-desert.mjs';
import { E as BLD_T } from './i-bld-tundra.mjs';
import { E as PROP_F } from './i-prop-forest.mjs';
import { E as PROP_C } from './i-prop-castle.mjs';
import { E as PROP_D } from './i-prop-desert.mjs';
import { E as PROP_T } from './i-prop-tundra.mjs';
import { E as TUNDRA_ALL } from './e-tundra.mjs';
import { E as PICK } from './i-pick.mjs';
import { E as WPN } from './i-icon-weapons.mjs';
import { E as EVO } from './i-icon-evolved.mjs';
import { E as PAS } from './i-icon-passives.mjs';

const TUNDRA_MISC = TUNDRA_ALL.filter((e) => !e.key.startsWith('tex_enemy_') && !e.key.startsWith('tex_boss_'));
const ALL = [...BLD_F, ...BLD_C, ...BLD_D, ...BLD_T, ...PROP_F, ...PROP_C, ...PROP_D, ...PROP_T, ...TUNDRA_MISC, ...PICK, ...WPN, ...EVO, ...PAS];

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
function esc(rows) { return rows.map((r) => `      '${r}',`).join('\n'); }
function palStr(p) { return Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(', '); }

function entry(e) {
  const [f0, ...rest] = e.frames.map((r) => norm(r, e.w, e.h));
  let c = `  {\n    key: '${e.key}',\n    palette: { ${palStr(e.palette)} },\n    rows: [\n${esc(f0)}\n    ],\n`;
  if (rest.length) c += `    extraFrames: [${rest.map((f) => `[\n${esc(f)}\n    ]`).join(',\n')}],\n`;
  return c + '  },\n';
}
function gen(list) { return list.map(entry).join(''); }

function lint() {
  let bad = 0;
  for (const e of ALL) {
    const pal = new Set(Object.keys(e.palette));
    for (const [fi, frame] of e.frames.entries()) {
      if (frame.some((r) => r.length > e.w)) { console.log(`${e.key}#${fi} 行宽超${e.w}`); bad++; }
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
  rep('  // ============ 森林装饰物 ============', '  // ============ 建筑：森林 ============', gen(PROP_F));
  rep('  // ============ 建筑：森林 ============', '  // ============ 建筑：森林祭坛 ============', gen(BLD_F.filter(e => !e.altar)));
  rep('  // ============ 建筑：森林祭坛 ============', '  // ============ 建筑：古堡 ============', gen(BLD_F.filter(e => e.altar)));
  rep('  // ============ 建筑：古堡 ============', '  // ============ 建筑：古堡祭坛 ============', gen(BLD_C.filter(e => !e.altar)));
  rep('  // ============ 建筑：古堡祭坛 ============', '  // ============ UI 箭头 ============', gen(BLD_C.filter(e => e.altar)));
  rep('  // ============ 掉落物 ============', '  // ============ 森林装饰物 ============', gen(PICK.filter((e) => e.key !== 'tex_ui_arrow')));
  rep('  // ============ 古堡装饰物 ============', '  // ============ 沙漠装饰物 ============', gen(PROP_C.filter((e) => e.key !== 'prop_campfire_b')));
  rep('  // ============ 沙漠装饰物 ============', '  // ============ 建筑：沙漠 ============', gen(PROP_D));
  rep('  // ============ 建筑：沙漠 ============', '  // ============ 建筑：沙漠祭坛 ============', gen(BLD_D.filter((e) => !e.altar)));
  rep('  // ============ 建筑：沙漠祭坛 ============', '  // ============ 粒子底图 ============',
    gen(BLD_D.filter((e) => e.altar))
    + '  // ============ 冰原装饰物 ============\n' + gen(PROP_T)
    + '  // ============ 建筑：冰原 ============\n' + gen(BLD_T.filter((e) => !e.altar))
    + '  // ============ 建筑：冰原祭坛 ============\n' + gen(BLD_T.filter((e) => e.altar))
    + '  // ============ 冰原任务/随从 ============\n' + gen(TUNDRA_MISC));
  rep('  // ============ 武器 ============', '  // ============ 进化武器 ============', gen(WPN));
  rep('  // ============ 进化武器 ============', '  // ============ 被动图标 ============', gen(EVO));
  rep('  // ============ 被动图标 ============', '  // ============ 护符图标 ============', gen(PAS.filter((e) => e.key.startsWith('tex_passive') || e.key.startsWith('tex_mod'))));
  rep('  // ============ 护符图标 ============', '  // ============ 掉落物 ============', gen(PAS.filter((e) => e.key.startsWith('tex_charm'))));
  // 散件：prop_campfire_b（粒子段内）与 tex_ui_arrow（箭头段）逐 key 替换
  const solo = [...PROP_C.filter((e) => e.key === 'prop_campfire_b'), ...PICK.filter((e) => e.key === 'tex_ui_arrow')];
  for (const e of solo) {
    const i = src.indexOf(`key: '${e.key}'`);
    if (i < 0) { console.log(e.key, '未找到'); continue; }
    const objStart = src.lastIndexOf('\n  {', i) + 1;
    const j = src.indexOf('\n  },', i);
    const noComma = src.indexOf('\n  }\n];', i);
    const objEnd = (noComma >= 0 && (j < 0 || noComma < j)) ? noComma + 4 : j + 5;
    src = src.slice(0, objStart) + entry(e).replace(/\n$/, '') + src.slice(objEnd);
  }
  fs.writeFileSync(path, src);
  console.log('物品段已重写');
} else {
  const bad = lint();
  console.log(bad ? `${bad} 个问题` : `lint 通过：${ALL.length} 贴图`);
}
