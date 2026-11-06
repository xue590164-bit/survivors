import Phaser from 'phaser';
import { eventBus, GameEvents, type EnemyKilledPayload } from '../core/EventBus';
import { Depths } from '../config';
import type { Player } from '../entities/Player';
import type { Pickup } from '../entities/Pickup';
import type { MapSystem } from './MapSystem';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

const PDEPTH = Depths.Hud - 1;
const FRAME_BUDGET = 260; // 单帧允许发射的粒子总量上限

const EMBER_INTERVAL_MS = 240;
const DUST_INTERVAL_MS = 300;
const BUBBLE_INTERVAL_MS = 260;

/**
 * 粒子效果中心：全部效果监听 eventBus 自动触发，零侵入各业务系统。
 * 爆发效果走 explode()（发射器常驻、粒子即放即销），环境效果走 emitParticleAt 节流。
 */
export class ParticleSystem {
  private emitters = new Map<string, Emitter>();
  private emitted = 0;
  private emberAcc = 0;
  private dustAcc = 0;
  private nextBubbleAt = 0;

  constructor(
    private scene: Phaser.Scene,
    private player: Player,
    private mapSystem: MapSystem,
  ) {
    eventBus.on(GameEvents.EnemyKilled, this.onEnemyKilled, this);
    eventBus.on(GameEvents.EnemyDamaged, this.onEnemyDamaged, this);
    eventBus.on(GameEvents.PlayerDamaged, this.onPlayerDamaged, this);
    eventBus.on(GameEvents.LevelUp, this.onLevelUp, this);
    eventBus.on(GameEvents.PickupCollected, this.onPickup, this);
    eventBus.on(GameEvents.WeaponEvolved, this.onEvolved, this);
    eventBus.on(GameEvents.BossPhase, this.onBossPhase, this);
  }

  destroy(): void {
    eventBus.off(GameEvents.EnemyKilled, this.onEnemyKilled, this);
    eventBus.off(GameEvents.EnemyDamaged, this.onEnemyDamaged, this);
    eventBus.off(GameEvents.PlayerDamaged, this.onPlayerDamaged, this);
    eventBus.off(GameEvents.LevelUp, this.onLevelUp, this);
    eventBus.off(GameEvents.PickupCollected, this.onPickup, this);
    eventBus.off(GameEvents.WeaponEvolved, this.onEvolved, this);
    eventBus.off(GameEvents.BossPhase, this.onBossPhase, this);
    for (const e of this.emitters.values()) e.destroy();
    this.emitters.clear();
  }

  // ================= 发射器工厂（懒创建 + 缓存） =================

  private make(key: string, tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig): Emitter {
    let e = this.emitters.get(key);
    if (!e) {
      e = this.scene.add.particles(0, 0, tex, { emitting: false, ...cfg });
      e.setDepth(PDEPTH);
      this.emitters.set(key, e);
    }
    return e;
  }

  /** 碎块：击杀爆体主用 */
  private chunk(tint: number): Emitter {
    return this.make(`chunk_${tint}`, 'pt_square', {
      speed: { min: 50, max: 190 },
      gravityY: 420,
      lifespan: { min: 280, max: 560 },
      scale: { start: 0.9, end: 0 },
      tint,
    });
  }

  /** 星点：命中火花/宝箱/升级 */
  private spark(tint: number): Emitter {
    return this.make(`spark_${tint}`, 'pt_star', {
      speed: { min: 30, max: 150 },
      lifespan: { min: 180, max: 360 },
      scale: { start: 1.1, end: 0 },
      tint,
    });
  }

  /** 菱形碎片：命中迸溅/爆体碎屑，比方块更锐 */
  private shard(tint: number): Emitter {
    return this.make(`shard_${tint}`, 'pt_shard', {
      speed: { min: 70, max: 220 },
      gravityY: 260,
      lifespan: { min: 160, max: 380 },
      scale: { start: 0.85, end: 0 },
      rotate: { min: -180, max: 180 },
      tint,
    });
  }

