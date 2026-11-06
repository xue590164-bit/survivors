import Phaser from 'phaser';
import type { CharacterDef, Stats, WeaponMod } from '../types';
import { eventBus, GameEvents } from '../core/EventBus';
import { Depths, INVULN_MS } from '../config';
import { FrameAnimator, frameKeysOf } from './FrameAnimator';

const ZERO_STATS: Stats = {
  maxHp: 0, speed: 0, armor: 0, damagePct: 0,
  areaPct: 0, cooldownPct: 0, magnetRadius: 0, xpGainPct: 0,
  critPct: 0, regenPerSec: 0, ricochetPct: 0,
};

export function mergeStats(base: Stats, bonus: Partial<Stats>): Stats {
  const out = { ...base };
  for (const k of Object.keys(bonus) as (keyof Stats)[]) {
    out[k] = base[k] + (bonus[k] ?? 0);
  }
  return out;
}

export class Player extends Phaser.Physics.Arcade.Sprite {
  readonly charDef: CharacterDef;
  stats: Stats;
  /** 神兵残片（合成神兵的材料，局内计数） */
  relicShards = 0;
  /** 沙暴推力 px/s（GameScene 每帧写入，默认 0） */
  envWindX = 0;
  envWindY = 0;
  /** 地形减速回调（MapSystem 挂入），返回 0~1 移速系数 */
  terrain?: (x: number, y: number) => number;
  /** 冰面滑行插值回调（MapSystem 挂入），返回 0~1 趋近系数，越小越滑 */
  slideAt?: (x: number, y: number) => number;
  /** 全图基础滑行系数（stage.iceSlide，缺省=1 不滑） */
  slideBase = 1;

  hp = 1;
  level = 1;
  xp = 0;
  xpToNext = 0;
  kills = 0;

  /** 局外成长的武器专属修正：key=武器id */
  readonly weaponMods: Record<string, WeaponMod>;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastHurtAt = -Infinity;
  private anim!: FrameAnimator;
  private animSets!: Record<'down' | 'up' | 'side', string[]>;
  private dir: 'down' | 'up' | 'side' = 'down';
  private regenAcc = 0;
  /** 调试无敌标记（DebugSystem 用） */
  god = false;
  /** 移动端虚拟摇杆向量（-1~1），非零时优先于键盘 */
  virtualVec = { x: 0, y: 0 };

