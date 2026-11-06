import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { Projectile } from '../Projectile';
import { DamageZone } from '../DamageZone';
import type { Enemy } from '../Enemy';
import { Depths } from '../../config';

const BURN_MS = 2600;
const BURN_TICK_MS = 380;
const BLAST_RADIUS = 68;
const FLAME_MS = 130;

interface Lob {
  sx: number; sy: number; tx: number; ty: number;
  t0: number; flightMs: number; apex: number;
  shadow: Phaser.GameObjects.Image;
}

interface Flame {
  img: Phaser.GameObjects.Image;
  dieAt: number;
  phase: number;
  scale: number;
}

/** 抛掷类武器：真抛物线（影子贴地+弹体升空翻滚）→落地爆炸+一簇跳动的火焰。机制强→单发中伤、冷却慢 */
export class LobBehavior extends WeaponBehavior {
  private group: Phaser.Physics.Arcade.Group;
  private burnGroup: Phaser.Physics.Arcade.Group;
  private lobs = new Map<Projectile, Lob>();
  private flames: Flame[] = [];
  private burnSeq = 0;
  private flameAcc = 0;
  private flameFlip = false;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({ classType: Projectile, runChildUpdate: false });
    this.burnGroup = ctx.scene.physics.add.group({ classType: DamageZone, runChildUpdate: false });
    ctx.combat.registerZoneGroup(this.burnGroup, BURN_TICK_MS);
    // 弹道不注册进 combat——瓶子从怪头顶飞过，只在落点炸
  }

  protected fire(nowMs: number): void {
    const count = this.effProjectiles();
    const targets = this.nearestEnemies(Math.max(count, 2));
    if (targets.length === 0) return;
    const px = this.ctx.player.x;
    const py = this.ctx.player.y;

    for (let i = 0; i < count; i++) {
      const t = targets[i % targets.length];
      const tx = t.x + Phaser.Math.Between(-16, 16);
      const ty = t.y + Phaser.Math.Between(-16, 16);
      const dist = Math.hypot(tx - px, ty - py);
      const flightMs = Math.max(360, (dist / 320) * 1000);
      const p = this.group.get() as Projectile | null;
      if (!p) break;
      p.fire(px, py, 0, 0, 0, 0, `tex_${this.def.id}`, flightMs + 500, nowMs, this.def.id);
      // 手动驱动轨迹，关掉物理体防干扰
      (p.body as Phaser.Physics.Arcade.Body).enable = false;
      const shadow = this.ctx.scene.add
        .image(px, py, 'tex_zone')
        .setTint(0x000000).setAlpha(0.35).setScale(0.12)
        .setDepth(Depths.Pickup + 1);
      this.lobs.set(p, {
        sx: px, sy: py, tx, ty,
        t0: nowMs, flightMs,
        apex: Phaser.Math.Clamp(dist * 0.4, 40, 110),
        shadow,
      });
    }
  }

  protected tick(nowMs: number): void {
    // 抛物线飞行：t∈[0,1]，地面插值 + 高度 = 4·apex·t(1-t) 正弦弧
    for (const [p, lob] of this.lobs) {
      if (!p.active) {
        lob.shadow.destroy();
        this.lobs.delete(p);
        continue;
      }
      const t = Math.min(1, (nowMs - lob.t0) / lob.flightMs);
      const gx = Phaser.Math.Linear(lob.sx, lob.tx, t);
      const gy = Phaser.Math.Linear(lob.sy, lob.ty, t);
      const h = 4 * lob.apex * t * (1 - t);
      p.setPosition(gx, gy - h);
      p.setRotation(t * Math.PI * 4); // 翻滚
      p.setScale(1.4 + (h / lob.apex) * 0.5);
      lob.shadow.setPosition(gx, gy).setScale(0.12 + t * 0.06).setAlpha(0.35);
      if (t >= 1) this.explode(p, lob);
    }
    // 残焰区存活检查
    for (const child of this.burnGroup.getChildren()) {
      const z = child as DamageZone;
      if (z.active && nowMs > (z.getData('dieAt') as number)) z.deactivate();
    }
    // 火焰双帧闪烁 + 到期淡出销毁
    this.flameAcc += 16;
    if (this.flameAcc >= FLAME_MS) {
      this.flameAcc = 0;
      this.flameFlip = !this.flameFlip;
    }
    const frame = this.flameFlip ? 'fx_flame_b' : 'fx_flame_a';
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const f = this.flames[i];
      if (nowMs >= f.dieAt) {
        f.img.destroy();
        this.flames.splice(i, 1);
        continue;
      }
      f.img.setTexture(frame);
      const left = f.dieAt - nowMs;
      const fade = left < 500 ? left / 500 : 1;
      f.img.setAlpha(fade * (0.75 + Math.sin(nowMs / 90 + f.phase) * 0.25));
      f.img.setScale(f.scale * (1 + Math.sin(nowMs / 110 + f.phase) * 0.12));
    }
  }

  /** 落地爆：半径伤害 + 冲击波 + 火焰簇 + 微弱灼痕区（承伤判定体） */
  private explode(p: Projectile, lob: Lob): void {
    lob.shadow.destroy();
    this.lobs.delete(p);
    p.deactivate();
    const radius = BLAST_RADIUS * this.effArea();
    const dmg = this.effDamage();
    const nowMs = this.ctx.scene.time.now;
    for (const e of this.ctx.enemies.getMatching('active', true) as Enemy[]) {
      const d = Math.hypot(e.x - lob.tx, e.y - lob.ty);
      if (d <= radius) e.takeDamage(dmg, this.def.id);
    }
    this.ctx.particles?.shockwave(lob.tx, lob.ty, 0xff9030, (radius * 2) / 28);
    this.ctx.particles?.shake(90, 0.004);

    // 承伤区几乎不可见，火焰贴图承担视觉
    const z = this.burnGroup.get() as DamageZone | null;
    if (z) {
      z.activate(lob.tx, lob.ty, 'tex_zone', `burn_${this.def.id}_${this.burnSeq++}`, dmg * 0.35, this.def.id);
      z.setTint(0xff7020).setAlpha(0.1);
      z.setScale((radius * 1.4) / z.width);
      (z.body as Phaser.Physics.Arcade.Body).setCircle(z.width / 2);
      z.setData('dieAt', nowMs + BURN_MS);
    }
    // 火焰簇：半径内随机 6~9 簇，双帧跳动
    const n = Phaser.Math.Between(6, 9);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius * 0.8;
      const img = this.ctx.scene.add
        .image(lob.tx + Math.cos(a) * r, lob.ty + Math.sin(a) * r * 0.7, 'fx_flame_a')
        .setDepth(Depths.Projectile + 1)
        .setScale(Phaser.Math.FloatBetween(1.3, 2.0));
      this.flames.push({ img, dieAt: nowMs + BURN_MS, phase: Math.random() * Math.PI * 2, scale: img.scaleX });
    }
  }

  destroy(): void {
    for (const [, lob] of this.lobs) lob.shadow.destroy();
    for (const f of this.flames) f.img.destroy();
    this.lobs.clear();
    this.flames.length = 0;
    this.group.destroy(true);
    this.burnGroup.destroy(true);
  }
}
