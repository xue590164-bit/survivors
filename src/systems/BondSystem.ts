import Phaser from 'phaser';
import { db } from '../core/DataRegistry';
import { eventBus, GameEvents } from '../core/EventBus';
import type { BondDef } from '../types';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { WeaponManager } from './WeaponManager';
import type { PassiveManager } from './PassiveManager';
import type { ParticleSystem } from './ParticleSystem';

interface HitPayload {
  enemy: Enemy;
  dmg: number;
  x: number;
  y: number;
  weaponId?: string;
}

/**
 * 羁绊系统：武器+被动同持即永久激活，效果挂武器命中事件。
 * 击杀判定走 EnemyDamaged（此时 hp<=0 即致命一击，且带 weaponId 可锁定武器）。
 * 羁绊伤害不传 weaponId，不会自触发，防连锁。
 */
export class BondSystem {
  private active = new Set<string>();
  private hitCounters = new Map<string, number>();

  constructor(
    _scene: Phaser.Scene,
    private player: Player,
    private enemies: Phaser.Physics.Arcade.Group,
    private weapons: WeaponManager,
    private passives: PassiveManager,
    private particles?: ParticleSystem,
  ) {
    eventBus.on(GameEvents.EnemyDamaged, this.onHit, this);
  }

  destroy(): void {
    eventBus.off(GameEvents.EnemyDamaged, this.onHit, this);
  }

  /** 每次构筑变化后调用（升级/进化/debug指令），新激活的羁绊广播事件 */
  recheck(): void {
    const owned = new Set(this.weapons.ownedIds());
    for (const b of db().bonds()) {
      if (this.active.has(b.id)) continue;
      if (b.weaponIds.some((id) => owned.has(id)) && this.passives.has(b.passiveId)) {
        this.active.add(b.id);
        eventBus.emit(GameEvents.BondActivated, { bond: b });
      }
    }
  }

  /** 若获得 optId（武器/被动）能凑齐哪些未激活羁绊——升级卡提示用 */
  wouldComplete(optId: string): BondDef[] {
    const owned = new Set(this.weapons.ownedIds());
    const pass = new Set(this.passives.ownedIds());
    return db().bonds().filter(
      (b) =>
        !this.active.has(b.id) &&
        b.weaponIds.some((id) => owned.has(id) || id === optId) &&
        (pass.has(b.passiveId) || b.passiveId === optId),
    );
  }

  has(id: string): boolean {
    return this.active.has(id);
  }

  activeIds(): string[] {
    return [...this.active];
  }

  get count(): number {
    return this.active.size;
  }

  private onHit(p: HitPayload): void {
    if (!p.weaponId || !p.enemy?.active) return;
    for (const id of this.active) {
      const b = db().bond(id);
      if (!b.weaponIds.includes(p.weaponId)) continue;
      const t = b.trigger;
      let fire = false;
      switch (t.type) {
        case 'onHitChance':
          fire = Math.random() < (t.chance ?? 0);
          break;
        case 'onHitEvery': {
          const c = (this.hitCounters.get(b.id) ?? 0) + 1;
          this.hitCounters.set(b.id, c);
          fire = c % (t.every ?? 6) === 0;
          break;
        }
        case 'onKillChance':
          // hp<=0 时本次命中即击杀
          fire = p.enemy.hp <= 0 && Math.random() < (t.chance ?? 0);
          break;
        case 'onHitExecute':
          fire = p.enemy.hp > 0 && p.enemy.hp / p.enemy.maxHp <= (t.belowPct ?? 0.25);
          break;
        case 'onHitFar':
          fire = Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y) >= (t.minDist ?? 240);
          break;
      }
      if (fire) this.runEffect(b, p);
    }
  }

  private runEffect(b: BondDef, p: HitPayload): void {
    const e = b.effect;
    switch (e.type) {
      case 'ricochet': {
        const seen = new Set<Enemy>([p.enemy]);
        for (let i = 0; i < (e.count ?? 1); i++) {
          const next = this.nearestEnemy(p.x, p.y, e.range ?? 180, seen);
          if (!next) break;
          next.takeDamage(p.dmg * (e.dmgPct ?? 0.5));
          this.particles?.lightning(next.x, next.y);
          seen.add(next);
        }
        break;
      }
      case 'corpseExplode':
        this.areaDamage(p.x, p.y, e.radius ?? 60, p.dmg * (e.dmgPct ?? 1));
        this.particles?.shockwave(p.x, p.y, 0x9a50d0, 1.0);
        break;
      case 'heal':
        this.player.heal(e.amount ?? 2);
        break;
      case 'freeze':
        p.enemy.applyFreeze(e.durationMs ?? 400);
        break;
      case 'strikeDamage':
        if (p.enemy.active) {
          p.enemy.takeDamage(p.dmg * (e.dmgPct ?? 1));
          this.particles?.lightning(p.enemy.x, p.enemy.y);
        }
        break;
      case 'strikeRandom': {
        const t = this.nearestEnemy(this.player.x, this.player.y, e.range ?? 300, new Set());
        if (t) {
          t.takeDamage(p.dmg * (e.dmgPct ?? 1));
          this.particles?.lightning(t.x, t.y);
        }
        break;
      }
      case 'bonusDamage':
        if (p.enemy.active) p.enemy.takeDamage(p.dmg * (e.dmgPct ?? 0.5));
        break;
    }
  }

  private nearestEnemy(x: number, y: number, range: number, exclude: Set<Enemy>): Enemy | null {
    let best: Enemy | null = null;
    let bestD = range;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || exclude.has(e)) continue;
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