  constructor(
    scene: Phaser.Scene,
    charDef: CharacterDef,
    metaBonus: Partial<Stats>,
    weaponMods: Record<string, WeaponMod> = {},
  ) {
    super(scene, 0, 0, `tex_${charDef.id}`);
    this.charDef = charDef;
    this.stats = mergeStats(charDef.baseStats, { ...ZERO_STATS, ...metaBonus });
    this.weaponMods = weaponMods;
    this.hp = this.stats.maxHp;
    this.xpToNext = Player.xpNeeded(1);

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(Depths.Player);
    this.setScale(1.05);
    this.body!.setSize(this.width * 0.7, this.height * 0.8);
    const base = `tex_${charDef.id}`;
    this.animSets = {
      down: frameKeysOf(scene, base),
      up: frameKeysOf(scene, `${base}_up`),
      side: frameKeysOf(scene, `${base}_side`),
    };
    this.anim = new FrameAnimator(this, this.animSets.down, 220);

    const kb = scene.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
        up2: Phaser.Input.Keyboard.KeyCodes.UP,
        down2: Phaser.Input.Keyboard.KeyCodes.DOWN,
        left2: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right2: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      }) as Record<string, Phaser.Input.Keyboard.Key>;
    }
  }

  static xpNeeded(level: number): number {
    return Math.floor(5 + level * 8 + level * level * 0.4);
  }

  update(deltaMs: number): void {
    if (!this.active) return;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const k = this.keys;
    let vx = 0;
    let vy = 0;
    if (k) {
      if (k.left.isDown || k.left2.isDown) vx -= 1;
      if (k.right.isDown || k.right2.isDown) vx += 1;
      if (k.up.isDown || k.up2.isDown) vy -= 1;
      if (k.down.isDown || k.down2.isDown) vy += 1;
    }
    if (vx === 0 && vy === 0 && (this.virtualVec.x !== 0 || this.virtualVec.y !== 0)) {
      vx = this.virtualVec.x;
      vy = this.virtualVec.y;
    }
    const len = Math.hypot(vx, vy) || 1;
    const moving = vx !== 0 || vy !== 0;
    // 地形减速（流沙）× 环境风力（沙暴/暴雪）：由 GameScene 每帧注入
    const slow = this.terrain ? this.terrain(this.x, this.y) : 1;
    const tx = (vx / len) * this.stats.speed * slow + this.envWindX;
    const ty = (vy / len) * this.stats.speed * slow + this.envWindY;
    // 冰面滑行：速度向目标插值而非瞬时设置（全图微滑+冻湖重滑，帧率无关）
    const sk = this.slideAt ? this.slideAt(this.x, this.y) : this.slideBase;
    if (sk < 1) {
      const k = 1 - Math.pow(1 - sk, deltaMs / 16.67);
      const cv = body.velocity;
      body.setVelocity(cv.x + (tx - cv.x) * k, cv.y + (ty - cv.y) * k);
    } else {
      body.setVelocity(tx, ty);
    }
    // 侧面贴图本身朝左：右移时翻转，左移保持原样
    if (vx !== 0) this.setFlipX(vx > 0);
    // 朝向：横向优先侧面，否则上=背面/下=正面
    let dir: Player['dir'] = this.dir;
    if (vx !== 0) dir = 'side';
    else if (vy < 0) dir = 'up';
    else if (vy > 0) dir = 'down';
    if (dir !== this.dir) {
      this.dir = dir;
      this.anim.setFrames(this.animSets[dir]);
    }
    // 走路帧：移动播动画，静止回第一帧
    this.anim.playing = moving;
    if (moving) this.anim.update(deltaMs);
    else this.anim.reset();
    // 再生：按秒回血，攒整数跳
    if (this.stats.regenPerSec > 0 && this.hp < this.stats.maxHp) {
      this.regenAcc += (this.stats.regenPerSec * deltaMs) / 1000;
      if (this.regenAcc >= 1) {
        this.heal(Math.floor(this.regenAcc));
        this.regenAcc %= 1;
      }
    }
  }

  /** 面向弧度：近战类武器按这个摆攻击方位 */
  get facingAngle(): number {
    switch (this.dir) {
      case 'up': return -Math.PI / 2;
      case 'down': return Math.PI / 2;
      default: return this.flipX ? 0 : Math.PI;
    }
  }

  takeDamage(raw: number, nowMs: number): void {
    if (this.god) return;
    if (nowMs - this.lastHurtAt < INVULN_MS) return;
    this.lastHurtAt = nowMs;
    const dmg = Math.max(1, Math.round(raw - this.stats.armor));
    this.hp -= dmg;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.clearTint();
    });
    eventBus.emit(GameEvents.PlayerDamaged, { hp: this.hp, dmg });
    if (this.hp <= 0) {
      this.hp = 0;
      eventBus.emit(GameEvents.PlayerDied);
    }
  }

  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  gainXp(n: number): void {
    this.xp += n * (1 + this.stats.xpGainPct);
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext = Player.xpNeeded(this.level);
      eventBus.emit(GameEvents.LevelUp, { level: this.level });
    }
    eventBus.emit(GameEvents.XpChanged, { xp: this.xp, xpToNext: this.xpToNext });
  }

  applyStatPatch(patch: Partial<Stats>): void {
    this.stats = mergeStats(this.stats, patch);
    if (patch.maxHp) this.hp += patch.maxHp;
  }
}
