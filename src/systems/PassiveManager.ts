import { db } from '../core/DataRegistry';
import { MAX_PASSIVES } from '../config';
import type { PassiveDef, Stats } from '../types';
import type { Player } from '../entities/Player';

/** 被动装备管理器：持有/升级被动，向玩家应用属性加成 */
export class PassiveManager {
  private levels = new Map<string, number>();

  constructor(private player: Player) {}

  add(id: string): void {
    const def = db().passive(id);
    const lv = this.levels.get(id) ?? 0;
    if (lv >= def.maxLevel) return;
    if (lv === 0 && this.levels.size >= MAX_PASSIVES) return;
    this.levels.set(id, lv + 1);
    this.player.applyStatPatch({ [def.stat]: def.bonusPerLevel } as Partial<Stats>);
  }

  has(id: string): boolean {
    return this.levels.has(id);
  }

  levelOf(id: string): number {
    return this.levels.get(id) ?? 0;
  }

  get count(): number {
    return this.levels.size;
  }

  ownedIds(): string[] {
    return [...this.levels.keys()];
  }

  /** 已持有且未满级 */
  upgradable(): PassiveDef[] {
    return [...this.levels.entries()]
      .filter(([id, lv]) => lv < db().passive(id).maxLevel)
      .map(([id]) => db().passive(id));
  }

  /** 未持有（有槽位时才有意义） */
  available(): PassiveDef[] {
    if (this.levels.size >= MAX_PASSIVES) return [];
    return db().passives().filter((p) => !this.levels.has(p.id));
  }
}
