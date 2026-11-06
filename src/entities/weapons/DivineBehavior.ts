import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import { ProjectileBehavior } from './ProjectileBehavior';
import { OrbitBehavior } from './OrbitBehavior';
import { AuraBehavior } from './AuraBehavior';
import { BoomerangBehavior } from './BoomerangBehavior';
import { NovaBehavior } from './NovaBehavior';
import { LobBehavior } from './LobBehavior';
import { MeleeBehavior } from './MeleeBehavior';
import { SummonBehavior } from './SummonBehavior';
import { Projectile } from '../Projectile';
import type { Enemy } from '../Enemy';
import type { WeaponDef, GodPart } from '../../types';
import { telegraphCircle } from '../../systems/Telegraph';

const CTORS = {
  projectile: ProjectileBehavior,
  orbit: OrbitBehavior,
  aura: AuraBehavior,
  boomerang: BoomerangBehavior,
  nova: NovaBehavior,
  lob: LobBehavior,
  melee: MeleeBehavior,
  summon: SummonBehavior,
} as const;

const SPIRAL_SPEED = 460;

/** 把 GodPart 提升为 WeaponDef 形状，复用现有行为 */
function partToDef(part: GodPart, parentId: string, i: number): WeaponDef {
  return {
    id: `${parentId}#p${i}`,
    name: '',
    description: '',
    behavior: part.behavior,
    projectileTex: part.projectileTex,
    maxLevel: 1,
    levels: [{
      damage: part.damage,
      cooldownMs: part.cooldownMs,
      projectiles: part.projectiles,
      area: part.area,
      durationMs: part.durationMs ?? 0,
      pierce: part.pierce,
      knockback: part.knockback,
      heal: part.heal,
    }],
    color: 0,
  };
}

/**
 * 神兵复合行为：子部件（环绕/光环/nova等）+ 签名技能定时器。
 * fire() 空转——所有输出由子部件与签名技能驱动。
 */
export class DivineBehavior extends WeaponBehavior {
  private parts: WeaponBehavior[] = [];
  private group: Phaser.Physics.Arcade.Group;
  private nextSigAt = 0;
  private spiralAngle = 0;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({ classType: Projectile, runChildUpdate: false });
    ctx.combat.registerProjectileGroup(this.group);
    for (let i = 0; i < (def.godParts?.length ?? 0); i++) {
      const part = def.godParts![i];
      this.parts.push(new CTORS[part.behavior](ctx, partToDef(part, def.id, i)));
    }
  }

  protected fire(_nowMs: number): void {
    // 签名技能走 tick 定时器；此处仅维持基类节奏
  }

  protected tick(nowMs: number): void {
    for (const p of this.parts) p.update(nowMs);
    if (this.def.signature && nowMs >= this.nextSigAt) {
      this.runSignature(nowMs);
      this.nextSigAt = nowMs + (this.def.signatureMs ?? 2000);
    }
    // 签名弹道寿命回收
    for (const child of this.group.getChildren()) {
      const p = child as Projectile;
      if (p.active && nowMs > p.dieAt) p.deactivate();
    }
  }

  private runSignature(_nowMs: number): void {
    const dmg = (this.def.signatureDamage ?? 100) * (1 + this.ctx.player.stats.damagePct);
    switch (this.def.signature) {
      case 'skyfall': {
        const t = this.strongestEnemy();
        if (!t) return;
        this.skyStrike(t.x, t.y, 90, dmg, 0xffd75e);
        break;
      }
      case 'meteor': {
        const ts = this.randomEnemies(3);
        for (const t of ts) this.skyStrike(t.x, t.y, 75, dmg, 0x8ad8ff);
        break;
      }
      case 'devour': {
        // 吞噬脉冲：大范围内敌人被拖向玩家并受伤
        const px = this.ctx.player.x, py = this.ctx.player.y, R = 230 * this.effArea();
        for (const c of this.ctx.enemies.getChildren()) {
          const e = c as Enemy;
          if (!e.active) continue;
          const d = Phaser.Math.Distance.Between(e.x, e.y, px, py);
          if (d > R || d < 1) continue;
          const pull = (e.isBoss ? 12 : 46) * (1 - d / R);
          e.x += ((px - e.x) / d) * pull;
          e.y += ((py - e.y) / d) * pull;
        }
        this.ctx.particles?.shockwave(px, py, 0x8a3ac8, (R * 2) / 32);
        break;
      }
      case 'spiral': {
        // 螺旋弹幕：本 tick 连发 2 枚旋刃
        for (let i = 0; i < 2; i++) {
          this.spiralAngle += 0.52;
          this.fireBolt(this.spiralAngle, dmg, 1, 'tex_proj_godblade', 1);
        }
        break;
      }
      case 'roots': {
        // 荆棘缠绕：大范围定身 + 玩家回血
        const px = this.ctx.player.x, py = this.ctx.player.y, R = 210 * this.effArea();
        for (const c of this.ctx.enemies.getChildren()) {
          const e = c as Enemy;
          if (!e.active) continue;
          if (Phaser.Math.Distance.Between(e.x, e.y, px, py) <= R) e.applyFreeze(1200);
        }
        this.ctx.player.heal(5);
        this.ctx.particles?.shockwave(px, py, 0x58c878, (R * 2) / 32);
        break;
      }
      case 'sunlance': {
        const t = this.strongestEnemy();
        const px = this.ctx.player.x, py = this.ctx.player.y;
        const ang = t
          ? Phaser.Math.Angle.Between(px, py, t.x, t.y)
          : this.ctx.player.facingAngle;
        this.fireBolt(ang, dmg, 99, 'tex_proj_sunlance', 2.2);
        break;
      }
    }
  }

  /** 天降审判：光柱预警 → 巨剑坠地 AoE */
  private skyStrike(x: number, y: number, r: number, dmg: number, color: number): void {
    telegraphCircle(this.ctx.scene, x, y, r, 500, color, () => {
      for (const c of this.ctx.enemies.getChildren()) {
        const e = c as Enemy;
        if (!e.active) continue;
        if (Phaser.Math.Distance.Between(e.x, e.y, x, y) <= r) e.takeDamage(dmg, this.def.id);
      }
      this.ctx.particles?.shockwave(x, y, color, (r * 2) / 32);
      const p = this.group.get() as Projectile | null;
      if (p) {
        // 视觉巨剑：从天上斜插下来（仅表现，伤害已结算）
        p.fire(x - 40, y - 160, Math.PI / 2 + 0.22, 900, 0, 1, 'tex_proj_divine_sword', 260, this.ctx.scene.time.now, this.def.id);
      }
    });
  }

  private fireBolt(angle: number, dmg: number, pierce: number, tex: string, scale = 1): void {
    const p = this.group.get() as Projectile | null;
    if (!p) return;
    p.fire(this.ctx.player.x, this.ctx.player.y, angle, SPIRAL_SPEED, dmg, pierce, tex, 2200, this.ctx.scene.time.now, this.def.id);
    if (scale !== 1) p.setScale(scale);
  }

  private strongestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    for (const c of this.ctx.enemies.getChildren()) {
      const e = c as Enemy;
      if (!e.active) continue;
      if (!best || e.hp > best.hp) best = e;
    }
    return best;
  }

  private randomEnemies(n: number): Enemy[] {
    const pool = (this.ctx.enemies.getChildren() as Enemy[]).filter((e) => e.active);
    Phaser.Utils.Array.Shuffle(pool);
    return pool.slice(0, n);
  }

  destroy(): void {
    for (const p of this.parts) p.destroy();
    this.group.destroy(true);
  }
}
