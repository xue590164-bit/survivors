import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { Projectile } from '../Projectile';

const PROJECTILE_SPEED = 520;
const LIFESPAN_MS = 1600;

/** 弹道类武器：朝最近的敌人发射，支持多弹/穿透（穿透数=等级字段后续可加） */
export class ProjectileBehavior extends WeaponBehavior {
  private group: Phaser.Physics.Arcade.Group;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({
      classType: Projectile,
      runChildUpdate: false,
    });
    ctx.combat.registerProjectileGroup(this.group);
  }

  protected fire(nowMs: number): void {
    const count = this.effProjectiles();
    const targets = this.nearestEnemies(Math.max(count, 1));
    const baseAngle = targets.length > 0
      ? Phaser.Math.Angle.Between(this.ctx.player.x, this.ctx.player.y, targets[0].x, targets[0].y)
      : this.ctx.player.facingAngle;

    for (let i = 0; i < count; i++) {
      const target = targets[i % Math.max(targets.length, 1)];
      const angle = target
        ? Phaser.Math.Angle.Between(this.ctx.player.x, this.ctx.player.y, target.x, target.y)
        : baseAngle + (i - (count - 1) / 2) * 0.15;
      const p = this.group.get() as Projectile | null;
      if (!p) break;
      p.fire(
        this.ctx.player.x, this.ctx.player.y, angle,
        PROJECTILE_SPEED, this.effDamage(), this.effPierce(),
        this.def.projectileTex ?? `tex_${this.def.id}`, LIFESPAN_MS, nowMs, this.def.id,
      );
      this.ctx.particles?.muzzle(this.ctx.player.x, this.ctx.player.y, angle);
    }
  }

  protected tick(nowMs: number): void {
    for (const child of this.group.getChildren()) {
      const p = child as Projectile;
      if (p.active && nowMs > p.dieAt) p.deactivate();
    }
  }

  destroy(): void {
    this.group.destroy(true);
  }
}
