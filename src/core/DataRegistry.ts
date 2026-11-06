import type {
  BondDef,
  BuildingTable,
  CharacterDef,
  CharmDef,
  EnemyDef,
  MetaTree,
  ModifierDef,
  PassiveDef,
  PickupDef,
  StageDef,
  WeaponDef,
} from '../types';

/** 数据注册表：统一访问 BootScene 预加载的 JSON 配置 */
export class DataRegistry {
  constructor(private cache: Phaser.Cache.CacheManager) {}

  characters(): CharacterDef[] {
    return this.cache.json.get('characters') as CharacterDef[];
  }
  character(id: string): CharacterDef {
    return this.mustFind(this.characters(), id);
  }

  weapons(): WeaponDef[] {
    return this.cache.json.get('weapons') as WeaponDef[];
  }
  weapon(id: string): WeaponDef {
    return this.mustFind(this.weapons(), id);
  }

  passives(): PassiveDef[] {
    return this.cache.json.get('passives') as PassiveDef[];
  }
  passive(id: string): PassiveDef {
    return this.mustFind(this.passives(), id);
  }

  enemies(): EnemyDef[] {
    return this.cache.json.get('enemies') as EnemyDef[];
  }
  enemy(id: string): EnemyDef {
    return this.mustFind(this.enemies(), id);
  }

  stages(): StageDef[] {
    return this.cache.json.get('stages') as StageDef[];
  }
  stage(id: string): StageDef {
    return this.mustFind(this.stages(), id);
  }

  charms(): CharmDef[] {
    return this.cache.json.get('charms') as CharmDef[];
  }
  charm(id: string): CharmDef {
    return this.mustFind(this.charms(), id);
  }

  bonds(): BondDef[] {
    return this.cache.json.get('bonds') as BondDef[];
  }
  bond(id: string): BondDef {
    return this.mustFind(this.bonds(), id);
  }

  /** 局外成长树：key=角色id */
  metaTrees(): Record<string, MetaTree> {
    return this.cache.json.get('metaUpgrades') as Record<string, MetaTree>;
  }
  metaTree(charId: string): MetaTree {
    return this.metaTrees()[charId] ?? { nodes: [] };
  }

  pickups(): PickupDef[] {
    return this.cache.json.get('pickups') as PickupDef[];
  }

  /** 建筑表：key=地图主题（forest/castle） */
  buildings(theme: string): BuildingTable | undefined {
    return (this.cache.json.get('buildings') as Record<string, BuildingTable>)[theme];
  }
  pickup(id: string): PickupDef {
    return this.mustFind(this.pickups(), id);
  }

  modifiers(): ModifierDef[] {
    return this.cache.json.get('modifiers') as ModifierDef[];
  }
  modifier(id: string): ModifierDef {
    return this.mustFind(this.modifiers(), id);
  }

  private mustFind<T extends { id: string }>(list: T[], id: string): T {
    const found = list.find((it) => it.id === id);
    if (!found) throw new Error(`[DataRegistry] 未找到数据 id=${id}`);
    return found;
  }
}

let registry: DataRegistry;

export function initRegistry(cache: Phaser.Cache.CacheManager): void {
  registry = new DataRegistry(cache);
}

/** 全局数据访问入口（BootScene create 之后可用） */
export function db(): DataRegistry {
  return registry;
}
