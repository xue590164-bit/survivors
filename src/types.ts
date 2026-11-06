/** 角色/武器/敌人等全部数据定义的类型。数据文件位于 public/data/*.json */

export interface Stats {
  maxHp: number;        // 生命上限（固定值）
  speed: number;        // 移动速度 px/s（固定值）
  armor: number;        // 护甲，直接减免伤害
  damagePct: number;    // 伤害加成，0.2 = +20%
  areaPct: number;      // 攻击范围加成
  cooldownPct: number;  // 冷却缩减，上限约 0.8
  magnetRadius: number; // 拾取磁吸半径 px
  xpGainPct: number;    // 经验获取加成
  critPct: number;      // 暴击概率，暴击伤害 ×2
  regenPerSec: number;  // 每秒回复 HP
  ricochetPct: number;  // 武器命中后折射概率（50%伤害弹向240px内另一敌人）
}

export interface CharacterDef {
  id: string;
  name: string;
  description: string;
  baseStats: Stats;
  startingWeapon: string;
  color: number;
  /** 解锁价格（无此字段=默认可用） */
  unlockCost?: number;
}

export interface WeaponLevelDef {
  damage: number;
  cooldownMs: number;
  projectiles: number;
  area: number;
  durationMs: number;
  /** 穿透数（弹道类，默认1=命中即消失） */
  pierce?: number;
  /** 命中击退力度 px/s（脉冲/近战类） */
  knockback?: number;
  /** 每次触发回复玩家 HP（圣域等） */
  heal?: number;
  /** 仆从生命（召唤类），缺省按等级推导 */
  minionHp?: number;
  /** 近战类：true=全周横扫（绞肉机） */
  fullCircle?: boolean;
}

/** 神兵子部件：一个迷你武器定义，由 DivineBehavior 组装为复合体 */
export interface GodPart {
  behavior: 'projectile' | 'orbit' | 'aura' | 'boomerang' | 'nova' | 'summon' | 'lob' | 'melee';
  projectileTex?: string;
  damage: number;
  cooldownMs: number;
  projectiles: number;
  area: number;
  durationMs?: number;
  pierce?: number;
  knockback?: number;
  heal?: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  description: string;
  behavior: 'projectile' | 'orbit' | 'aura' | 'boomerang' | 'nova' | 'summon' | 'lob' | 'melee' | 'divine';
  /** 弹道外观贴图（缺省用武器图标 tex_<id>）；弹道贴图统一朝右 */
  projectileTex?: string;
  maxLevel: number;
  levels: WeaponLevelDef[];
  /** 进化条件：需要持有指定被动，进化为 into 武器 */
  evolution?: { requiresPassive: string; into: string };
  /** 进化产物标记：不进升级三选一的新武器池 */
  evolved?: boolean;
  /** 进化武器的派系（martial/holy/arcane/dark/hunt），神兵合成配方按派系配对 */
  school?: 'martial' | 'holy' | 'arcane' | 'dark' | 'hunt';
  /** 神兵标记：只能由合成获得 */
  god?: boolean;
  /** 神兵合成配方：需要的两个派系（顺序无关） */
  fuseSchools?: [string, string];
  /** 神兵复合行为子部件 */
  godParts?: GodPart[];
  /** 神兵签名技能类型 */
  signature?: 'skyfall' | 'meteor' | 'devour' | 'spiral' | 'roots' | 'sunlance';
  /** 签名技能触发间隔 ms */
  signatureMs?: number;
  /** 签名技能伤害 */
  signatureDamage?: number;
  color: number;
}

export interface PassiveDef {
  id: string;
  name: string;
  description: string;
  stat: keyof Stats;
  bonusPerLevel: number;
  maxLevel: number;
  color: number;
}

export type EnemyAiType = 'chase' | 'ranged' | 'charger' | 'stationary';

