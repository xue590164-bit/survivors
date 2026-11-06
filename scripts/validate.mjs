// 全量数据校验：sprites.ts 贴图完整性 + public/data/*.json 引用闭合
// 用法: node scripts/validate.mjs   —— 出错 exit 1
import fs from 'node:fs';

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const J = (f) => JSON.parse(fs.readFileSync(`public/data/${f}.json`, 'utf8'));

// ---------- 1) 解析 sprites.ts ----------
const src = fs.readFileSync('src/art/sprites.ts', 'utf8');
const keyPos = [...src.matchAll(/key: '([^']+)'/g)];
const sprites = {}; // key -> {palette:Set, frames, w,h}
for (let i = 0; i < keyPos.length; i++) {
  const key = keyPos[i][1];
  if (sprites[key]) err(`sprites.ts 重复 key: ${key}`);
  const seg = src.slice(keyPos[i].index, i + 1 < keyPos.length ? keyPos[i + 1].index : src.length);
  const palM = seg.match(/palette: \{([^}]*)\}/);
  const pal = new Set();
  for (const pm of palM[1].matchAll(/\b([A-Za-z])\s*(?::\s*(0x[0-9a-fA-F]+|\d+))?/g)) pal.add(pm[1]);
  const rowsM = seg.match(/rows: \[([\s\S]*?)\]/);
  const frames = [[...rowsM[1].matchAll(/'([^']*)'/g)].map((x) => x[1])];
  const exM = seg.match(/extraFrames: \[([\s\S]*)\],\n\s*\}/);
  if (exM) for (const fm of exM[1].matchAll(/\[([\s\S]*?)\]/g)) {
    const r = [...fm[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    if (r.length) frames.push(r);
  }
  // 同一条目所有帧宽高必须一致（FrameAnimator 假设帧同尺寸）
  const w = frames[0][0].length, h = frames[0].length;
  for (const [fi, f] of frames.entries()) {
    for (const [ri, r] of f.entries()) {
      if (r.length !== w) { err(`${key} 帧${fi}行${ri} 宽${r.length}≠${w}`); break; }
      for (const c of r) if (c !== '.' && !pal.has(c)) { err(`${key} 帧${fi} 非法字符 '${c}'`); break; }
    }
    if (f.length !== h) err(`${key} 帧${fi} 高${f.length}≠${h}`);
  }
  sprites[key] = true;
}
console.log(`贴图: ${Object.keys(sprites).length} 张`);
const need = (tex, from) => { if (tex && !sprites[tex]) err(`${from} 引用缺失贴图 ${tex}`); };

// ---------- 2) 各数据文件 ----------
const weapons = J('weapons');
const passives = J('passives');
const enemies = J('enemies');
const stages = J('stages');
const charms = J('charms');
const bonds = J('bonds');
const pickups = J('pickups');
const characters = J('characters');
const buildings = J('buildings');
const meta = J('metaUpgrades');
console.log(`数据: 武器${weapons.length} 被动${passives.length} 敌人${enemies.length} 地图${stages.length} 护符${charms.length} 羁绊${bonds.length} 掉落${pickups.length} 角色${characters.length}`);

// id 唯一性
const dup = (arr, name) => {
  const seen = new Set();
  for (const x of arr) { if (seen.has(x.id)) err(`${name} 重复 id: ${x.id}`); seen.add(x.id); }
};
for (const [arr, n] of [[weapons, 'weapons'], [passives, 'passives'], [enemies, 'enemies'], [stages, 'stages'], [charms, 'charms'], [bonds, 'bonds'], [pickups, 'pickups'], [characters, 'characters']]) dup(arr, n);

const wIds = new Set(weapons.map((w) => w.id));
const pIds = new Set(passives.map((p) => p.id));
const eIds = new Set(enemies.map((e) => e.id));
const cIds = new Set(characters.map((c) => c.id));

// ---------- 3) 武器 ----------
const BEHAVIORS = new Set(['projectile', 'orbit', 'aura', 'boomerang', 'nova', 'summon', 'lob', 'melee', 'divine']);
const SCHOOLS = new Set(['martial', 'holy', 'arcane', 'dark', 'hunt']);
const schoolSet = new Set(weapons.filter((w) => w.evolved && w.school).map((w) => w.school));
for (const w of weapons) {
  need(`tex_${w.id}`, `weapon ${w.id}`);
  if (w.projectileTex) need(w.projectileTex, `weapon ${w.id}.projectileTex`);
  if (!BEHAVIORS.has(w.behavior)) err(`weapon ${w.id} 未知 behavior ${w.behavior}`);
  if (w.god) {
    if (!w.fuseSchools?.every((s) => schoolSet.has(s))) err(`god ${w.id} fuseSchools 引用了未标注的派系`);
    for (const [pi, p] of (w.godParts ?? []).entries()) {
      if (!BEHAVIORS.has(p.behavior) || p.behavior === 'divine') err(`god ${w.id} part${pi} 非法 behavior ${p.behavior}`);
      if (p.projectileTex) need(p.projectileTex, `god ${w.id} part${pi}.projectileTex`);
    }
  }
  if (!w.levels?.length) err(`weapon ${w.id} levels 为空`);
  if (w.maxLevel && w.levels.length > w.maxLevel) err(`weapon ${w.id} levels 数(${w.levels.length})超过 maxLevel(${w.maxLevel})`);
  for (const [li, lv] of w.levels.entries()) {
    if (!(lv.damage > 0) && !w.god) err(`weapon ${w.id} lv${li + 1} damage≤0`);
    if (!(lv.cooldownMs > 0) && w.behavior !== 'aura') warn(`weapon ${w.id} lv${li + 1} cooldownMs 异常`);
  }
  if (w.evolution) {
    if (!wIds.has(w.evolution.into)) err(`weapon ${w.id} 进化目标不存在: ${w.evolution.into}`);
    if (!pIds.has(w.evolution.requiresPassive)) err(`weapon ${w.id} 进化被动不存在: ${w.evolution.requiresPassive}`);
  }
}
// 进化武器自身也被引用
for (const w of weapons) if (w.evolution && !weapons.find((x) => x.id === w.evolution.into)?.levels?.length)
  err(`进化武器 ${w.evolution.into} 缺 levels`);

// ---------- 4) 被动/护符/掉落 ----------
for (const p of passives) need(`tex_${p.id}`, `passive ${p.id}`);
for (const c of charms) {
  need(`tex_${c.id}`, `charm ${c.id}`);
  if (!['onHitChance', 'onKillChance', 'onHitEvery', 'onPlayerHurt'].includes(c.trigger))
    warn(`charm ${c.id} 未见过 trigger ${c.trigger}`);
}
for (const p of pickups) need(`tex_${p.id}`, `pickup ${p.id}`);

// ---------- 5) 敌人 ----------
for (const e of enemies) {
  need(`tex_${e.id}`, `enemy ${e.id}`);
  if (!(e.hp > 0)) err(`enemy ${e.id} hp≤0`);
  if (!(e.speed >= 0)) err(`enemy ${e.id} speed 异常`);
}

const finalBossIds = new Set(stages.map((s) => s.finalBoss?.enemyId).filter(Boolean));
for (const e of enemies) {
  if (e.isBoss && !e.damageCap && !finalBossIds.has(e.id)) warn(`boss ${e.id} 无 damageCap（miniboss，确认可豁免）`);
}

// ---------- 6) 地图 ----------
for (const s of stages) {
  const sorted = (arr, what) => {
    for (let i = 1; i < arr.length; i++) if (arr[i].timeSec < arr[i - 1].timeSec) warn(`stage ${s.id} ${what} 乱序 @${arr[i].timeSec}`);
  };
  for (const sp of s.spawnTimeline) {
    if (!eIds.has(sp.enemyId)) err(`stage ${s.id} spawnTimeline 引用未知敌人 ${sp.enemyId}`);
  }
  sorted(s.spawnTimeline, 'spawnTimeline');
  for (const ev of s.events ?? []) {
    const pid = ev.params?.enemyId;
    if (pid && !eIds.has(pid)) err(`stage ${s.id} 事件@${ev.timeSec} 引用未知敌人 ${pid}`);
    if (ev.params?.enemyIds) for (const id of ev.params.enemyIds) if (!eIds.has(id)) err(`stage ${s.id} 事件@${ev.timeSec} 引用未知敌人 ${id}`);
  }
  sorted(s.events ?? [], 'events');
  if (s.finalBoss) {
    if (!eIds.has(s.finalBoss.enemyId)) err(`stage ${s.id} finalBoss 未知: ${s.finalBoss.enemyId}`);
    else if (!enemies.find((e) => e.id === s.finalBoss.enemyId).damageCap)
      err(`stage ${s.id} finalBoss ${s.finalBoss.enemyId} 缺 damageCap`);
  }
}

// ---------- 7) 羁绊 ----------
for (const b of bonds) {
  for (const wid of b.weaponIds) if (!wIds.has(wid)) err(`bond ${b.id} 引用未知武器 ${wid}`);
  if (!pIds.has(b.passiveId)) err(`bond ${b.id} 引用未知被动 ${b.passiveId}`);
  if (!b.weaponIds.some((w) => weapons.find((x) => x.id === w && !x.evolution)))
    warn(`bond ${b.id} 只包含进化武器，无基础形态`);
}

// ---------- 8) 角色 + 局外成长树 ----------
for (const c of characters) {
  need(`tex_char_${c.id.replace(/^char_/, '')}`, `character ${c.id}`);
  if (!wIds.has(c.startingWeapon)) err(`character ${c.id} 初始武器不存在: ${c.startingWeapon}`);
}
for (const [key, tree] of Object.entries(meta)) {
  const cid = key;
  if (!cIds.has(cid)) err(`metaUpgrades 键 ${cid} 无对应角色`);
  const nIds = new Set(tree.nodes.map((n) => n.id));
  for (const n of tree.nodes) {
    if (n.icon) need(n.icon, `meta ${key}.${n.id}`);
    for (const r of n.requires ?? []) if (!nIds.has(r)) err(`meta ${key}.${n.id} 前置不存在: ${r}`);
    if (n.weapon && !wIds.has(n.weapon)) err(`meta ${key}.${n.id} 引用未知武器 ${n.weapon}`);
    if (!n.stat && !n.weapon) warn(`meta ${key}.${n.id} 既无 stat 也无 weapon`);
  }
}

// ---------- 9) 建筑 ----------
for (const [theme, grp] of Object.entries(buildings)) {
  for (const [slot, list] of Object.entries(grp)) {
    for (const b of list) need(b.tex, `buildings.${theme}.${slot}`);
  }
}

// ---------- 报告 ----------
for (const w of warns) console.log('  ⚠', w);
if (errors.length) {
  console.log(`\n✗ ${errors.length} 个错误:`);
  for (const e of errors.slice(0, 40)) console.log('  ✗', e);
  process.exit(1);
}
console.log(`\n✓ 全部通过${warns.length ? `（${warns.length} 警告）` : ''}`);
