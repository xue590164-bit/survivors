import Phaser from 'phaser';
import { db } from '../core/DataRegistry';
import { eventBus, GameEvents } from '../core/EventBus';
import { achievements } from './AchievementSystem';
import type { Player } from '../entities/Player';
import type { WeaponManager } from './WeaponManager';
import type { PassiveManager } from './PassiveManager';
import type { CharmSystem } from './CharmSystem';
import type { BondSystem } from './BondSystem';
import { MAX_CHARMS } from '../config';

export interface LevelUpOption {
  kind: 'weapon_new' | 'weapon_upgrade' | 'weapon_evolve' | 'weapon_god' | 'passive_new' | 'passive_upgrade' | 'charm_new' | 'heal';
  id: string;
  label: string;
  desc: string;
  /** 三选一图标纹理 key（tex_xxx） */
  icon?: string;
  /** 选了它能凑齐的羁绊名（卡片金色提示） */
  bondHint?: string;
  /** 神兵合成将消耗的胚子武器 id 列表 */
  godConsume?: string[];
}

/** 升级三选一：选项抽取与应用。可进化武器保底占用一个选项位。 */
export class LevelUpSystem {
  constructor(
    private player: Player,
    private weapons: WeaponManager,
    private passives: PassiveManager,
    private charms: CharmSystem,
    private bonds: BondSystem,
  ) {}

  rollOptions(count = 3): LevelUpOption[] {
    // 进化选项优先保底
    const hint = (id: string): string | undefined => {
      const bs = this.bonds.wouldComplete(id);
      return bs.length ? `✦ 凑齐羁绊「${bs.map((b) => b.name).join('」「')}」` : undefined;
    };
    // 神兵合成选项最优先（苛刻条件齐备时才出现）
    const gods: LevelUpOption[] = this.weapons.fusionCandidates(this.player.relicShards).map((c) => ({
      kind: 'weapon_god' as const,
      id: c.god.id,
      label: `神兵！${c.god.name}`,
      desc: `${c.god.description}（献祭：${c.consume.map((id) => db().weapon(id).name).join(' + ')} + 残片×1）`,
      icon: `tex_${c.god.id}`,
      godConsume: c.consume,
    }));
    const evolves: LevelUpOption[] = this.weapons.evolvable(this.passives).map((d) => ({
      kind: 'weapon_evolve' as const,
      id: d.id,
      label: `进化！${d.name} → ${db().weapon(d.evolution!.into).name}`,
      desc: '额外获得进化武器，原武器保留（不占武器槽）',
      icon: `tex_${d.evolution!.into}`,
      bondHint: hint(d.evolution!.into),
    }));

    const pool: LevelUpOption[] = [];
    for (const def of this.weapons.upgradable()) {
      pool.push({
        kind: 'weapon_upgrade',
        id: def.id,
        label: `${def.name} Lv.${this.weapons.levelOf(def.id) + 1}`,
        desc: def.description,
        icon: `tex_${def.id}`,
      });
    }
    for (const def of this.weapons.available()) {
      pool.push({ kind: 'weapon_new', id: def.id, label: `新武器：${def.name}`, desc: def.description, icon: `tex_${def.id}`, bondHint: hint(def.id) });
    }
    for (const def of this.passives.upgradable()) {
      pool.push({
        kind: 'passive_upgrade',
        id: def.id,
        label: `${def.name} Lv.${this.passives.levelOf(def.id) + 1}`,
        desc: def.description,
        icon: `tex_${def.id}`,
      });
    }
    for (const def of this.passives.available()) {
      pool.push({ kind: 'passive_new', id: def.id, label: `新被动：${def.name}`, desc: def.description, icon: `tex_${def.id}`, bondHint: hint(def.id) });
    }
    // 护符：有空槽且未持有的才进池
    if (this.charms.count < MAX_CHARMS) {
      for (const def of db().charms()) {
        if (this.charms.has(def.id)) continue;
        pool.push({ kind: 'charm_new', id: def.id, label: `护符：${def.name}`, desc: def.description, icon: `tex_${def.id}` });
      }
    }

    Phaser.Utils.Array.Shuffle(pool);
    const picks = [...gods, ...evolves.slice(0, count - gods.length), ...pool.slice(0, count - gods.length - evolves.length)];
    while (picks.length < count) {
      picks.push({ kind: 'heal', id: 'heal', label: '吃点好的', desc: '恢复 30 生命', icon: 'tex_pickup_meat' });
    }
    return picks;
  }

  apply(opt: LevelUpOption): void {
    switch (opt.kind) {
      case 'weapon_new':
      case 'weapon_upgrade':
        this.weapons.addWeapon(opt.id);
        break;
      case 'weapon_evolve':
        if (this.weapons.evolve(opt.id)) this.emitEvolved();
        break;
      case 'weapon_god':
        if (opt.godConsume && this.weapons.fuse(opt.id, opt.godConsume)) {
          this.player.relicShards -= 1;
          achievements.bump('godFuse');
          this.emitEvolved();
        }
        break;
      case 'passive_new':
      case 'passive_upgrade':
        this.passives.add(opt.id);
        break;
      case 'charm_new':
        this.charms.add(opt.id);
        break;
      case 'heal':
        this.player.heal(30);
        break;
    }
  }

  /** 宝箱奖励：有进化优先进化，其次升级已有武器，否则回血 */
  grantChestReward(): string {
    const evo = this.weapons.evolvable(this.passives)[0];
    if (evo) {
      const into = this.weapons.evolve(evo.id);
      if (into) {
        this.emitEvolved();
        return `进化！${into.name}`;
      }
    }
    const ups = this.weapons.upgradable();
    if (ups.length > 0) {
      const def = Phaser.Utils.Array.GetRandom(ups);
      this.weapons.addWeapon(def.id);
      return `${def.name} Lv.${this.weapons.levelOf(def.id)}`;
    }
    this.player.heal(50);
    return '恢复 50 生命';
  }

  private emitEvolved(): void {
    eventBus.emit(GameEvents.WeaponEvolved, { x: this.player.x, y: this.player.y });
  }
}
