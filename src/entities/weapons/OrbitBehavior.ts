import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { DamageZone } from '../DamageZone';

const BASE_RADIUS = 90;
const HIT_INTERVAL_MS = 350;
const ROT_SPEED = 2.6; // rad/s

/** 环绕类武器：若干球体绕玩家旋转，持续接触伤害 */
export class OrbitBehavior extends WeaponBehavior {
  private group: Phaser.Physics.Arcade.Group;
  private angle = 0;
  private lastTickAt = 0;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({
      classType: DamageZone,
      runChildUpdate: false,
    });
    ctx.combat.registerZoneGroup(this.group, HIT_INTERVAL_MS);
  }

  protected fire(nowMs: number): void {
    // 每个冷却周期重建/补齐环绕体数量（数量随等级变化）
    const want = this.effProjectiles();
    let have = this.group.countActive(true);
    while (have < want) {
      const z = this.group.get() as DamageZone | null;
      if (!z) break;
      z.activate(this.ctx.player.x, this.ctx.player.y, this.def.projectileTex ?? `tex_${this.def.id}`, `orbit_${this.def.id}`, this.effDamage(), this.def.id);
      z.setScale(1.6);
      have += 1;
    }
    this.refreshDamage();
    this.lastTickAt = nowMs;
  }

  protected tick(nowMs: number): void {
    const dt = this.lastTickAt > 0 ? Math.min((nowMs - this.lastTickAt) / 1000, 0.1) : 0.016;
    this.lastTickAt = nowMs;
    this.angle += ROT_SPEED * dt;

    const radius = BASE_RADIUS * this.effArea();
    const zones = this.group.getChildren() as DamageZone[];
    const actives = zones.filter((z) => z.active);
    actives.forEach((z, i) => {
      const a = this.angle + (i * Math.PI * 2) / actives.length;
      const x = this.ctx.player.x + Math.cos(a) * radius;
      const y = this.ctx.player.y + Math.sin(a) * radius;
      z.setPosition(x, y);
      (z.body as Phaser.Physics.Arcade.Body).reset(x, y);
    });
  }

  private refreshDamage(): void {
    for (const child of this.group.getChildren()) {
      const z = child as DamageZone;
      if (z.active) z.damage = this.effDamage();
    }
  }

  destroy(): void {
    this.group.destroy(true);
  }
}
