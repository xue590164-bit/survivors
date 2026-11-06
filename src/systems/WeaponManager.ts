import Phaser from 'phaser';
import type { WeaponDef } from '../types';
import { db } from '../core/DataRegistry';
import { MAX_WEAPONS } from '../config';
import type { Player } from '../entities/Player';
import type { CombatSystem } from './CombatSystem';
import { WeaponBehavior, type WeaponContext } from '../entities/weapons/WeaponBehavior';
import { ProjectileBehavior } from '../entities/weapons/ProjectileBehavior';
import { OrbitBehavior } from '../entities/weapons/OrbitBehavior';
import { AuraBehavior } from '../entities/weapons/AuraBehavior';
import { BoomerangBehavior } from '../entities/weapons/BoomerangBehavior';
import { NovaBehavior } from '../entities/weapons/NovaBehavior';
import { SummonBehavior } from '../entities/weapons/SummonBehavior';
import { LobBehavior } from '../entities/weapons/LobBehavior';
import { MeleeBehavior } from '../entities/weapons/MeleeBehavior';
import { DivineBehavior } from '../entities/weapons/DivineBehavior';
import type { PassiveManager } from './PassiveManager';
import type { ParticleSystem } from './ParticleSystem';

type BehaviorCtor = new (ctx: WeaponContext, def: WeaponDef) => WeaponBehavior;

const BEHAVIORS: Record<WeaponDef['behavior'], BehaviorCtor> = {
  projectile: ProjectileBehavior,
  orbit: OrbitBehavior,
  aura: AuraBehavior,
  boomerang: BoomerangBehavior,
  nova: NovaBehavior,
  summon: SummonBehavior,
  lob: LobBehavior,
  melee: MeleeBehavior,
  divine: DivineBehavior,
};

/** 武器管理器：持有/升级武器，调度各武器行为的 update */
export class WeaponManager {
  private behaviors = new Map<string, WeaponBehavior>();
  private ctx: WeaponContext;

  constructor(
    scene: Phaser.Scene,
    player: Player,
    enemies: Phaser.Physics.Arcade.Group,
    combat: CombatSystem,
    particles?: ParticleSystem,
  ) {
    this.ctx = { scene, player, enemies, combat, particles };
  }

  addWeapon(id: string): void {
    const existing = this.behaviors.get(id);
    if (existing) {
      existing.upgrade();
      return;
    }
    if (this.slotCount >= MAX_WEAPONS) return;
    const def = db().weapon(id);
    this.behaviors.set(id, new BEHAVIORS[def.behavior](this.ctx, def));
  }

  ownedIds(): string[] {
    return [...this.behaviors.keys()];
  }

  levelOf(id: string): number {
    return this.behaviors.get(id)?.level ?? 0;
  }

  get count(): number {
    return this.behaviors.size;
  }

  /** 普通武器占用的槽位数（进化武器是额外武器，不占槽） */
  get slotCount(): number {
    let n = 0;
    for (const b of this.behaviors.values()) if (!b.def.evolved && !b.def.god) n += 1;
    return n;
  }

  /** 已持有且未满级的武器定义 */
  upgradable(): WeaponDef[] {
    return [...this.behaviors.values()]
      .filter((b) => !b.maxed)
      .map((b) => b.def);
  }

  /** 未持有的武器定义（有槽位时才有意义；进化产物不进普通池） */
  available(): WeaponDef[] {
    if (this.slotCount >= MAX_WEAPONS) return [];
    const owned = new Set(this.behaviors.keys());
    return db().weapons().filter((w) => !owned.has(w.id) && !w.evolved && !w.god);
  }

  /** 满足进化条件的基础武器（满级 + 持有对应被动 + 产物未持有） */
  evolvable(passives: PassiveManager): WeaponDef[] {
    const out: WeaponDef[] = [];
    for (const b of this.behaviors.values()) {
      const evo = b.def.evolution;
      if (evo && b.maxed && !this.behaviors.has(evo.into) && passives.has(evo.requiresPassive)) {
        out.push(b.def);
      }
    }
    return out;
  }

  /** 进化：保留原武器，额外追加进化产物（不占普通槽位）。返回产物定义。 */
  evolve(baseId: string): WeaponDef | null {
    const b = this.behaviors.get(baseId);
    const evo = b?.def.evolution;
    if (!b || !evo || this.behaviors.has(evo.into)) return null;
    const into = db().weapon(evo.into);
    this.behaviors.set(into.id, new BEHAVIORS[into.behavior](this.ctx, into));
    return into;
  }

  update(nowMs: number): void {
    for (const b of this.behaviors.values()) b.update(nowMs);
  }

  /** 移除一把武器（神兵合成消耗用），销毁其行为持有的场景对象 */
  removeWeapon(id: string): void {
    const b = this.behaviors.get(id);
    if (!b) return;
    b.destroy();
    this.behaviors.delete(id);
  }

  /**
   * 可合成的神兵：持有 ≥1 枚残片，且背包内有满足配方两派系的进化武器。
   * 返回每个可合成神兵及其将消耗的胚子武器。
   */
  fusionCandidates(relicShards: number): { god: WeaponDef; consume: string[] }[] {
    if (relicShards < 1) return [];
    const evolvedBySchool = new Map<string, string[]>();
    for (const b of this.behaviors.values()) {
      if (b.def.evolved && b.def.school) {
        const list = evolvedBySchool.get(b.def.school) ?? [];
        list.push(b.def.id);
        evolvedBySchool.set(b.def.school, list);
      }
    }
    const out: { god: WeaponDef; consume: string[] }[] = [];
    for (const g of db().weapons()) {
      if (!g.god || this.behaviors.has(g.id) || !g.fuseSchools) continue;
      const [sa, sb] = g.fuseSchools;
      const a = evolvedBySchool.get(sa)?.[0];
      // 同派系配方需要该派系两把不同的进化武器
      const b = sa === sb ? evolvedBySchool.get(sa)?.[1] : evolvedBySchool.get(sb)?.[0];
      if (a && b) out.push({ god: g, consume: [a, b] });
    }
    return out;
  }

  /** 神兵合成：消耗两把胚子进化武器 + 1 残片，获得神兵。返回神兵定义。 */
  fuse(godId: string, consume: string[]): WeaponDef | null {
    const god = db().weapon(godId);
    if (!god.god || this.behaviors.has(godId)) return null;
    for (const id of consume) this.removeWeapon(id);
    this.behaviors.set(godId, new DivineBehavior(this.ctx, god));
    return god;
  }
}