/** Boss 技能（数据驱动，BossSkillSystem 定时调度，均带预警可躲） */
export type BossSkillDef =
  /** 蓄力后朝玩家冲撞，冲撞中接触伤害×dmgMul */
  | { type: 'charge'; cooldownMs: number; windupMs?: number; speedMul?: number; durationMs?: number; dmgMul?: number }
  /** 脚下冲击波：预警后半径内伤害 */
  | { type: 'nova'; cooldownMs: number; radius: number; damage: number; telegraphMs?: number; color?: number }
  /** 落点打击：玩家周围 spawn N 个预警圈，延时引爆 */
  | { type: 'volley'; cooldownMs: number; count: number; radius: number; damage: number; spread?: number; telegraphMs?: number; color?: number }
  /** 环绕召唤增援 */
  | { type: 'summon'; cooldownMs: number; enemyId: string; count: number; radius?: number }
  /** 跳劈：锁定玩家位置预警→快速位移到点→落地 AoE */
  | { type: 'leap'; cooldownMs: number; radius: number; damage: number; windupMs?: number; color?: number };

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  xp: number;
  aiType: EnemyAiType;
  color: number;
  scale: number;
  /** 半透明（幽灵系） */
  alpha?: number;
  /** 追击时垂直方向正弦摆动幅度 px/s（幽灵/飞行物飘移感） */
  weave?: number;
  /** 纵向悬浮幅度 px（幽灵/魔典的漂浮起伏，速度按 900ms 周期折算） */
  hoverPx?: number;
  /** 透明度呼吸振幅（在 def.alpha 基础上 ±，幽灵忽隐忽现） */
  alphaPulse?: number;
  /** 随水平速度侧倾的弧度系数（飞行单位压弯感） */
  lean?: number;
  /** charger AI：进入该距离触发蓄力突进 */
  chargeRange?: number;
  chargeCdMs?: number;
  chargeSpeedMul?: number;
  /** ranged AI：射程 px，超出则逼近 */
  shootRange?: number;
  /** ranged AI：开火间隔 ms */
  shootCdMs?: number;
  /** ranged AI：弹速 px/s */
  shotSpeed?: number;
  /** ranged AI：弹丸贴图（缺省 tex_proj_sun） */
  shotTex?: string;
  /** ranged AI：小于该距离则后撤保持间距 */
  standoff?: number;
  /** stationary AI：光环半径 px，半径内友军敌人加速（寒冰图腾） */
  auraRadius?: number;
  /** stationary AI：光环内友军速度倍率 */
  auraSpeedMul?: number;
  /** Boss 标记：双倍宝箱、HUD 血条、呼吸缩放 */
  isBoss?: boolean;
  /** 单次命中伤害上限（防秒杀：再大的伤害也只掉这么多） */
  damageCap?: number;
  /** Boss 转阶段：血线触发，短暂无敌+召唤增援；sandstorm=阶段起永久沙暴 */
  phases?: { atHpPct: number; spawnEnemyId: string; count: number; sandstorm?: boolean }[];
  /** Boss 独立技能模组 */
  skills?: BossSkillDef[];
  /** 序列帧切换间隔 ms（有 _f1 帧时生效，默认 300） */
  animMs?: number;
}

/** 武器×被动羁绊：同时持有即激活，效果走武器命中事件 */
export interface BondDef {
  id: string;
  name: string;
  /** 命中此表内任一武器都算（基础型/进化型同享） */
  weaponIds: string[];
  passiveId: string;
  desc: string;
  trigger: {
    type: 'onHitEvery' | 'onHitChance' | 'onKillChance' | 'onHitExecute' | 'onHitFar';
    every?: number;
    chance?: number;
    belowPct?: number;
    minDist?: number;
  };
  effect: {
    type: 'ricochet' | 'corpseExplode' | 'heal' | 'freeze' | 'strikeDamage' | 'strikeRandom' | 'bonusDamage';
    count?: number;
    dmgPct?: number;
    range?: number;
    radius?: number;
    amount?: number;
    durationMs?: number;
  };
}

export interface SpawnEntry {
  timeSec: number;
  enemyId: string;
  ratePerSec: number;
}

export interface StageEvent {
  timeSec: number;
  /** sandstorm=全局风场+刷怪增幅；burrow_swarm=钻沙突袭群；wormstrike=周期性追身沙虫；blizzard=暴雪(弱风+暗角+刷怪增幅) */
  type: 'elite_wave' | 'swarm_ring' | 'miniboss' | 'boss' | 'chest' | 'sandstorm' | 'burrow_swarm' | 'wormstrike' | 'blizzard';
  params?: Record<string, unknown>;
}

/** 常驻地形危害：按 chunk 确定性散布，玩家入内受持续效果 */
export interface HazardDef {
  type: 'quicksand' | 'icesheet';
  /** 每 chunk 生成概率（0~1） */
  perChunk: number;
  /** 单潭半径 px */
  radius: number;
  /** 玩家在潭内移速乘数（quicksand） */
  slowPct?: number;
  /** 冰面滑行插值系数（icesheet）：越小越滑，覆盖 stage.iceSlide */
  slideK?: number;
}

/** 局内任务：时间触发地图目标，HUD 指北针引导，完成发奖 */
export interface StageQuest {
  timeSec: number;
  type: 'thaw_survivor' | 'light_beacons' | 'seal_rift' | 'airdrop';
  params?: Record<string, unknown>;
}

