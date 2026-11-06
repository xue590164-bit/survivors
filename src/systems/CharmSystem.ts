import Phaser from 'phaser';
import { db } from '../core/DataRegistry';
import { eventBus, GameEvents } from '../core/EventBus';
import type { CharmDef } from '../types';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { ParticleSystem } from './ParticleSystem';

interface HitPayload {
  enemy: Enemy;
  dmg: number;
  x: number;
  y: number;
  weaponId?: string;
}

/**
 * 护符系统：订阅武器命中/击杀/受击事件，触发联动效果。
 * 武器发数越多护符收益越大——构筑层面的 1+1>2。
 * 护符自身造成的伤害不再触发护符（weaponId=undefined），防止连锁死循环。
 */
export class CharmSystem {
  private owned = new Set<string>();
  private hitCounter = 0;
  private healReadyAt = 0;
  private stacks = 0;
  private lastHitAt = 0;

  constructor(
    private scene: Phaser.Scene,
    private player: Player,
    private enemies: Phaser.Physics.Arcade.Group,
    private particles?: ParticleSystem,
  ) {
    eventBus.on(GameEvents.EnemyDamaged, this.onHit, this);
    eventBus.on(GameEvents.EnemyKilled, this.onKill, this);
    eventBus.on(GameEvents.PlayerDamaged, this.onPlayerHurt, this);
  }

  destroy(): void {
    eventBus.off(GameEvents.EnemyDamaged, this.onHit, this);
    eventBus.off(GameEvents.EnemyKilled, this.onKill, this);
    eventBus.off(GameEvents.PlayerDamaged, this.onPlayerHurt, this);
  }

  add(id: string): void {
    this.owned.add(id);
  }

  has(id: string): boolean {
    return this.owned.has(id);
  }

  ownedIds(): string[] {
    return [...this.owned];
  }

  get count(): number {
    return this.owned.size;
  }

  private defs(trigger: CharmDef['trigger']): CharmDef[] {
    return this.ownedIds()
      .map((id) => db().charm(id))
      .filter((d) => d.trigger === trigger);
  }

  private onHit(p: HitPayload): void {
    // 只响应武器伤害：护符/DOT 伤害（无 weaponId）不触发，防无限连锁
    if (!p.weaponId || !p.enemy.active) return;
    const now = this.scene.time.now;
    this.hitCounter += 1;

    for (const d of this.defs('onHitChance')) {
      if (Math.random() < (d.chance ?? 0)) this.runEffect(d, p);
    }
    for (const d of this.defs('onHitEvery')) {
      if (this.hitCounter % (d.every ?? 8) === 0) this.runEffect(d, p, now);
    }
  }

  private onKill(p: { enemy: Enemy; x: number; y: number }): void {
    for (const d of this.defs('onKillChance')) {
      if (Math.random() < (d.chance ?? 0)) this.runEffect(d, { enemy: p.enemy, dmg: 0, x: p.x, y: p.y });
    }
  }

  private onPlayerHurt(): void {
    for (const d of this.defs('onPlayerHurt')) {
      this.runEffect(d, { enemy: null as unknown as Enemy, dmg: 0, x: this.player.x, y: this.player.y });
    }
  }

  private runEffect(d: CharmDef, p: HitPayload, now = this.scene.time.now): void {
    const e = d.effect;
    switch (e.type) {
      case 'strikeDamage': {
        if (!p.enemy?.active) return;
        p.enemy.takeDamage(e.damage);
        this.particles?.lightning(p.enemy.x, p.enemy.y);
        break;
      }
      case 'ricochet': {
        if (!p.enemy) return;
        const next = this.nearestEnemy(p.x, p.y, e.range, p.enemy);
        if (next) {
          next.takeDamage(p.dmg * e.dmgPct);
          this.particles?.lightning(next.x, next.y);
        }
        break;
      }
      case 'dot': {
        if (p.enemy?.active) p.enemy.applyDot(e.dps, e.durationMs);
        break;
      }
      case 'freeze': {
        if (p.enemy?.active) p.enemy.applyFreeze(e.durationMs);
        break;
      }
      case 'corpseExplode': {
        this.areaDamage(p.x, p.y, e.radius, e.damage);
        this.particles?.shockwave(p.x, p.y, 0xff8040, 1.2);
        break;
      }
      case 'heal': {
        if (now < this.healReadyAt) return;
        this.healReadyAt = now + e.cooldownMs;
        this.player.heal(e.amount);
        break;
      }
      case 'thorns': {
        this.areaDamage(this.player.x, this.player.y, e.radius, e.damage);
        this.particles?.shockwave(this.player.x, this.player.y, 0x8ac860, 1.0);
        break;
      }
      case 'stackDamage': {
        this.lastHitAt = this.scene.time.now;
        if (this.stacks < e.maxStacks) {
          this.stacks += 1;
          this.player.stats.damagePct += e.perStack;
        }
        break;
      }
    }
  }

  /** 嗜血刃层数断连衰减 */
  update(): void {
    const d = this.ownedIds()
      .map((id) => db().charm(id))
      .find((c) => c.effect.type === 'stackDamage');
    if (!d || d.effect.type !== 'stackDamage' || this.stacks === 0) return;
    if (this.scene.time.now - this.lastHitAt > d.effect.decayMs) {
      this.player.stats.damagePct -= d.effect.perStack * this.stacks;
      this.stacks = 0;
    }
  }

  private nearestEnemy(x: number, y: number, range: number, exclude: Enemy): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e === exclude) continue;
      const d = Phaser.Math.Distance.Between(x, y, e.x, e.y);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  private areaDamage(x: number, y: number, radius: number, dmg: number): void {
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active) continue;
      if (Phaser.Math.Distance.Between(x, y, e.x, e.y) <= radius) e.takeDamage(dmg);
    }
  }
}
