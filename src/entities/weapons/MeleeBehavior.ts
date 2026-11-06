import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { DamageZone } from '../DamageZone';
import { Depths } from '../../config';

const ARC_RADIUS = 82;
const SWING_MS = 200;
const OFFSET = 62;
const SWEEP = 1.7;

/** 近战类武器：朝面向方向摆一段短促的扇形判定（fullCircle=全周）。贴脸承诺→数值足、带击退 */
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
    const a = this.ctx.player.facingAngle;
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
    // 判定框隐形：挥击观感由独立的武器贴图扫弧动画承担
    z.setAlpha(0);
    this.activeUntil = nowMs + SWING_MS;

    const scene = this.ctx.scene;
    const icon = scene.add
      .image(x, y, `tex_${this.def.id}`)
      .setDepth(Depths.Projectile)
      .setScale(1.7);
    const swing = { t: 0 };
    scene.tweens.add({
      targets: swing,
      t: 1,
      duration: SWING_MS,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        // 扇形：面向方向±扫幅扫过；全周：绕身一整圈
        const ang = full ? a + swing.t * Math.PI * 2 : a - SWEEP / 2 + swing.t * SWEEP;
        icon.setPosition(
          this.ctx.player.x + Math.cos(ang) * OFFSET,
          this.ctx.player.y + Math.sin(ang) * OFFSET,
        );
        icon.setRotation(ang + Math.PI / 2 + swing.t * Math.PI * 2);
        icon.setAlpha(1 - swing.t * 0.4);
        // 刃口拖尾火星
        this.ctx.particles?.slash(icon.x, icon.y);
      },
      onComplete: () => icon.destroy(),
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
