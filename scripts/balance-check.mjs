// 平衡曲线抽查：TTK / 武器DPS / Boss时长 —— 对照 AGENTS.md 破坏线
// 用法: node scripts/balance-check.mjs   —— 仅报告，不中断（设计评审工具）
import fs from 'node:fs';

const J = (f) => JSON.parse(fs.readFileSync(`public/data/${f}.json`, 'utf8'));
const weapons = J('weapons');
const enemies = J('enemies');
const stages = J('stages');
const eMap = Object.fromEntries(enemies.map((e) => [e.id, e]));

// AGENTS.md 难度曲线锚点：预期构筑 DPS
const DPS_GOOD = [[60, 120], [120, 300], [180, 500], [240, 900], [300, 1400]];
const DPS_NORM = [[60, 60], [120, 150], [180, 250], [240, 400], [300, 550]];
const lerp = (pts, t) => {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++)
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  return pts[pts.length - 1][1];
};

const issues = [];
console.log('========== 敌人 TTK（普通构筑期望 1~4s，精英 4~10s） ==========');
for (const s of stages) {
  console.log(`\n── ${s.id} ──`);
  const first = new Map();
  for (const sp of s.spawnTimeline) if (!first.has(sp.enemyId)) first.set(sp.enemyId, { t: sp.timeSec, hpMul: 1 });
  for (const ev of s.events ?? []) {
    if (ev.type === 'miniboss' && ev.params?.enemyId && !first.has(ev.params.enemyId))
      first.set(ev.params.enemyId, { t: ev.timeSec, hpMul: Number(ev.params.hpMul ?? 1) });
  }
  const effHpOf = (e, t, hpMul = 1) =>
    e.isBoss ? e.hp * hpMul : e.hp * hpMul * lerp(s.difficultyCurve.hp, t);
  for (const [eid, info] of [...first.entries()].sort((a, b) => a[1].t - b[1].t)) {
    const e = eMap[eid];
    if (!e) continue;
    const { t, hpMul } = info;
    const effHp = effHpOf(e, t, hpMul);
    const ttkN = effHp / lerp(DPS_NORM, t);
    const ttkG = effHp / lerp(DPS_GOOD, t);
    const isBoss = !!e.isBoss;
    // miniboss 设计带 = 出场时点好构筑 DPS × 15~25s（AGENTS.md）
    let flag = '';
    if (isBoss && (ttkG < 15 || ttkG > 30)) flag = `  ⚠ miniboss脱离15~25s带`;
    else if (!isBoss && ttkN > 8) flag = '  ✗ 血牛';
    else if (!isBoss && ttkN > 4) flag = '  ⚠ 偏硬';
    if (flag) issues.push(`${s.id}/${eid}@${t}s TTK=${ttkN.toFixed(1)}s`);
    console.log(`  ${t.toString().padStart(3)}s ${eid.padEnd(24)} effHp=${effHp.toFixed(0).padStart(6)} TTK(普)=${ttkN.toFixed(1)}s TTK(好)=${ttkG.toFixed(1)}s${flag}`);
  }
  // 精英波单独列示（hpMul≈3，只吃事件倍率×曲线）
  for (const ev of (s.events ?? []).filter((e) => e.type === 'elite_wave')) {
    const e = eMap[ev.params.enemyId];
    if (!e) continue;
    const m = Number(ev.params.hpMul ?? 3);
    const effHp = effHpOf(e, ev.timeSec, m);
    console.log(`  ${ev.timeSec}s ${e.id} [精英×${m}] effHp=${effHp.toFixed(0)} TTK(普)=${(effHp / lerp(DPS_NORM, ev.timeSec)).toFixed(1)}s`);
  }
  // 最终Boss：好构筑 30~60s（不吃曲线）
  const fb = eMap[s.finalBoss.enemyId];
  const fbHp = fb.hp * (s.finalBoss.hpMul ?? 1);
  const ttk = fbHp / lerp(DPS_GOOD, s.durationSec);
  const flag = ttk < 30 ? '  ⚠ 太脆' : ttk > 75 ? '  ⚠ 太肉' : '';
  if (flag) issues.push(`${s.id} finalBoss TTK=${ttk.toFixed(0)}s`);
  console.log(`  [最终Boss] ${fb.id} effHp=${fbHp.toFixed(0)} TTK(好)=${ttk.toFixed(0)}s${flag}`);
}

console.log('\n========== 武器有效 DPS（Lv1 红线 ≤25；满级参考上限 ~750） ==========');
const rows = weapons.map((w) => {
  const dps = (lv) => {
    const l = w.levels[lv];
    if (!l || !l.cooldownMs) return 0;
    return (l.damage * (l.projectiles || 1)) / (l.cooldownMs / 1000);
  };
  return { id: w.id, lv1: dps(0), max: dps(w.levels.length - 1), evolved: weapons.some((x) => x.evolution?.into === w.id) };
}).sort((a, b) => b.max - a.max);
for (const r of rows) {
  const isEvo = r.evolved;
  const flag = !isEvo && r.lv1 > 25 ? '  ✗ 破前期红线' : !isEvo && r.lv1 > 20 ? '  ⚠ 前期偏高' :
    !isEvo && r.max > 750 ? '  ⚠ 满级超上限' : '';
  if (flag.includes('✗')) issues.push(`${r.id} Lv1 DPS=${r.lv1.toFixed(1)}`);
  console.log(`  ${r.id.padEnd(24)} Lv1=${r.lv1.toFixed(1).padStart(6)} 满级=${r.max.toFixed(0).padStart(6)}${isEvo ? ' [进化]' : ''}${flag}`);
}

console.log('\n========== 结论 ==========');
if (issues.length) { console.log(`${issues.length} 处需复核:`); for (const i of issues) console.log('  -', i); }
else console.log('✓ 全在破坏线内');
