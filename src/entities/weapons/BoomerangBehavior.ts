import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { Projectile } from '../Projectile';

const FLY_SPEED = 420;
const OUT_RANGE = 240;   // 到达此距离折返
const CATCH_DIST = 26;   // 回到玩家此距离内消失

/** 回旋类武器：掷出→到射程尽头折返→回程再命中一次（resetHits 清空命中记录） */
export class BoomerangBehavior extends WeaponBehavior {
  private group: Phaser.Physics.Arcade.Group;
  private phase = new Map<Projectile, 'out' | 'back'>();
  private lastTick = 0;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({ classType: Projectile, runChildUpdate: false });
    ctx.combat.registerProjectileGroup(this.group);
  }

  protected fire(nowMs: number): void {
    const count = this.effProjectiles();
    const targets = this.nearestEnemies(Math.max(count, 1));
    const baseAngle = targets.length > 0
      ? Phaser.Math.Angle.Between(this.ctx.player.x, this.ctx.player.y, targets[0].x, targets[0].y)
      : this.ctx.player.facingAngle;

    for (let i = 0; i < count; i++) {
      // 多发按扇形散开
      const angle = baseAngle + (i - (count - 1) / 2) * 0.4;
      const p = this.group.get() as Projectile | null;
      if (!p) break;
      p.fire(
        this.ctx.player.x, this.ctx.player.y, angle,
        FLY_SPEED, this.effDamage(), 99,
        `tex_${this.def.id}`, 4000, nowMs, this.def.id,
      );
      this.phase.set(p, 'out');
    }
  }

  protected tick(nowMs: number): void {
    const dt = this.lastTick > 0 ? Math.min((nowMs - this.lastTick) / 1000, 0.1) : 0.016;
    this.lastTick = nowMs;
    const { x: px, y: py } = this.ctx.player;
    const range = OUT_RANGE * this.effArea();

    for (const child of this.group.getChildren()) {
      const p = child as Projectile;
      if (!p.active) continue;
      if (nowMs > p.dieAt) { this.phase.delete(p); p.deactivate(); continue; }
      p.setRotation(p.rotation + 14 * dt); // 旋转飞行观感
      const dx = px - p.x;
      const dy = py - p.y;
      const dist = Math.hypot(dx, dy);
      const st = this.phase.get(p) ?? 'out';
      if (st === 'out' && dist >= range) {
        this.phase.set(p, 'back');
        p.resetHits(); // 回程允许二次命中
      }
      if (this.phase.get(p) === 'back') {
        const body = p.body as Phaser.Physics.Arcade.Body;
        body.setVelocity((dx / (dist || 1)) * FLY_SPEED * 1.15, (dy / (dist || 1)) * FLY_SPEED * 1.15);
        if (dist < CATCH_DIST) { this.phase.delete(p); p.deactivate(); }
      }
    }
  }

  destroy(): void {
    this.phase.clear();
    this.group.destroy(true);
  }
}
