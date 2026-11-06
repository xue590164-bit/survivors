import Phaser from 'phaser';
import { Depths, GAME_WIDTH, GAME_HEIGHT } from '../config';
import type { StageDef, BuildingDef, BuildingTable, Stats } from '../types';
import { db } from '../core/DataRegistry';
import { eventBus, GameEvents, type EnemyKilledPayload } from '../core/EventBus';
import { txt } from '../ui/text';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import type { SpawnDirector } from './SpawnDirector';
import type { PickupSystem } from './PickupSystem';

const CHUNK = 256;
const SPAWN_PAD = CHUNK;
const FLICKER_MS = 160;
const ALTAR_CELL = 1100;      // 祭坛走独立大网格：至少~1屏间距
const ALTAR_CHANCE = 0.32;    // 每格有祭坛的概率
const ALTAR_TRIGGER_R = 52;   // 触发半径
const ALTAR_HINT_R = 190;     // 金环提示半径（大于触发半径，先到先亮）
const AURA_R = 95;            // 石圈回血光环半径
const AURA_HEAL_PCT = 0.02;   // 每秒回最大血量比例
const AMBIENT_BLD_CHANCE = 0.14; // 每chunk氛围建筑概率

/** chunk 坐标 → 稳定种子：同一区域装饰物永远一致 */
function hashChunk(cx: number, cy: number): number {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PropEntry {
  key: string;
  weight: number;
}

const FOREST_PROPS: PropEntry[] = [
  { key: 'prop_grass', weight: 5 },
  { key: 'prop_tree_small', weight: 4 },
  { key: 'prop_flower', weight: 3 },
  { key: 'prop_bush', weight: 3 },
  { key: 'prop_tree_big', weight: 2 },
  { key: 'prop_rock', weight: 2 },
  { key: 'prop_mushroom', weight: 2 },
  { key: 'prop_stump', weight: 1 },
  { key: 'prop_campfire_a', weight: 1 },
];

const CASTLE_PROPS: PropEntry[] = [
  { key: 'prop_candle_a', weight: 5 },
  { key: 'prop_books', weight: 4 },
  { key: 'prop_table', weight: 3 },
  { key: 'prop_pillar', weight: 3 },
  { key: 'prop_banner', weight: 2 },
];

const DESERT_PROPS: PropEntry[] = [
  { key: 'prop_dune_a', weight: 5 },
  { key: 'prop_dune_b', weight: 4 },
  { key: 'prop_rock_desert', weight: 3 },
  { key: 'prop_tumbleweed', weight: 3 },
  { key: 'prop_dead_cactus', weight: 2 },
  { key: 'prop_skull', weight: 2 },
  { key: 'prop_scarab_stone', weight: 1 },
];

const TUNDRA_PROPS: PropEntry[] = [
  { key: 'prop_snowdrift', weight: 5 },
  { key: 'prop_rock_snow', weight: 3 },
  { key: 'prop_frozen_bush', weight: 3 },
  { key: 'prop_ice_shard', weight: 3 },
  { key: 'prop_ice_floe', weight: 2 },
  { key: 'prop_snowprint', weight: 2 },
];

const PROP_TABLES: Record<string, PropEntry[]> = {
  forest: FOREST_PROPS,
  castle: CASTLE_PROPS,
  desert: DESERT_PROPS,
  tundra: TUNDRA_PROPS,
};

/** 可闪烁道具：key=A 帧贴图，切换 B 帧 + 光晕色 */
const FLICKER_PROPS: Record<string, { b: string; glow: number; glowScale: number }> = {
  prop_campfire_a: { b: 'prop_campfire_b', glow: 0xff9030, glowScale: 0.6 },
  prop_candle_a: { b: 'prop_candle_b', glow: 0xffb860, glowScale: 0.4 },
};

interface FireRef {
  fire: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  /** 闪烁 A 帧贴图 key */
  aKey: string;
}

interface ChunkRecord {
  images: Phaser.GameObjects.Image[];
  fires: FireRef[];
  hazards?: HazardZone[];
}

interface AltarObj {
  def: BuildingDef;
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  /** 本体金边高亮（postFX 轮廓光），玩家靠近时点亮 */
  fxGlow?: Phaser.FX.Glow;
  x: number;
  y: number;
  used: boolean;
  /** 充能型祭坛累计进度 ms */
  chargeMs?: number;
}

/** 地形危害实例：随 chunk 生灭，玩家按圆判定减速/滑行 */
interface HazardZone {
  x: number;
  y: number;
  r: number;
  slowPct: number;
  slideK?: number;
  img: Phaser.GameObjects.Image;
}

interface BuffEntry {
  revert: Partial<Stats>;
  until: number;
}

/** 祭坛触发所需的运行期系统引用（GameScene 建成后注入） */
export interface BuildingCtx {
  player: Player;
  director: SpawnDirector;
  pickups: PickupSystem;
  enemies: Phaser.Physics.Arcade.Group;
}

/**
 * 地图系统：TileSprite 底图无限平铺 + 分块装饰物。
 * 每个 256px chunk 由坐标哈希决定长什么，视野外回收进对象池。
 */
export class MapSystem {
  private bg: Phaser.GameObjects.TileSprite;
  private scene: Phaser.Scene;
  private stage: StageDef;
  private props: PropEntry[];
  private buildingTable?: BuildingTable;
  private ctx?: BuildingCtx;

  private chunks = new Map<string, ChunkRecord>();
  private pool: Phaser.GameObjects.Image[] = [];
  private fires: FireRef[] = [];
  private flickAcc = 0;
  private flickFrame = false;

  private altars = new Map<string, AltarObj>();
  private spawnedByEffect = new Map<string, number>();
  private mirrorElites = new Set<Enemy>();
  private mirrorBound = false;
  private buffs: BuffEntry[] = [];
  private nowMs = 0;
  private hazards: HazardZone[] = [];
  private dormantSeeded = new Set<string>();

  constructor(scene: Phaser.Scene, stage: StageDef) {
    this.scene = scene;
    this.stage = stage;
    this.props = PROP_TABLES[stage.theme ?? 'forest'] ?? FOREST_PROPS;
    this.buildingTable = db().buildings(stage.theme ?? 'forest');
    scene.cameras.main.setBackgroundColor(stage.bgColor);
    const tileKey = scene.textures.exists(`tile_${stage.theme}`) ? `tile_${stage.theme}` : 'tile';
    this.bg = scene.add
      .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, tileKey)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Depths.Map);
  }

  /** 运行期引用注入（祭坛触发效果用） */
  bindCtx(ctx: BuildingCtx): void {
    this.ctx = ctx;
  }

  update(deltaMs: number): void {
    this.nowMs += deltaMs;
    const cam = this.scene.cameras.main;
    this.bg.tilePositionX = cam.scrollX;
    this.bg.tilePositionY = cam.scrollY;
    this.syncChunks(cam);
    this.flickFires(deltaMs);
    this.updateAltars(deltaMs);
  }

  private syncChunks(cam: Phaser.Cameras.Scene2D.Camera): void {
    // worldView 已计 zoom，别用 viewport 尺寸
    const view = cam.worldView;
    const x0 = Math.floor((view.x - SPAWN_PAD) / CHUNK);
    const x1 = Math.floor((view.right + SPAWN_PAD) / CHUNK);
    const y0 = Math.floor((view.y - SPAWN_PAD) / CHUNK);
    const y1 = Math.floor((view.bottom + SPAWN_PAD) / CHUNK);

    const needed = new Set<string>();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        needed.add(key);
        if (!this.chunks.has(key)) {
          this.spawnChunk(cx, cy, key);
          this.seedDormant(cx, cy, key);
        }
      }
    }
    for (const [key, rec] of this.chunks) {
      if (!needed.has(key)) this.despawnChunk(key, rec);
    }

    // 祭坛走独立大网格：进入视野的格子确定性判定是否生成
    if (this.buildingTable?.altars.length) {
      const ax0 = Math.floor((view.x - SPAWN_PAD * 2) / ALTAR_CELL);
      const ax1 = Math.floor((view.right + SPAWN_PAD * 2) / ALTAR_CELL);
      const ay0 = Math.floor((view.y - SPAWN_PAD * 2) / ALTAR_CELL);
      const ay1 = Math.floor((view.bottom + SPAWN_PAD * 2) / ALTAR_CELL);
      for (let ax = ax0; ax <= ax1; ax++) {
        for (let ay = ay0; ay <= ay1; ay++) this.ensureAltar(ax, ay);
      }
    }
  }

  private spawnChunk(cx: number, cy: number, key: string): void {
    const rand = mulberry32(hashChunk(cx, cy));
    const rec: ChunkRecord = { images: [], fires: [] };

    // 建筑先判定：出了氛围建筑的块以它为地标，普通点缀基本让位
    const hasBld = !!this.buildingTable?.ambient.length && rand() < AMBIENT_BLD_CHANCE;
    // 无建筑块：45% 空 / 45% 一个 / 10% 两个；有建筑块大多只留建筑
    const roll = rand();
    const count = hasBld ? (roll < 0.75 ? 0 : 1) : roll < 0.45 ? 0 : roll < 0.9 ? 1 : 2;

    for (let i = 0; i < count; i++) {
      const def = this.pickProp(rand);
      const x = cx * CHUNK + rand() * CHUNK;
      const y = cy * CHUNK + rand() * CHUNK;
      const img = this.obtain(def.key, x, y);
      img.setFlipX(rand() < 0.5).setScale(1.15);

      const flick = FLICKER_PROPS[def.key];
      if (flick) {
        const glow = this.obtain('tex_zone', x, y - 4);
        glow.setTint(flick.glow).setAlpha(0.28).setScale(flick.glowScale).setDepth(Depths.Map + 1);
        const fire: FireRef = { fire: img, glow, aKey: def.key };
        rec.fires.push(fire);
        this.fires.push(fire);
        rec.images.push(glow);
      }
      rec.images.push(img);
    }

    // 氛围建筑：低概率大号装饰，坐标哈希决定、随chunk回收
    if (hasBld) {
      const def = this.pickWeighted(this.buildingTable!.ambient, rand);
      const bx = cx * CHUNK + CHUNK * 0.5 + (rand() - 0.5) * CHUNK * 0.5;
      const by = cy * CHUNK + CHUNK * 0.5 + (rand() - 0.5) * CHUNK * 0.5;
      const bImg = this.obtain(def.tex, bx, by);
      bImg.setScale(1.05).setFlipX(rand() < 0.5);
      rec.images.push(bImg);
    }

    // 地形危害：流沙减速潭 / 冰面滑行湖，每 chunk 概率一处，贴花压地面
    if (this.stage.hazards) {
      for (const hz of this.stage.hazards) {
        if (rand() < hz.perChunk) {
          const x = cx * CHUNK + rand() * CHUNK;
          const y = cy * CHUNK + rand() * CHUNK;
          const tex = hz.type === 'icesheet' ? 'tex_hazard_icesheet' : 'tex_hazard_quicksand';
          const img = this.obtain(tex, x, y);
          img.setDepth(Depths.Map + 1).setScale((hz.radius * 2) / 24);
          const zone: HazardZone = {
            x, y, r: hz.radius,
            slowPct: hz.slowPct ?? 1,
            slideK: hz.type === 'icesheet' ? hz.slideK : undefined,
            img,
          };
          rec.hazards ??= [];
          rec.hazards.push(zone);
          this.hazards.push(zone);
          rec.images.push(img);
        }
      }
    }

    this.chunks.set(key, rec);
  }

  /** 地形减速系数：玩家在任一危害区内取最严值，区外为 1 */
  slowFactorAt(x: number, y: number): number {
    let f = 1;
    for (const z of this.hazards) {
      const dx = x - z.x;
      const dy = y - z.y;
      if (dx * dx + dy * dy < z.r * z.r) f = Math.min(f, z.slowPct);
    }
    return f;
  }

  /** 冰面滑行系数：玩家在冰湖区内取最小值（最重滑），区外用 stage.iceSlide 全图底滑 */
  slideKAt(x: number, y: number): number {
    let f = this.stage.iceSlide ?? 1;
    for (const z of this.hazards) {
      if (z.slideK === undefined) continue;
      const dx = x - z.x;
      const dy = y - z.y;
      if (dx * dx + dy * dy < z.r * z.r) f = Math.min(f, z.slideK);
    }
    return f;
  }

  /** 沉眠守卫：每 chunk 确定性概率一只，生成过不再重复（敌人不受 chunk 回收管理） */
  private seedDormant(cx: number, cy: number, key: string): void {
    const pack = this.stage.dormantPack;
    if (!pack || !this.ctx || this.dormantSeeded.has(key)) return;
    this.dormantSeeded.add(key);
    const rand = mulberry32(hashChunk(cx + 31, cy + 7));
    if (rand() >= pack.perChunk) return;
    const x = cx * CHUNK + CHUNK * 0.2 + rand() * CHUNK * 0.6;
    const y = cy * CHUNK + CHUNK * 0.2 + rand() * CHUNK * 0.6;
    this.ctx.director.spawnDormant(pack.enemyId, x, y);
  }

  private despawnChunk(key: string, rec: ChunkRecord): void {
    if (rec.hazards) {
      for (const z of rec.hazards) {
        const i = this.hazards.indexOf(z);
        if (i >= 0) this.hazards.splice(i, 1);
      }
    }
    for (const img of rec.images) this.release(img);
    for (const f of rec.fires) {
      const idx = this.fires.indexOf(f);
      if (idx >= 0) this.fires.splice(idx, 1);
    }
    this.chunks.delete(key);
  }

  private obtain(key: string, x: number, y: number): Phaser.GameObjects.Image {
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, key);
    img.setTexture(key);
    img.setPosition(x, y);
    img.setActive(true).setVisible(true);
    img.setDepth(Depths.Map + 2);
    img.setScale(1).setAlpha(1).clearTint().setFlipX(false);
    return img;
  }

  private release(img: Phaser.GameObjects.Image): void {
    img.setActive(false).setVisible(false);
    this.pool.push(img);
  }

  /** 活跃篝火位置（粒子余烬用） */
  firePositions(): { x: number; y: number }[] {
    return this.fires
      .filter((f) => f.fire.active)
      .map((f) => ({ x: f.fire.x, y: f.fire.y - 6 }));
  }

  private pickProp(rand: () => number): PropEntry {
    const total = this.props.reduce((s, p) => s + p.weight, 0);
    let roll = rand() * total;
    for (const p of this.props) {
      roll -= p.weight;
      if (roll <= 0) return p;
    }
    return this.props[this.props.length - 1];
  }

  /** 篝火两帧切换 + 光晕呼吸 */
  private flickFires(deltaMs: number): void {
    this.flickAcc += deltaMs;
    if (this.flickAcc < FLICKER_MS) return;
    this.flickAcc = 0;
    this.flickFrame = !this.flickFrame;
    for (const f of this.fires) {
      if (!f.fire.active) continue;
      const flick = FLICKER_PROPS[f.aKey];
      if (!flick) continue;
      f.fire.setTexture(this.flickFrame ? flick.b : f.aKey);
      f.glow.setAlpha(this.flickFrame ? 0.34 : 0.24);
    }
  }

  // ==================== 建筑/祭坛 ====================

  private pickWeighted<T extends { weight: number }>(list: T[], rand: () => number): T {
    const total = list.reduce((s, p) => s + p.weight, 0);
    let roll = rand() * total;
    for (const p of list) {
      roll -= p.weight;
      if (roll <= 0) return p;
    }
    return list[list.length - 1];
  }

  /** 祭坛大网格：坐标哈希决定是否生成+生成哪种（与探索顺序无关，确定性） */
  private ensureAltar(ax: number, ay: number): void {
    const key = `a${ax},${ay}`;
    if (this.altars.has(key)) return;
    const rand = mulberry32(hashChunk(ax + 7919, ay - 5417));
    if (rand() >= ALTAR_CHANCE) {
      this.altars.set(key, null as unknown as AltarObj);
      return;
    }
    const pool = this.buildingTable!.altars.filter(
      (d) => (this.spawnedByEffect.get(d.effect!) ?? 0) < (d.maxPerRun ?? Number.MAX_SAFE_INTEGER),
    );
    if (!pool.length) {
      this.altars.set(key, null as unknown as AltarObj);
      return;
    }
    const def = this.pickWeighted(pool, rand);
    const x = ax * ALTAR_CELL + ALTAR_CELL * 0.5 + (rand() - 0.5) * ALTAR_CELL * 0.4;
    const y = ay * ALTAR_CELL + ALTAR_CELL * 0.5 + (rand() - 0.5) * ALTAR_CELL * 0.4;
    const img = this.scene.add.image(x, y, def.tex).setDepth(Depths.Map + 2).setScale(1.05);
    const glow = this.scene.add
      .image(x, y, 'tex_zone')
      .setTint(0xffd25e)
      .setAlpha(0.2)
      .setDepth(Depths.Map + 1)
      .setScale(0.7);
    // 本体金色轮廓光：初始强度 0（不显示），近距时点亮
    const fxGlow = img.postFX?.addGlow(0xffd25e, 0, 0, false, 0.2, 8);
    this.altars.set(key, { def, img, glow, fxGlow, x, y, used: false });
    this.spawnedByEffect.set(def.effect!, (this.spawnedByEffect.get(def.effect!) ?? 0) + 1);
  }

  private updateAltars(deltaMs: number): void {
    if (this.buffs.length && this.ctx) {
      for (let i = this.buffs.length - 1; i >= 0; i--) {
        if (this.nowMs >= this.buffs[i].until) {
          this.ctx.player.applyStatPatch(this.buffs[i].revert);
          this.buffs.splice(i, 1);
        }
      }
    }
    if (!this.ctx) return;
    const p = this.ctx.player;
    for (const a of this.altars.values()) {
      if (!a) continue;
      if (!a.used) a.glow.setScale(0.7 + Math.sin(this.nowMs / 420 + a.x * 0.01) * 0.1);
      const d = Phaser.Math.Distance.Between(p.x, p.y, a.x, a.y);
      // 本体金边：未用且近距才发光，越近越强、呼吸越快
      if (a.fxGlow) {
        if (!a.used && d < ALTAR_HINT_R) {
          const k = 1 - d / ALTAR_HINT_R; // 0 远 → 1 贴脸
          a.fxGlow.outerStrength = 1.5 + k * 3.5 + Math.sin(this.nowMs / (260 - k * 140)) * 0.8;
        } else if (a.fxGlow.outerStrength > 0) {
          a.fxGlow.outerStrength = 0;
        }
      }
      if (a.def.effect === 'regen_aura') {
        // 石圈不消耗：光环内持续回血
        if (d < AURA_R) p.heal((p.stats.maxHp * AURA_HEAL_PCT * deltaMs) / 1000);
        continue;
      }
      // 充能型祭坛（太阳祭坛）：光环内站满 channelMs 才触发；离开按 2× 退条
      const need = a.def.channelMs;
      if (!a.used && need) {
        a.chargeMs = a.chargeMs ?? 0;
        if (d < ALTAR_TRIGGER_R) {
          a.chargeMs += deltaMs;
          const k = Math.min(1, a.chargeMs / need);
          a.glow.setScale(0.7 + k * 1.1).setAlpha(0.2 + k * 0.45);
          if (a.chargeMs >= need) this.triggerAltar(a);
        } else if (a.chargeMs > 0) {
          a.chargeMs = Math.max(0, a.chargeMs - deltaMs * 2);
        }
        continue;
      }
      if (!a.used && d < ALTAR_TRIGGER_R) this.triggerAltar(a);
    }
  }

  private triggerAltar(a: AltarObj): void {
    a.used = true;
    a.img.setTint(0x555560).setAlpha(0.92);
    a.glow.setVisible(false);
    if (a.fxGlow) a.fxGlow.outerStrength = 0;
    const p = this.ctx!.player;
    switch (a.def.effect!) {
      case 'blood_pact': {
        const cost = Math.max(1, Math.floor(p.hp * 0.1));
        p.hp = Math.max(1, p.hp - cost); // 献祭直扣，不吃护甲/无敌
        p.applyStatPatch({ damagePct: 0.08 });
        this.flashText(a.x, a.y - 34, `血契 -${cost}HP → 永久+8%伤害`, '#ff6a6a');
        break;
      }
      case 'heal_xp': {
        const n = Math.floor(p.stats.maxHp * 0.25);
        p.heal(n);
        p.gainXp(15);
        this.flashText(a.x, a.y - 30, `精灵泉 +${n}HP +15经验`, '#8ae8ff');
        break;
      }
      case 'witch_gamble': {
        if (Math.random() < 0.6) {
          this.addBuff({ speed: p.stats.speed * 0.12 }, 30000);
          this.ctx!.pickups.spawn('pickup_meat', a.x + 22, a.y + 12);
          this.ctx!.pickups.spawn('pickup_xp_big', a.x - 22, a.y + 12);
          this.flashText(a.x, a.y - 34, '女巫的祝福 +12%速度30s', '#9ad8ff');
        } else {
          this.ctx!.director.spawnRing('enemy_brute', a.x, a.y, 5, 150, 3);
          this.ctx!.pickups.spawn('pickup_chest', a.x, a.y + 20);
          this.flashText(a.x, a.y - 34, '女巫的诅咒！杀出重围', '#ff6a6a');
        }
        break;
      }
      case 'holy_altar': {
        const n = Math.floor(p.stats.maxHp * 0.4);
        p.heal(n);
        this.novaBurst(a.x, a.y, 170, 45, 0x9ad8ff);
        this.flashText(a.x, a.y - 34, `圣光洗礼 +${n}HP`, '#ffe89a');
        break;
      }
      case 'alchemy': {
        const opts = ['pickup_meat', 'pickup_magnet', 'pickup_xp_big', 'pickup_bomb'];
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const id = opts[Math.floor(Math.random() * opts.length)];
          this.ctx!.pickups.spawn(id, a.x + (i - 0.5) * 34, a.y + 16);
        }
        this.flashText(a.x, a.y - 30, '炼金产物出炉', '#c070ff');
        break;
      }
      case 'throne': {
        this.addBuff({ damagePct: 0.15, speed: p.stats.speed * 0.1 }, 45000);
        this.flashText(a.x, a.y - 34, '英灵庇佑 +15%伤害 +10%速度 45s', '#8ae8ff');
        break;
      }
      case 'cursed_mirror': {
        const e = this.ctx!.director.spawnAt('enemy_armor_captain', 4, true);
        if (e) {
          this.mirrorElites.add(e);
          if (!this.mirrorBound) {
            this.mirrorBound = true;
            eventBus.on(GameEvents.EnemyKilled, this.onMirrorKilled, this);
            this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
              eventBus.off(GameEvents.EnemyKilled, this.onMirrorKilled, this),
            );
          }
        }
        this.flashText(a.x, a.y - 34, '镜影苏醒！击杀得宝箱', '#c070ff');
        break;
      }
      case 'sun_shrine': {
        const n = Math.floor(p.stats.maxHp * 0.3);
        p.heal(n);
        this.ctx!.pickups.spawn('pickup_relic_shard', a.x - 26, a.y - 20);
        this.ctx!.pickups.spawn('pickup_chest', a.x - 26, a.y + 20);
        this.ctx!.pickups.spawn('pickup_xp_big', a.x + 26, a.y + 20);
        this.ctx!.director.spawnRing('enemy_scarab', a.x, a.y, 8, 160);
        this.ctx!.director.spawnRing('enemy_mummy', a.x, a.y, 4, 110);
        this.flashText(a.x, a.y - 34, `日炎赐福 +${n}HP · 守卫苏醒！`, '#ffd25e');
        break;
      }
    }
  }

  private addBuff(patch: Partial<Stats>, durationMs: number): void {
    const p = this.ctx!.player;
    p.applyStatPatch(patch);
    const revert = {} as Record<keyof Stats, number>;
    for (const k of Object.keys(patch) as (keyof Stats)[]) revert[k] = -(patch[k] ?? 0);
    this.buffs.push({ revert, until: this.nowMs + durationMs });
  }

  /** 圣光nova：金环扩散 + 半径内敌伤 */
  private novaBurst(x: number, y: number, radius: number, dmg: number, color: number): void {
    const ring = this.scene.add
      .image(x, y, 'tex_zone')
      .setTint(color)
      .setAlpha(0.55)
      .setDepth(Depths.Map + 3)
      .setScale(radius / 64);
    this.scene.tweens.add({
      targets: ring,
      alpha: 0,
      scale: (radius / 64) * 1.25,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
    for (const e of this.ctx!.enemies.getChildren() as Enemy[]) {
      if (e.active && Phaser.Math.Distance.Between(x, y, e.x, e.y) < radius) e.takeDamage(dmg);
    }
  }

  /** 镜影精英死亡 → 原地掉大宝箱 */
  private onMirrorKilled(p: EnemyKilledPayload): void {
    if (!this.mirrorElites.delete(p.enemy)) return;
    this.ctx?.pickups.spawn('pickup_chest', p.x, p.y);
    this.flashText(p.x, p.y - 20, '镜影破碎，宝箱现身', '#ffd25e');
  }

  private flashText(x: number, y: number, msg: string, color: string): void {
    const t = txt(this.scene, x, y, msg, { fontSize: '13px', color })
      .setOrigin(0.5)
      .setDepth(Depths.Hud - 1);
    this.scene.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 1600, onComplete: () => t.destroy() });
  }

  /** HUD 箭头：范围内未触发的祭坛坐标 */
  altarHints(px: number, py: number, range: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const a of this.altars.values()) {
      if (!a || a.used) continue;
      if (Phaser.Math.Distance.Between(px, py, a.x, a.y) <= range) out.push({ x: a.x, y: a.y });
    }
    return out;
  }
}