  /** 亡魂：击杀后一缕缓升的光魂 */
  private wisp(tint = 0xbfe8ff): Emitter {
    return this.glow(`wisp_${tint}`, tint, {
      speedY: { min: -32, max: -58 },
      speedX: { min: -9, max: 9 },
      lifespan: { min: 750, max: 1300 },
      scale: { start: 0.65, end: 0.12 },
      alpha: { start: 0.75, end: 0 },
    });
  }

  /** 光点系列：参数化变体 */
  private glow(
    key: string,
    tint: number,
    cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
  ): Emitter {
    return this.make(`glow_${key}`, 'pt_glow', { tint, ...cfg });
  }

  private fountain(): Emitter {
    return this.glow('fountain', 0xffd25e, {
      speedY: { min: -150, max: -240 },
      speedX: { min: -45, max: 45 },
      lifespan: { min: 650, max: 1100 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
    });
  }

  private ember(): Emitter {
    return this.glow('ember', 0xff9030, {
      speedY: { min: -28, max: -58 },
      speedX: { min: -12, max: 12 },
      lifespan: { min: 900, max: 1800 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.9, end: 0 },
    });
  }

  private bubble(): Emitter {
    return this.glow('bubble', 0x6fd86f, {
      speedY: { min: -12, max: -30 },
      lifespan: { min: 550, max: 1100 },
      scale: { start: 0.4, end: 0.9 },
      alpha: { start: 0.55, end: 0 },
    });
  }

  private dust(): Emitter {
    return this.glow('dust', 0x9aa090, {
      speedY: { min: -8, max: -24 },
      speedX: { min: -14, max: 14 },
      lifespan: { min: 380, max: 680 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.7, end: 0 },
    });
  }

  private gemFlash(): Emitter {
    return this.glow('gem', 0x6fe8ff, {
      speed: { min: 10, max: 40 },
      lifespan: { min: 140, max: 260 },
      scale: { start: 1.3, end: 0 },
    });
  }

  /** 沙尘粒：沙暴横扫风线，速度沿风向拉直 */
  private sandStreak(wx: number, wy: number): Emitter {
    return this.make(`sandstreak`, 'pt_glow', {
      speedX: { min: wx * 0.7, max: wx * 1.3 },
      speedY: { min: wy * 0.7 - 18, max: wy * 1.3 + 18 },
      lifespan: { min: 700, max: 1400 },
      scale: { start: 0.7, end: 0.15 },
      alpha: { start: 0.4, end: 0 },
      tint: 0xd8b060,
    });
  }

  /** 沙爆：沙虫钻出/钻沙点爆沙 */
  private sandGeyser(): Emitter {
    return this.make('sandgeyser', 'pt_square', {
      speed: { min: 60, max: 200 },
      gravityY: 320,
      lifespan: { min: 260, max: 520 },
      scale: { start: 0.8, end: 0 },
      tint: 0xc8a050,
    });
  }

  // ================= 预算 =================

  private spend(n: number): boolean {
    if (this.emitted + n > FRAME_BUDGET) return false;
    this.emitted += n;
    return true;
  }

  // ================= 相机效果收口 =================

  shake(ms: number, intensity = 0.006): void {
    this.scene.cameras.main.shake(ms, intensity);
  }

  flash(ms: number, color = 0xffffff): void {
    const c = Phaser.Display.Color.IntegerToColor(color);
    this.scene.cameras.main.flash(ms, c.red, c.green, c.blue);
  }

  /** 落雷视觉：程序化折线闪电从空中劈到命中点 + 落地迸星 + 小冲击环 */
  lightning(x: number, y: number): void {
    const g = this.scene.add.graphics().setDepth(PDEPTH);
    // 折线：从 (x±8, y-72) 折 3 段到 (x, y)
    const top = y - 72;
    const segs = 4;
    g.lineStyle(3, 0xfff0a0, 0.95);
    g.beginPath();
    g.moveTo(x + Phaser.Math.Between(-8, 8), top);
    for (let i = 1; i < segs; i++) {
      const ty = top + ((y - top) / segs) * i;
      g.lineTo(x + Phaser.Math.Between(-14, 14) * (1 - i / segs), ty);
    }
    g.lineTo(x, y);
    g.strokePath();
    // 内芯白线
    g.lineStyle(1, 0xffffff, 0.9);
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x + Phaser.Math.Between(-5, 5), y - 30);
    g.lineTo(x, y);
    g.strokePath();
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: 240,
      ease: 'Cubic.easeIn',
      onComplete: () => g.destroy(),
    });
    if (this.spend(5)) {
      this.spark(0xfff0a0).explode(5, x, y);
      this.shockwave(x, y, 0xffe080, 0.5);
    }
  }

  /** 冲击波环：缩放渐隐的圆形贴图 */
  shockwave(x: number, y: number, tint: number, scale: number): void {
    const ring = this.scene.add
      .image(x, y, 'tex_zone')
      .setTint(tint)
      .setAlpha(0.65)
      .setScale(0.15)
      .setDepth(PDEPTH);
    this.scene.tweens.add({
      targets: ring,
      scale,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  // ================= 事件接线 =================

  private onEnemyKilled(p: EnemyKilledPayload): void {
    const n = p.isBoss ? 26 : p.isElite ? 16 : 7;
    if (this.spend(n + 4)) {
      this.chunk(p.enemy.def.color).explode(n, p.x, p.y);
      this.chunk(0xffffff).explode(3, p.x, p.y);
      this.wisp().emitParticleAt(p.x, p.y - 4, p.isBoss || p.isElite ? 2 : 1);
    }
    if (p.isBoss) {
      this.shockwave(p.x, p.y, 0xff6060, 2.2);
      this.shockwave(p.x, p.y, 0xffe080, 1.6);
      this.shake(320, 0.01);
    } else if (p.isElite) {
      this.shockwave(p.x, p.y, 0xffb070, 1.5);
      this.shake(140, 0.004);
    }
  }

  private onEnemyDamaged(p: { dmg: number; x: number; y: number; crit?: boolean }): void {
    // 暴击：橙色碎片爆裂，和普通命中手感拉开
    if (p.crit) {
      if (this.spend(5)) this.shard(0xff9838).explode(5, p.x, p.y);
      return;
    }
    if (Math.random() > 0.55 || !this.spend(3)) return;
    this.shard(0xfff0a0).explode(3, p.x, p.y);
  }

  private onPlayerDamaged(): void {
    if (this.spend(8)) this.chunk(0xe05050).explode(8, this.player.x, this.player.y);
    this.shake(160, 0.006);
  }

  private onLevelUp(): void {
    const { x, y } = this.player;
    // 冲天光柱 + 金泉
    const beam = this.scene.add
      .image(x, y - 46, 'pt_glow')
      .setTint(0xffe090)
      .setAlpha(0.85)
      .setScale(0.55, 0.2)
      .setDepth(PDEPTH);
    this.scene.tweens.add({
      targets: beam,
      scaleY: 3.2,
      scaleX: 0.9,
      alpha: 0,
      duration: 720,
      ease: 'Cubic.easeOut',
      onComplete: () => beam.destroy(),
    });
    if (this.spend(30)) {
      this.fountain().explode(26, x, y + 8);
      this.spark(0xffd25e).explode(8, x, y - 10);
    }
  }

  private onPickup(p: { pickup: Pickup }): void {
    const { x, y } = p.pickup;
    switch (p.pickup.def.type) {
      case 'xp':
        if (this.spend(3) && Math.random() < 0.5) this.gemFlash().explode(2, x, y);
        break;
      case 'heal':
        if (this.spend(6)) this.spark(0x7dff9a).explode(6, x, y);
        break;
      case 'magnet':
        if (this.spend(8)) this.spark(0x6fa8ff).explode(8, x, y);
        break;
      case 'chest':
        if (this.spend(18)) this.spark(0xffd25e).explode(14, x, y);
        this.shockwave(x, y, 0xffd25e, 1.1);
        break;
      case 'bomb':
        this.bombBlast(x, y);
        break;
    }
  }

  private onEvolved(p: { x: number; y: number }): void {
    const { x, y } = p;
    if (this.spend(30)) {
      this.chunk(0xf5e663).explode(12, x, y);
      this.spark(0xc070ff).explode(10, x, y);
      this.spark(0x6fe8ff).explode(8, x, y);
    }
    this.shockwave(x, y, 0xc070ff, 1.8);
    this.flash(200, 0xfff0c0);
    this.shake(180, 0.008);
  }

  /** Boss 转阶段：红环 + 震屏，提示"它变了" */
  private onBossPhase(p: { enemy: { x: number; y: number } }): void {
    this.shockwave(p.enemy.x, p.enemy.y, 0xff4040, 1.6);
    this.shake(250, 0.008);
    if (this.spend(14)) this.spark(0xff6060).explode(14, p.enemy.x, p.enemy.y);
  }

  private bombBlast(x: number, y: number): void {
    if (this.spend(30)) {
      this.chunk(0xffe8b0).explode(18, x, y);
      this.chunk(0xe86040).explode(10, x, y);
    }
    this.shockwave(x, y, 0xffb070, 2.6);
    this.flash(180, 0xffffff);
    this.shake(240, 0.012);
  }

  // ================= 环境效果（update 驱动） =================

  update(deltaMs: number): void {
    this.emitted = 0;

    // 篝火余烬：随机挑一处活跃篝火飘火星
    this.emberAcc += deltaMs;
    if (this.emberAcc >= EMBER_INTERVAL_MS) {
      this.emberAcc = 0;
      const fires = this.mapSystem.firePositions();
      if (fires.length > 0 && this.spend(2)) {
        const f = Phaser.Utils.Array.GetRandom(fires);
        this.ember().emitParticleAt(f.x + Phaser.Math.Between(-3, 3), f.y, 1);
      }
    }

    // 跑动扬尘
    this.dustAcc += deltaMs;
    if (this.dustAcc >= DUST_INTERVAL_MS) {
      this.dustAcc = 0;
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      if (body.velocity.lengthSq() > 1 && this.spend(1)) {
        this.dust().emitParticleAt(
          this.player.x + Phaser.Math.Between(-5, 5),
          this.player.y + 14,
          1,
        );
      }
    }

    // 沙暴：屏内随机位置沿风向扬沙线
    if (this.stormWindX !== 0 || this.stormWindY !== 0) {
      this.stormAcc += deltaMs;
      if (this.stormAcc >= 90) {
        this.stormAcc = 0;
        if (this.spend(4)) {
          const cam = this.scene.cameras.main;
          const vw = cam.worldView;
          this.sandStreak(this.stormWindX * 3, this.stormWindY * 3).emitParticleAt(
            vw.x + Math.random() * vw.width,
            vw.y + Math.random() * vw.height,
            4,
          );
        }
      }
    }
  }

  /** 枪口火花：弹道发射点沿射向迸 2 星 */
  muzzle(x: number, y: number, angle: number): void {
    if (!this.spend(2)) return;
    this.spark(0xffe8a0).explode(2, x + Math.cos(angle) * 10, y + Math.sin(angle) * 10);
  }

  /** 刀光拖尾：近战扫弧路径上的火星（每帧一粒，调用方节流） */
  slash(x: number, y: number): void {
    if (!this.spend(1)) return;
    this.shard(0xffe8c0).emitParticleAt(x, y, 1);
  }

  /** 光环类武器每帧汇报位置，内部节流冒泡 */
  auraEmit(x: number, y: number, radius: number): void {
    const now = this.scene.time.now;
    if (now < this.nextBubbleAt || !this.spend(1)) return;
    this.nextBubbleAt = now + BUBBLE_INTERVAL_MS;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius * 0.85;
    this.bubble().emitParticleAt(x + Math.cos(a) * r, y + Math.sin(a) * r, 1);
  }

  /** 沙暴激活态：GameScene 写入风向，update 期间屏内持续扬尘 */
  stormWindX = 0;
  stormWindY = 0;
  private stormAcc = 0;

  /** 钻沙预警点：位置处一小撮沙粒翻起（burrow_swarm 预告） */
  sandPuff(x: number, y: number): void {
    if (!this.spend(3)) return;
    this.sandGeyser().explode(3, x, y);
  }

  /** 沙虫跃出/敌钻出：一记沙泉爆 */
  sandBurst(x: number, y: number): void {
    if (!this.spend(9)) return;
    this.sandGeyser().explode(9, x, y);
  }
}
