# 工作规范

类吸血鬼幸存者像素游戏 · Phaser 3 + TypeScript + Vite · 数据驱动（`public/data/*.json`）

## 常用命令

```bash
npm run dev          # 开发服务器（?debug=1 激活开发者模式）
npx tsc --noEmit     # 类型检查（提交前必过）
```

调试验证：`dev.giveWeapon/givePassive/giveCharm/giveBoss`、快捷键 L/K/T/C/B/G/P/V/H，见 `src/systems/DebugSystem.ts`。

---

## 铁律：机制换数值

> **机制强 → 数值必须低；机制平庸 → 数值可以给高。**

新增任何装备/护符/敌人前，先回答："它的机制值多少数值？"然后从基准线上砍掉机制溢价。

| 机制强度 | 判定 | 数值处理 |
|---------|------|---------|
| 多目标/AoE | 一发命中 N 个敌人 | 单体伤 × 0.5~0.7，有效 DPS 按命中 2~3 个算 |
| 高命中频率 | 每秒命中 >2 次 | 概率类效果（护符触发）收益被放大，数值再降 |
| 控制（冰冻/减速） | 直接削减敌人输出窗口 | 几乎不给伤害数值，或触发率 ≤10% |
| 链式/弹射 | 免费命中第二个目标 | 弹射伤害 ≤ 主伤的 60% |
| 叠层成长 | 越打越强 | 单层 +2% 封顶，必须有清零条件 |
| 纯数值直伤 | 无附加机制 | 可以给足，甚至略高于平均线 |

### 当前已落地的实例对照

- 雷霆护符 12%×26 伤：命中概率低是因为多弹道武器每发都结算触发
- 回旋石 20%×60%：弹射是免费第二目标，数值砍到六成
- 冰霜符只有 1.4s 冰冻、10% 触发、Boss 抗性 0.15×——控制本身即是数值
- 八方镖阵类"全方向"设计 = 覆盖面换射程/单发伤害

---

## 难度曲线基准（破坏线）

设计档位以**预期构筑 DPS** 为锚（`stages.json` 的 difficultyCurve 已按此调过）：

| 时点 | 好构筑 DPS | 普通构筑 | 对应内容 |
|------|-----------|---------|---------|
| 60s | ~120 | ~60 | 蝙蝠群事件、史莱姆潮 |
| 120s | ~300 | ~150 | 精英骷髅潮 |
| 180s | ~500 | ~250 | 成型期密度爬坡 |
| 240s | ~900 | ~400 | 峰值杂兵潮（hpMul×5） |
| 300s+ | ~1400 | ~550 | 森林之心 32000 HP |

**新内容如果让"普通构筑"能过早达到"好构筑"档位的输出，就是打破曲线，必须砍。**

### Boss 交互红线

- 森林之心 `damageCap=900`（每击最多 2.8% 血量）：新装备若是"单次超大伤"会被上限截掉——设计时按多段命中算期望，别指望一击
- 阶段转场无敌 2.5s 是固定演出，任何装备不能绕过
- 冰冻/减速对 Boss 必须衰减（`isBoss` 时效果 ×0.15）

### 前期约束（0~60s）

玩家只有 1 把 Lv1 武器（~13~20 DPS）。此阶段可获得的任何装备：**单体有效 DPS ≤ 25，且不能是 AoE**。超越此线的东西必须藏在中后期（升级等级门槛/宝箱限定/进化链末端）。

---

## 新增内容检查清单

按类型过一遍，全部打勾才算设计完：

### 新武器（weapons.json + sprites.ts 贴图 + behavior 选择）
- [ ] 定档：单目标点杀 / 多目标 / AoE 场 / 控制？
- [ ] Lv1 有效 DPS（伤害×弹道数÷冷却秒）对比同类型武器 Lv1
- [ ] Lv5（满级）有效 DPS ≤ 当前满级武器天花板（千刃系 ~750 为上限参考）
- [ ] 若是高命中频率：过一遍护符联动（雷霆/毒牙/回旋）会不会变成必拿组合
- [ ] 写了进化吗？进化产物 = 机制质变 + 占额外槽位，数值可以放开但仍受 damageCap 约束
- [ ] sprites.ts 加 `tex_<id>` 像素画；可进化的话进化的也画

