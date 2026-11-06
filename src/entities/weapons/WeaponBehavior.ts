import Phaser from 'phaser';
import type { WeaponDef, WeaponLevelDef, WeaponMod } from '../../types';
import type { Player } from '../Player';
import type { CombatSystem } from '../../systems/CombatSystem';
import type { ParticleSystem } from '../../systems/ParticleSystem';

/** 武器行为运行上下文：由 WeaponManager 注入 */
export interface WeaponContext {
  scene: Phaser.Scene;
  player: Player;
  enemies: Phaser.Physics.Arcade.Group;
  combat: CombatSystem;
  particles?: ParticleSystem;
}

/**
 * 武器行为基类。子类只需实现 fire()；
 * 冷却/伤害/范围已经过玩家属性折算。
 */
export abstract class WeaponBehavior {
  level = 1;
  protected nextFireAt = 0;

  constructor(protected ctx: WeaponContext, readonly def: WeaponDef) {}

  get lv(): WeaponLevelDef {
    return this.def.levels[Math.min(this.level, this.def.levels.length) - 1];
  }

  get maxed(): boolean {
    return this.level >= this.def.maxLevel;
  }

  upgrade(): void {
    if (!this.maxed) this.level += 1;
  }

  update(nowMs: number): void {
    if (nowMs >= this.nextFireAt) {
      this.fire(nowMs);
      this.nextFireAt = nowMs + this.effCooldown();
    }
    this.tick(nowMs);
  }

  protected abstract fire(nowMs: number): void;

  /** 进化替换时清理持有的场景对象（弹道组/环绕体/光环区等） */
  abstract destroy(): void;

  /** 每帧钩子：环绕体跟随等持续表现在这里做 */
  protected tick(_nowMs: number): void {}

  /** 局外成长对当前武器的修正（无则空表） */
  protected mod(): WeaponMod {
    return this.ctx.player.weaponMods[this.def.id] ?? {};
  }

  protected effDamage(): number {
    return this.lv.damage * (1 + this.ctx.player.stats.damagePct + (this.mod().damagePct ?? 0));
  }

  protected effCooldown(): number {
    const reduction = Math.min(0.8, this.ctx.player.stats.cooldownPct + (this.mod().cooldownPct ?? 0));
    return this.lv.cooldownMs * (1 - reduction);
  }

  protected effArea(): number {
    return this.lv.area * (1 + this.ctx.player.stats.areaPct + (this.mod().areaPct ?? 0));
  }

  /** 弹道/环绕体数量：局外成长可 +N */
  protected effProjectiles(): number {
    return this.lv.projectiles + (this.mod().projectiles ?? 0);
  }

  /** 弹道穿透数：默认 1（命中即消失），局外成长可 +N */
  protected effPierce(): number {
    return (this.lv.pierce ?? 1) + (this.mod().pierce ?? 0);
  }

  /** 找距玩家最近的 N 个敌人 */
  protected nearestEnemies(n: number): Phaser.Physics.Arcade.Sprite[] {
    const px = this.ctx.player.x;
    const py = this.ctx.player.y;
    const actives = this.ctx.enemies.getMatching('active', true) as Phaser.Physics.Arcade.Sprite[];
    actives.sort((a, b) => {
      const da = (a.x - px) ** 2 + (a.y - py) ** 2;
      const dbb = (b.x - px) ** 2 + (b.y - py) ** 2;
      return da - dbb;
    });
    return actives.slice(0, n);
  }
}