export interface StageDef {
  id: string;
  name: string;
  durationSec: number;
  bgColor: number;
  /** 解锁价格（无此字段=默认可用） */
  unlockCost?: number;
  /** 地图主题：决定装饰物表与配色（forest/castle/...） */
  theme?: string;
  /** 撑满时长后召唤最终 Boss，击杀即通关 */
  finalBoss?: { enemyId: string; hpMul: number };
  /** 时间缩放曲线 [[时刻s, 倍率], ...] 分段线性插值；普通怪生效，Boss豁免 */
  difficultyCurve?: { hp: [number, number][]; dmg: [number, number][] };
  spawnTimeline: SpawnEntry[];
  events: StageEvent[];
  /** 常驻地形危害（流沙等），建图时散布 */
  hazards?: HazardDef[];
  /** 沉眠守卫：按 chunk 概率预置的休眠敌人，靠近/受击/精英波唤醒 */
  dormantPack?: { enemyId: string; perChunk: number };
  /** 全图冰面滑行插值系数（0~1，越小越滑；缺省不滑） */
  iceSlide?: number;
  /** 局内任务列表 */
  quests?: StageQuest[];
}

/** 局外成长的武器专属修正（叠加到局内属性折算之后，数值保守） */
export interface WeaponMod {
  /** 弹道/环绕体数量 +N */
  projectiles?: number;
  /** 该武器伤害 +X（乘算，与 damagePct 加算合并） */
  damagePct?: number;
  /** 该武器冷却额外缩减比例（与 cooldownPct 合并，受上限约束） */
  cooldownPct?: number;
  /** 该武器范围 +X */
  areaPct?: number;
  /** 弹道穿透 +N（仅弹道类生效） */
  pierce?: number;
}

/** 局外成长树节点：前置全部点亮后才能购买 */
export interface MetaNode {
  id: string;
  name: string;
  desc: string;
  /** 图标纹理 key（tex_xxx），可复用武器/被动贴图 */
  icon?: string;
  cost: number;
  /** 前置节点 id 列表（同一棵树内） */
  requires: string[];
  /** 树内布局位置 [列, 行] */
  pos: [number, number];
  /** 通用属性加成（与 value 配对） */
  stat?: keyof Stats;
  value?: number;
  /** 武器专属修正（与 weaponMod 配对，key=武器id） */
  weapon?: string;
  weaponMod?: WeaponMod;
}

export interface MetaTree {
  nodes: MetaNode[];
}

/** 护符效果（CharmSystem 按 type 分发实现） */
export type CharmEffect =
  | { type: 'strikeDamage'; damage: number }
  | { type: 'ricochet'; dmgPct: number; range: number }
  | { type: 'dot'; dps: number; durationMs: number }
  | { type: 'freeze'; durationMs: number }
  | { type: 'corpseExplode'; damage: number; radius: number }
  | { type: 'heal'; amount: number; cooldownMs: number }
  | { type: 'thorns'; damage: number; radius: number }
  | { type: 'stackDamage'; perStack: number; maxStacks: number; decayMs: number };

/** 护符：订阅武器命中/击杀/受击事件的联动装备 */
export interface CharmDef {
  id: string;
  name: string;
  description: string;
  color: number;
  /** onHitChance=武器命中概率触发；onHitEvery=每N次武器命中；onKillChance=击杀概率；onPlayerHurt=受击触发 */
  trigger: 'onHitChance' | 'onHitEvery' | 'onKillChance' | 'onPlayerHurt';
  chance?: number;
  every?: number;
  effect: CharmEffect;
}

export type PickupType = 'xp' | 'heal' | 'magnet' | 'chest' | 'bomb' | 'relic';

export interface PickupDef {
  id: string;
  name: string;
  type: PickupType;
  value: number;
  color: number;
}

export interface RunResult {
  won: boolean;
  timeSec: number;
  kills: number;
  level: number;
  goldEarned: number;
  /** 无尽模式讨伐深度（0=未进入或未讨伐） */
  endlessDepth?: number;
}

/** 建筑效果：由 MapSystem 按 type 分发 */
export type BuildingEffectType =
  | 'blood_pact'    // 鲜血祭坛：-10%当前血 → +8%伤害永久
  | 'regen_aura'    // 德鲁伊石圈：圈内持续回血（不消耗）
  | 'heal_xp'       // 精灵泉：回血+经验
  | 'witch_gamble'  // 女巫小屋：60%好运/40%诅咒精英波
  | 'holy_altar'    // 圣堂祭坛：回血+圣光nova
  | 'alchemy'       // 炼金台：随机掉落物
  | 'throne'        // 英灵王座：45s伤害+移速buff
  | 'cursed_mirror'// 诅咒之镜：刷镜影精英→宝箱
  | 'sun_shrine';  // 太阳祭坛：充能站位3s→宝箱+治疗，同时唤醒守卫伏击

export interface BuildingDef {
  tex: string;
  weight: number;
  effect?: BuildingEffectType;
  /** 全局限量：本局最多出现次数（限流风险建筑） */
  maxPerRun?: number;
  /** 充能型祭坛：光环内站位累计该毫秒数才触发（太阳祭坛） */
  channelMs?: number;
}

export interface BuildingTable {
  ambient: BuildingDef[];
  altars: BuildingDef[];
}