### 新护符（charms.json + 图标 + CharmSystem 若新效果类型）
- [ ] 触发类型选对：命中概率 / 每N次 / 击杀概率 / 受击
- [ ] 用"最坏情况"算触发频率：千刃 6 弹×约3发/s=每秒 18 次命中，概率×18 = 每秒期望触发次数，值 >1.5/s 就要警惕
- [ ] 效果伤害走 `enemy.takeDamage`（无 weaponId），不会再触发护符——确认不需要反向联动
- [ ] 对 Boss 的效果有没有抗性衰减需求（控制类默认要）

### 新被动（passives.json + 图标）
- [ ] 只加 Stats 七字段之一；weaponMod 类强化走局外成长树节点，不走被动
- [ ] 每级增幅：百分比属性 ≤8%/级、固定值属性参考现有同类
- [ ] 是否被某把武器进化需要？是的话那武器的进化强度预算要算它一份

### 新敌人/Boss（enemies.json + 贴图 + spawnTimeline/事件）
- [ ] 普通怪血量以出场时点 hpMul 曲线折算：预期 TTK = hp×曲线倍率 ÷ 同档 DPS
- [ ] 小 Boss 血量 = 出场时点好构筑 DPS × 15~25 秒
- [ ] 最终 Boss 类：必须有 damageCap（≈HP×3%）+ 至少 1 个转阶段
- [ ] 接触伤害 ≤ 玩家血量 15%/下；精英化（hpMul>1）自动放大体型+掉宝箱，不用再配

### 新地图事件（stages.json events）
- [ ] swarm/elite 波次数量 × 当时密度 = 不要瞬间挤爆 400 上限
- [ ] 事件奖励（宝箱）放在 150s 往后，前期给宝箱等于送节奏

---

## 文件落点速查

| 加什么 | 改哪里 |
|--------|--------|
| 武器 | `public/data/weapons.json` + `src/art/sprites.ts` + （新行为时）`src/entities/weapons/` |
| 护符 | `public/data/charms.json` + sprites 图标 + 新效果类型时 `src/systems/CharmSystem.ts` |
| 羁绊 | `public/data/bonds.json`（武器×被动配对）+ 新触发/效果类型时 `src/systems/BondSystem.ts` |
| 被动 | `public/data/passives.json` + sprites 图标 |
| 敌人/Boss | `public/data/enemies.json` + sprites（含 `_f1` 帧）+ `stages.json` 挂刷怪/事件 |
| 局外成长节点 | `public/data/metaUpgrades.json`（按职业分树，保守数值） |
| 掉落物 | `public/data/pickups.json` + sprites |
| 新事件类型 | `src/types.ts` StageEvent 联合类型 + `src/systems/SpawnDirector.ts` runEvent |

## 验证流程（改完必跑）

```bash
npm run check      # = tsc --noEmit + 全量数据校验（贴图完整性 + JSON 引用闭合）
npm run balance    # TTK/DPS 曲线抽查（对照本文破坏线，仅报告）
npm run build      # 最终构建
# 浏览器 ?debug=1 实测：dev 控制台造构筑，打对应时段怪看 TTK
```

## 贴图管线（scripts/）

数据模块 `e-*.mjs`/`i-*.mjs` + 角色生成器 `chibi-chars.mjs` 是 **sprites.ts 的唯一真相源**：
- 改敌人/物品/建筑/掉落/图标 → 改对应 `e-*`/`i-*` 模块 → `node scripts/hi-enemies.mjs apply` 或 `node scripts/hi-items.mjs apply`
- 改角色 → 改 `chibi-chars.mjs` → `node scripts/chibi-chars.mjs apply`
- 直接手改 sprites.ts 后 → `node scripts/sync-back.mjs` 把成品反同步回模块（防管线回滚）
- 预览： `node scripts/render-sprites.mjs [关键词]` → `preview/*.png`

**已验证：三条管线可无损复现 sprites.ts（165/165）。不要直接编辑 sprites.ts 后忘记 sync-back。**
