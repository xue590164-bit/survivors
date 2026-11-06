import Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';
import type { Pickup } from '../entities/Pickup';

export const GameEvents = {
  EnemyKilled: 'enemy-killed',
  EnemyDamaged: 'enemy-damaged',
  PlayerDamaged: 'player-damaged',
  PlayerDied: 'player-died',
  XpChanged: 'xp-changed',
  LevelUp: 'level-up',
  PickupCollected: 'pickup-collected',
  GoldChanged: 'gold-changed',
  WeaponEvolved: 'weapon-evolved',
  BondActivated: 'bond-activated',
  BossSpawned: 'boss-spawned',
  BossPhase: 'boss-phase',
  EnemyShot: 'enemy-shot',
  Sandstorm: 'sandstorm',
  Blizzard: 'blizzard',
  QuestCompass: 'quest-compass',
  QuestToast: 'quest-toast',
} as const;

/** 指北针：活动任务目标位置 + 玩家位置（HUD 画箭头） */
export interface QuestCompassPayload {
  x: number;
  y: number;
  px: number;
  py: number;
  label: string;
}

/** 任务横幅提示 */
export interface QuestToastPayload {
  text: string;
  color?: string;
}

/** 暴雪（冰原沙暴变体）：HUD 暗角持续 durationSec（0=常驻到解除） */
export interface BlizzardPayload {
  durationSec: number;
}

/** 敌方弹道发射（ranged 敌人/Boss 技能共用）：由战斗系统落池 */
export interface EnemyShotPayload {
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  damage: number;
  tex?: string;
}

export interface EnemyKilledPayload {
  enemy: Enemy;
  x: number;
  y: number;
  xpValue: number;
  isElite: boolean;
  isBoss: boolean;
}

export interface PickupCollectedPayload {
  pickup: Pickup;
}

/** 全局事件总线：各系统间解耦通信。场景关闭时务必 off 掉自己的监听。 */
class EventBus extends Phaser.Events.EventEmitter {
  emitEnemyKilled(payload: EnemyKilledPayload): void {
    this.emit(GameEvents.EnemyKilled, payload);
  }
}

export const eventBus = new EventBus();
