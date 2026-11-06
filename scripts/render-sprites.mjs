// 渲染 sprites.ts 里所有贴图为 PNG 预览图（preview/ 目录）
// 用法: node scripts/render-sprites.mjs [过滤词]      —— 只渲染 key 含过滤词的
//       node scripts/render-sprites.mjs sheet <类别> —— 只出某类合图
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'preview');
fs.mkdirSync(OUT, { recursive: true });

// esbuild 编译 ts -> mjs 再 import
const compiled = path.join(OUT, '_sprites.mjs');
execSync(`npx esbuild src/art/sprites.ts --format=esm --outfile=${compiled} --log-level=error`, { cwd: ROOT, stdio: 'inherit' });
const { SPRITES } = await import(pathToFileURL(compiled).href + '?t=' + Date.now());

// ---------- PNG 编码 ----------
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC_T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const tb = Buffer.from(t); const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([tb, d])));
  return Buffer.concat([l, tb, d, c]);
};
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([sig, chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 渲染 ----------
function renderRows(rows, palette, scale) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const img = Buffer.alloc(w * scale * h * scale * 4);
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
      const px = (x / scale) | 0, py = (y / scale) | 0;
      const ch = rows[py]?.[px] ?? '.';
      let r, g, b;
      if (ch === '.') {
        const v = (((x / 6) | 0) + ((y / 6) | 0)) & 1 ? 0x55 : 0x33;
        r = g = b = v;
      } else if (!(ch in palette)) {
        r = 0xff; g = 0x00; b = 0xff; // 非法字符 -> 品红
      } else {
        const col = palette[ch];
        r = (col >> 16) & 255; g = (col >> 8) & 255; b = col & 255;
      }
      const i = (y * w * scale + x) * 4;
      img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = 255;
    }
  }
  return { img, w: w * scale, h: h * scale };
}

// 拼合图：items=[{img,w,h}]，cell 内居中
function compose(items, cols, pad = 10, bg = 0x1a1a24) {
  if (!items.length) return null;
  const cw = Math.max(...items.map((i) => i.w));
  const chh = Math.max(...items.map((i) => i.h));
  const rowsN = Math.ceil(items.length / cols);
  const W = cols * cw + (cols + 1) * pad;
  const H = rowsN * chh + (rowsN + 1) * pad;
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = bg >> 16 & 255; out[i * 4 + 1] = bg >> 8 & 255; out[i * 4 + 2] = bg & 255; out[i * 4 + 3] = 255; }
  items.forEach((it, idx) => {
    const cx = idx % cols, cy = (idx / cols) | 0;
    const ox = pad + cx * (cw + pad) + ((cw - it.w) >> 1);
    const oy = pad + cy * (chh + pad) + ((chh - it.h) >> 1);
    for (let y = 0; y < it.h; y++) {
      it.img.copy(out, ((oy + y) * W + ox) * 4, y * it.w * 4, (y + 1) * it.w * 4);
    }
  });
  return { img: out, w: W, h: H };
}

const scale = (w, h) => Math.max(3, Math.min(14, Math.round(200 / Math.max(w, h))));

// 展开成 {fileKey, rows, palette}（含 extraFrames）
function expand(s) {
  const out = [{ fileKey: s.key, rows: s.rows, palette: s.palette }];
  s.extraFrames?.forEach((fr, i) => out.push({ fileKey: `${s.key}_f${i + 1}`, rows: fr, palette: s.palette }));
  return out;
}

const filter = process.argv[2];
const all = SPRITES.flatMap(expand).filter((e) => !filter || e.fileKey.includes(filter));

// 单张渲染
for (const e of all) {
  const s = scale(e.rows[0].length, e.rows.length);
  const r = renderRows(e.rows, e.palette, s);
  fs.writeFileSync(path.join(OUT, e.fileKey + '.png'), encodePNG(r.w, r.h, r.img));
}
console.log(`单张渲染: ${all.length} -> preview/`);

// ---------- 合图 ----------
function sheetFor(name, entries, cols) {
  const items = entries.map((e) => { const s = scale(e.rows[0].length, e.rows.length); return renderRows(e.rows, e.palette, s); });
  const c = compose(items, cols);
  if (!c) return;
  fs.writeFileSync(path.join(OUT, '_sheet_' + name + '.png'), encodePNG(c.w, c.h, c.img));
  console.log(`_sheet_${name}.png (${entries.length}张, ${cols}列):`);
  entries.forEach((e, i) => console.log(`  [${i}] ${e.fileKey}`));
}

// 按实体分组合图：tex_char_knight + _up + _side + 帧 -> 一张
function entitySheets(prefix, outName) {
  const groups = new Map();
  for (const s of SPRITES.filter((x) => x.key.startsWith(prefix))) {
    const m = s.key.slice(prefix.length).match(/^(.*?)(_(up|side))?$/);
    const base = m[1];
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(s);
  }
  for (const [base, list] of groups) {
    const frames = list.flatMap(expand);
    const items = frames.map((e) => { const s = scale(e.rows[0].length, e.rows.length); return renderRows(e.rows, e.palette, s); });
    const c = compose(items, Math.min(items.length, 6));
    fs.writeFileSync(path.join(OUT, `_${outName}_${base}.png`), encodePNG(c.w, c.h, c.img));
  }
  console.log(`${outName}: ${groups.size} 张实体图 (${[...groups.keys()].join(', ')})`);
}

entitySheets('tex_char_', 'char');
entitySheets('tex_enemy_', 'enemy');
entitySheets('tex_boss_', 'boss');
entitySheets('tex_minion_', 'minion');

sheetFor('buildings', all.filter((e) => /bld|altar|statue|throne|mirror|well|spring|hut|tent|stone|log|fence|shelf|table|rack|cart|gate/.test(e.fileKey)), 5);
sheetFor('props', all.filter((e) => /^prop_|tex_prop/.test(e.fileKey)), 5);
sheetFor('weapons', all.filter((e) => e.fileKey.startsWith('tex_weapon_')), 6);
sheetFor('passives', all.filter((e) => e.fileKey.startsWith('tex_passive_')), 6);
sheetFor('charms', all.filter((e) => e.fileKey.startsWith('tex_charm_')), 6);
sheetFor('pickups', all.filter((e) => e.fileKey.startsWith('tex_pickup_') || e.fileKey.startsWith('tex_ui_')), 6);
sheetFor('misc', all.filter((e) => /fx_|zone|fire|miasma|nova/.test(e.fileKey)), 6);
