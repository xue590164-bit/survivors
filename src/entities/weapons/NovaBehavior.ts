import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { DamageZone } from '../DamageZone';
import { Depths } from '../../config';

const BASE_RADIUS = 110;
const PULSE_MS = 650;

/** 脉冲类武器：周期性从自身向外扩散冲击环，命中伤害+击退（机制强→数值低） */
export class NovaBehavior extends WeaponBehavior {
  private group: Phaser.Physics.Arcade.Group;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({ classType: DamageZone, runChildUpdate: false });
    // 命中间隔 > 脉冲存活期 → 每个敌人每发脉冲只吃一次
    ctx.combat.registerZoneGroup(this.group, PULSE_MS + 100);
  }

  protected fire(_nowMs: number): void {
    const { x, y } = this.ctx.player;
    const radius = BASE_RADIUS * this.effArea();
    const z = this.group.get() as DamageZone | null;
    if (!z) return;
    z.activate(x, y, 'tex_zone', `nova_${this.def.id}`, this.effDamage(), this.def.id);
    z.setTint(this.def.color).setAlpha(0.7);
    z.setScale(0.2);
    z.knockback = this.lv.knockback ?? 0;
    const body = z.body as Phaser.Physics.Arcade.Body;
    body.setCircle(z.width / 2);
    z.setDepth(Depths.Enemy + 1);

    // 扩散动画 + 到期回收（body 随 scale 同步放大）
    this.ctx.scene.tweens.add({
      targets: z,
      scale: (radius * 2) / z.width,
      alpha: 0,
      duration: PULSE_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => z.deactivate(),
    });
    this.ctx.particles?.shockwave(x, y, this.def.color, (radius * 2) / 32);
    if (this.lv.heal) this.ctx.player.heal(this.lv.heal);
  }

  destroy(): void {
    this.group.destroy(true);
  }
}
