import Phaser from 'phaser';
import { db } from '../core/DataRegistry';
import { eventBus, GameEvents, type EnemyKilledPayload } from '../core/EventBus';
import { Pickup } from '../entities/Pickup';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { MAX_GEMS } from '../config';

const MAGNET_SPEED = 620;
const HEAL_DROP_CHANCE = 0.012;
const MAGNET_DROP_CHANCE = 0.004;

/** 掉落物系统：击杀掉落生成、磁吸移动、拾取结算 */
export class PickupSystem {
  /** 难度词条：禁止治疗掉落 */
  noHealDrop = false;

  constructor(
    _scene: Phaser.Scene,
    private player: Player,
    private group: Phaser.Physics.Arcade.Group,
    private enemies: Phaser.Physics.Arcade.Group,
    private onChest: () => void,
  ) {
    eventBus.on(GameEvents.EnemyKilled, this.onEnemyKilled, this);
    eventBus.on(GameEvents.PickupCollected, this.onCollected, this);
  }

  destroy(): void {
    eventBus.off(GameEvents.EnemyKilled, this.onEnemyKilled, this);
    eventBus.off(GameEvents.PickupCollected, this.onCollected, this);
  }

  private onEnemyKilled(p: EnemyKilledPayload): void {
    if (p.xpValue > 0) this.spawnXp(p.x, p.y, p.xpValue);
    if (p.isBoss) {
      // Boss：双宝箱 + 大额宝石 + 神兵残片
      this.spawn('pickup_chest', p.x - 14, p.y);
      this.spawn('pickup_chest', p.x + 14, p.y + 8);
      this.spawn('pickup_xp_big', p.x, p.y + 14);
      this.spawn('pickup_relic_shard', p.x, p.y - 14);
      return;
    }
    if (p.isElite) {
      this.spawn('pickup_chest', p.x, p.y);
      if (Math.random() < 0.2) this.spawn('pickup_relic_shard', p.x + 12, p.y + 10);
      return;
    }
    const roll = Math.random();
    if (roll < MAGNET_DROP_CHANCE || this.noHealDrop) {
      this.spawn('pickup_magnet', p.x, p.y);
    } else if (roll < MAGNET_DROP_CHANCE + HEAL_DROP_CHANCE) {
      this.spawn('pickup_meat', p.x, p.y);
    }
  }

  spawnXp(x: number, y: number, value: number): void {
    const gems = this.group.getMatching('active', true) as Pickup[];
    if (gems.length >= MAX_GEMS) {
      // 超出上限：合并进第一颗活跃宝石，防止满屏对象
      gems[0].addValue(value);
      return;
    }
    this.spawn(value >= 10 ? 'pickup_xp_big' : 'pickup_xp_small', x, y, value);
  }

  spawn(defId: string, x: number, y: number, valueOverride?: number): void {
    const def = db().pickup(defId);
    const pk = this.group.get(0, 0, `tex_${def.id}`) as Pickup | null;
    if (!pk) return;
    pk.spawn(def, x, y);
    if (valueOverride !== undefined) pk.value = valueOverride;
  }

  update(): void {
    const px = this.player.x;
    const py = this.player.y;
    const magnetR = this.player.stats.magnetRadius;
    for (const child of this.group.getChildren()) {
      const pk = child as Pickup;
      if (!pk.active) continue;
      const d = Phaser.Math.Distance.Between(pk.x, pk.y, px, py);
      if (d < magnetR) pk.magnetized = true;
      if (pk.magnetized) {
        const ang = Phaser.Math.Angle.Between(pk.x, pk.y, px, py);
        (pk.body as Phaser.Physics.Arcade.Body).setVelocity(
          Math.cos(ang) * MAGNET_SPEED,
          Math.sin(ang) * MAGNET_SPEED,
        );
      }
    }
  }

  /** 全图宝石磁吸（磁铁拾取/调试用） */
  magnetAll(): void {
    for (const child of this.group.getChildren()) {
      const g = child as Pickup;
      if (g.active && g.def.type === 'xp') g.magnetized = true;
    }
  }

  private onCollected(p: { pickup: Pickup }): void {
    const pk = p.pickup;
    switch (pk.def.type) {
      case 'xp':
        this.player.gainXp(pk.value);
        break;
      case 'heal':
        this.player.heal(pk.value);
        break;
      case 'magnet':
        this.magnetAll();
        break;
      case 'bomb':
        for (const child of this.enemies.getChildren()) {
          const e = child as Enemy;
          if (e.active) e.takeDamage(pk.value || 200);
        }
        break;
      case 'chest':
        this.onChest();
        break;
      case 'relic':
        this.player.relicShards += 1;
        break;
    }
    pk.collect();
  }
}
