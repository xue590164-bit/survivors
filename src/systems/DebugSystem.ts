import Phaser from 'phaser';
import { db } from '../core/DataRegistry';
import { saveSystem } from '../core/SaveSystem';
import { Depths, GAME_WIDTH } from '../config';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import type { WeaponManager } from './WeaponManager';
import type { PassiveManager } from './PassiveManager';
import { txt } from '../ui/text';
import type { PickupSystem } from './PickupSystem';
import type { SpawnDirector } from './SpawnDirector';
import type { CharmSystem } from './CharmSystem';

/** 访问 localhost:5173/?debug=1 激活全部调试功能 */
export const DEV_MODE = new URLSearchParams(window.location.search).get('debug') === '1';

interface DevCtx {
  player: Player;
  weapons: WeaponManager;
  passives: PassiveManager;
  charms: CharmSystem;
  pickups: PickupSystem;
  director: SpawnDirector;
  enemies: Phaser.Physics.Arcade.Group;
  skipTime: (sec: number) => void;
  getRunSec: () => number;
  /** dev.scene 暴露用：世界场景（本系统宿主在 HudScene） */
  gameScene?: Phaser.Scene;
}

/**
 * 开发者模式：F1 状态面板 + 快捷键作弊 + window.dev 控制台句柄。
 * 快捷键：L升级 K清屏 T快进30s C宝箱 B召Boss G磁吸 P无敌 V进化预备 H回血
 */
export class DebugSystem {
  private overlay: Phaser.GameObjects.Text;
  private overlayOn = false;
  private acc = 0;

  constructor(private scene: Phaser.Scene, private ctx: DevCtx) {
    this.overlay = txt(scene, GAME_WIDTH - 10, 40, '', { fontSize: '12px', color: '#8affa0', align: 'right', lineSpacing: 3 })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(Depths.Overlay)
      .setVisible(false);
    scene.input.keyboard?.on('keydown', this.onKey, this);
    this.exposeConsole();
  }

  destroy(): void {
    this.scene.input.keyboard?.off('keydown', this.onKey, this);
  }

  private onKey(ev: KeyboardEvent): void {
    const c = this.ctx;
    switch (ev.code) {
      case 'F1':
        this.overlayOn = !this.overlayOn;
        this.overlay.setVisible(this.overlayOn);
        break;
      case 'KeyL':
        c.player.gainXp(c.player.xpToNext - c.player.xp + 1);
        break;
      case 'KeyK':
        this.killAll();
        break;
      case 'KeyT':
        c.skipTime(30);
        break;
      case 'KeyC':
        c.pickups.spawn('pickup_chest', c.player.x + 60, c.player.y);
        break;
      case 'KeyB':
        c.director.spawnAt(this.pickMiniboss(), 1, true);
        break;
      case 'KeyG':
        c.pickups.magnetAll();
        break;
      case 'KeyP':
        c.player.god = !c.player.god;
        break;
      case 'KeyV':
        this.grantEvolution();
        break;
      case 'KeyH':
        c.player.heal(99999);
        break;
    }
  }

  /** 按当前关卡选 Boss：后期给终Boss，否则取最近的小Boss事件 */
  private pickMiniboss(): string {
    const stage = this.ctx.director.stage;
    const t = this.ctx.getRunSec();
    if (stage.finalBoss && t >= stage.durationSec * 0.8) return stage.finalBoss.enemyId;
    const minibosses = stage.events.filter((e) => e.type === 'miniboss' && e.params?.enemyId);
    const past = minibosses.filter((e) => e.timeSec <= t);
    const pick = past.length ? past[past.length - 1] : minibosses[0];
    return pick ? String(pick.params!.enemyId) : (stage.finalBoss?.enemyId ?? 'boss_slime_king');
  }

  private killAll(): void {
    for (const child of this.ctx.enemies.getChildren()) {
      const e = child as Enemy;
      if (e.active) e.takeDamage(1e6);
    }
  }

  /** 一键进化预备：首把可进化武器拉满 + 发对应被动 + 送个宝箱 */
  private grantEvolution(): void {
    const c = this.ctx;
    const target = c.weapons.upgradable().find((d) => d.evolution)
      ?? db().weapons().find((w) => w.evolution && !w.evolved && !c.weapons.ownedIds().includes(w.id));
    if (!target) return;
    while (c.weapons.levelOf(target.id) < target.maxLevel) {
      c.weapons.addWeapon(target.id);
    }
    if (target.evolution) c.passives.add(target.evolution.requiresPassive);
    c.pickups.spawn('pickup_chest', c.player.x + 60, c.player.y);
  }

  update(deltaMs: number): void {
    if (!this.overlayOn) return;
    this.acc += deltaMs;
    if (this.acc < 300) return;
    this.acc = 0;
    const c = this.ctx;
    const s = c.player.stats;
    this.overlay.setText([
      `FPS ${Math.round(this.scene.game.loop.actualFps)}  敌 ${c.enemies.countActive(true)}`,
      `时间 ${Math.floor(c.getRunSec())}s  Lv.${c.player.level}  HP ${Math.ceil(c.player.hp)}/${s.maxHp}`,
      `伤${(s.damagePct * 100).toFixed(0)}% 速${s.speed} 甲${s.armor} 冷${(s.cooldownPct * 100).toFixed(0)}% 磁${s.magnetRadius}`,
      `武器 ${c.weapons.ownedIds().map((id) => `${id.replace('weapon_', '')}:${c.weapons.levelOf(id)}`).join(' ')}`,
      `被动 ${c.passives.ownedIds().map((id) => `${id.replace('passive_', '')}:${c.passives.levelOf(id)}`).join(' ')}`,
      `GOD ${c.player.god ? 'ON' : 'off'}  |  F1面板 L升级 K清屏 T快进 C宝箱 B召Boss G磁吸 P无敌 V进化 H回血`,
    ].join('\n'));
  }

  private exposeConsole(): void {
    const c = this.ctx;
    (window as unknown as { dev: unknown }).dev = {
      giveWeapon: (id: string) => c.weapons.addWeapon(id),
      givePassive: (id: string) => c.passives.add(id),
      giveCharm: (id: string) => c.charms.add(id),
      levelUp: (n = 1) => {
        for (let i = 0; i < n; i++) c.player.gainXp(c.player.xpToNext - c.player.xp + 1);
      },
      spawnBoss: (id?: string) =>
        c.director.spawnAt(id ?? c.director.stage.finalBoss?.enemyId ?? 'boss_slime_king', 1, true),
      spawnEnemy: (id: string, n = 1) => {
        for (let i = 0; i < n; i++) c.director.spawnAt(id, 1, true);
      },
      killAll: () => this.killAll(),
      gold: (n: number) => saveSystem.addGold(n),
      god: () => (c.player.god = !c.player.god),
      skipTime: (s: number) => c.skipTime(s),
      player: c.player,
      scene: c.gameScene ?? this.scene,
      db: db(),
    };
  }
}
