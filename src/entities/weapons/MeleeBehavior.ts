import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { DamageZone } from '../DamageZone';
import { Depths } from '../../config';

const ARC_RADIUS = 82;
const SWING_MS = 260;
const OFFSET = 62;
const SWEEP = 2.1;

/** 近战类武器：锁最近敌人方向挥砍（无敌人时回退面向），粗弧光扫过扇形判定区 */
export class MeleeBehavior extends WeaponBehavior {
  private group: Phaser.Physics.Arcade.Group;
  private activeUntil = 0;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({ classType: DamageZone, runChildUpdate: false });
    // 命中间隔 > 挥击时长 → 每次挥击每敌人只吃一次
    ctx.combat.registerZoneGroup(this.group, SWING_MS + 200);
  }

  protected fire(nowMs: number): void {
    const full = !!this.lv.fullCircle;
    // 攻击方向 = 最近敌人方向；没有敌人时回退到移动朝向
    const near = this.nearestEnemies(1)[0];
    const a = near
      ? Phaser.Math.Angle.Between(this.ctx.player.x, this.ctx.player.y, near.x, near.y)
      : this.ctx.player.facingAngle;
    const { x, y } = this.ctx.player;
    const ox = full ? 0 : Math.cos(a) * OFFSET;
    const oy = full ? 0 : Math.sin(a) * OFFSET;
    const radius = ARC_RADIUS * this.effArea();

    const z = this.group.get() as DamageZone | null;
    if (!z) return;
    z.activate(x + ox, y + oy, `tex_${this.def.id}`, `melee_${this.def.id}`, this.effDamage(), this.def.id);
    z.setScale((radius * 2) / z.width);
    const body = z.body as Phaser.Physics.Arcade.Body;
    body.setCircle(z.width / 2);
    z.knockback = this.lv.knockback ?? 0;
    // 判定框隐形：挥击观感由独立的弧光扫动动画承担
    z.setAlpha(0);
    this.activeUntil = nowMs + SWING_MS;

    const scene = this.ctx.scene;
    const arc = scene.add.graphics().setDepth(Depths.Projectile);
    const icon = scene.add
      .image(x, y, `tex_${this.def.id}`)
      .setDepth(Depths.Projectile + 1)
      .setScale(2.3);
    const startA = full ? a : a - SWEEP / 2;
    const total = full ? Math.PI * 2 : SWEEP;
    const swing = { t: 0 };
    scene.tweens.add({
      targets: swing,
      t: 1,
      duration: SWING_MS,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        const px = this.ctx.player.x;
        const py = this.ctx.player.y;
        const curA = startA + total * swing.t;
        const fade = 1 - swing.t * 0.55;
        // 外圈厚刃弧：从起始角逐渐扫到当前角
        arc.clear();
        arc.lineStyle(16, 0xffe9a0, 0.55 * fade);
        arc.beginPath();
        arc.arc(px, py, radius * 0.78, startA, curA);
        arc.strokePath();
        // 内圈亮白芯
        arc.lineStyle(7, 0xffffff, 0.9 * fade);
        arc.beginPath();
        arc.arc(px, py, radius * 0.78, startA, curA);
        arc.strokePath();
        // 武器本体贴在刃口前沿，沿切线翻飞
        icon.setPosition(px + Math.cos(curA) * radius * 0.78, py + Math.sin(curA) * radius * 0.78);
        icon.setRotation(curA + Math.PI / 2 + swing.t * Math.PI * 2.5);
        icon.setAlpha(1 - swing.t * 0.35);
        icon.setScale(2.3 + swing.t * 0.5);
        this.ctx.particles?.slash(icon.x, icon.y);
      },
      onComplete: () => {
        icon.destroy();
        arc.destroy();
      },
    });
  }

  protected tick(nowMs: number): void {
    for (const child of this.group.getChildren()) {
      const z = child as DamageZone;
      if (z.active && nowMs > this.activeUntil) z.deactivate();
    }
  }

  destroy(): void {
    this.group.destroy(true);
  }
}
