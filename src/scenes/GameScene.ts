import Phaser from 'phaser';
import { SceneKeys, Depths } from '../config';
import { db } from '../core/DataRegistry';
import { saveSystem } from '../core/SaveSystem';
import { eventBus, GameEvents, type EnemyKilledPayload } from '../core/EventBus';
import { metaBonusStats, metaWeaponMods } from '../systems/MetaSystem';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { txt } from '../ui/text';
import { makeButton } from '../ui/button';
import { Pickup } from '../entities/Pickup';
import { MapSystem } from '../systems/MapSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { WeaponManager } from '../systems/WeaponManager';
import { PassiveManager } from '../systems/PassiveManager';
import { SpawnDirector } from '../systems/SpawnDirector';
import { PickupSystem } from '../systems/PickupSystem';
import { LevelUpSystem, type LevelUpOption } from '../systems/LevelUpSystem';
import { ParticleSystem } from '../systems/ParticleSystem';
import { CharmSystem } from '../systems/CharmSystem';
import { BondSystem } from '../systems/BondSystem';
import { BossSkillSystem } from '../systems/BossSkillSystem';
import { QuestSystem } from '../systems/QuestSystem';
import { Ally } from '../entities/Ally';
import { Projectile } from '../entities/Projectile';
import type { HudScene } from './HudScene';
import type { RunResult, StageDef } from '../types';

export interface GameSceneData {
  characterId?: string;
  stageId?: string;
  /** 难度词条 id 列表 */
  modifiers?: string[];
  /** 每日挑战局标记 */
  daily?: boolean;
}

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private stageDef!: StageDef;
  private characterId = 'char_knight';
  private stageId = 'stage_forest';

  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private pickupGroup!: Phaser.Physics.Arcade.Group;

  private mapSystem!: MapSystem;
  private combat!: CombatSystem;
  private weapons!: WeaponManager;
  private passives!: PassiveManager;
  private charms!: CharmSystem;
  private bonds!: BondSystem;
  private director!: SpawnDirector;
  private quests!: QuestSystem;
  private ally?: Ally;
  private allyShots!: Phaser.Physics.Arcade.Group;
  private pickups!: PickupSystem;
  private levelUps!: LevelUpSystem;
  private particles!: ParticleSystem;
  private bossSkills!: BossSkillSystem;
  private bosses: Enemy[] = [];
  private finalSpawned = false;
  /** 无尽模式：通关后继续，刷怪不停 + 周期性Boss讨伐 */
  private endless = false;
  private endlessDepth = 0;
  private nextEndlessBossAt = 0;
  private endlessChoice?: Phaser.GameObjects.Container;
  /** 难度词条 */
  private modIds: string[] = [];
  private goldBonusPct = 0;
  private daily = false;
  /** Boss Rush */
  private rushIdx = 0;
  private rushCycle = 0;
  private nextRushAt = 25;
  /** 虚拟摇杆 */
  private joy?: { base: Phaser.GameObjects.Graphics; nub: Phaser.GameObjects.Graphics; pointerId: number; cx: number; cy: number };

  private runTimeMs = 0;
  private kills = 0;
  private uiLock = false;
  private pendingLevels = 0;
  private ended = false;
  private floaters = 0;

  constructor() {
    super(SceneKeys.Game);
  }

  init(data: GameSceneData): void {
    this.characterId = data.characterId ?? 'char_knight';
    this.stageId = data.stageId ?? 'stage_forest';
    this.modIds = data.modifiers ?? [];
    this.daily = data.daily ?? false;
  }

  create(): void {
    this.stageDef = db().stage(this.stageId);
    this.runTimeMs = 0;
    this.kills = 0;
    this.uiLock = false;
    this.pendingLevels = 0;
    this.ended = false;
    this.floaters = 0;
    this.bosses = [];
    this.finalSpawned = false;
    this.endless = false;
    this.endlessDepth = 0;
    this.nextEndlessBossAt = 0;
    this.endlessChoice?.destroy();
    this.endlessChoice = undefined;

    this.mapSystem = new MapSystem(this, this.stageDef);
    this.player = new Player(
      this,
      db().character(this.characterId),
      metaBonusStats(this.characterId),
      metaWeaponMods(this.characterId),
    );
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setZoom(1.5);

    this.enemyGroup = this.physics.add.group({ classType: Enemy, runChildUpdate: true });
    this.pickupGroup = this.physics.add.group({ classType: Pickup, runChildUpdate: false });

    this.combat = new CombatSystem(this, this.player, this.enemyGroup, this.pickupGroup);
    this.particles = new ParticleSystem(this, this.player, this.mapSystem);
    this.weapons = new WeaponManager(this, this.player, this.enemyGroup, this.combat, this.particles);
    this.weapons.addWeapon(this.player.charDef.startingWeapon);
    this.director = new SpawnDirector(this, this.stageDef, this.enemyGroup, this.player);
    this.pickups = new PickupSystem(this, this.player, this.pickupGroup, this.enemyGroup, () => {
      this.onChestOpened();
    });
    this.passives = new PassiveManager(this.player);
    this.charms = new CharmSystem(this, this.player, this.enemyGroup, this.particles);
    this.bossSkills = new BossSkillSystem(this, this.player, this.director, this.particles);
    this.bonds = new BondSystem(this, this.player, this.enemyGroup, this.weapons, this.passives, this.particles);
    this.levelUps = new LevelUpSystem(this.player, this.weapons, this.passives, this.charms, this.bonds);
    this.mapSystem.bindCtx({
      player: this.player,
      director: this.director,
      pickups: this.pickups,
      enemies: this.enemyGroup,
    });

    // ===== 难度词条应用 =====
    this.goldBonusPct = 0;
    this.rushIdx = 0;
    this.rushCycle = 0;
    this.nextRushAt = 25;
    for (const id of this.modIds) {
      const m = db().modifier(id);
      const e = m.effects;
      this.goldBonusPct += m.goldBonusPct;
      if (e.enemyHpMul) this.director.mods.hp *= e.enemyHpMul;
      if (e.enemyDmgMul) this.director.mods.dmg *= e.enemyDmgMul;
      if (e.enemySpdMul) this.director.mods.spd *= e.enemySpdMul;
      if (e.spawnMul) this.director.mods.spawn *= e.spawnMul;
      if (e.xpMul) this.director.mods.xp *= e.xpMul;
      if (e.playerHpMul) {
        const dh = Math.floor(this.player.stats.maxHp * (e.playerHpMul - 1));
        this.player.applyStatPatch({ maxHp: dh });
        this.player.hp = Math.min(this.player.hp, this.player.stats.maxHp);
      }
      if (e.noHealDrop) this.pickups.noHealDrop = true;
    }

    this.setupJoystick();

    // UI 层独立场景：世界相机 zoom=1.5 会把 scrollFactor(0) 对象一起缩放推离屏幕
    this.scene.launch(SceneKeys.Hud, {
      refs: {
        player: this.player,
        weapons: this.weapons,
        passives: this.passives,
        charms: this.charms,
        bonds: this.bonds,
        pickups: this.pickups,
        director: this.director,
        mapSystem: this.mapSystem,
        enemies: this.enemyGroup,
        gameScene: this,
        durationSec: this.stageDef.durationSec,
        getTimerLabel: () =>
          this.stageDef.mode === 'bossrush'
            ? `讨伐 ${this.rushIdx} 只 · ${Math.floor(this.runTimeMs / 60000)}:${String(Math.floor(this.runTimeMs / 1000) % 60).padStart(2, '0')}`
            : undefined,
        getRunSec: () => this.runTimeMs / 1000,
        getKills: () => this.kills,
        getBosses: () => this.bosses,
        skipTime: (sec: number) => {
          this.runTimeMs += sec * 1000;
        },
      },
    });

    this.bindEvents();
  }

  private bindEvents(): void {
    eventBus.on(GameEvents.EnemyKilled, this.onEnemyKilled, this);
    eventBus.on(GameEvents.BossSpawned, this.onBossSpawned, this);
    eventBus.on(GameEvents.EnemyDamaged, this.onEnemyDamaged, this);
    eventBus.on(GameEvents.LevelUp, this.onLevelUp, this);
    eventBus.on(GameEvents.PlayerDied, this.onPlayerDied, this);
    this.events.on('spawn-chest-near-player', this.onSpawnChest, this);
    // 沙漠演出：钻沙预警尘/破土爆沙由 SpawnDirector 广播
    this.events.on('fx-sand-puff', (x: number, y: number) => this.particles.sandPuff(x, y));
    this.events.on('fx-sand-burst', (x: number, y: number) => this.particles.sandBurst(x, y));
    // 地形减速 + 冰面滑行挂到玩家（无对应机制的图恒为 1）
    this.player.terrain = (x, y) => this.mapSystem.slowFactorAt(x, y);
    this.player.slideAt = (x, y) => this.mapSystem.slideKAt(x, y);
    this.player.slideBase = this.stageDef.iceSlide ?? 1;
    // 旅人助战弹道组：复用玩家弹道命中管线
    this.allyShots = this.physics.add.group({ classType: Projectile, runChildUpdate: false });
    this.combat.registerProjectileGroup(this.allyShots);
    this.quests = new QuestSystem(this, this.stageDef, {
      player: this.player,
      director: this.director,
      pickups: this.pickups,
      enemies: this.enemyGroup,
      spawnAlly: (x, y) => this.spawnAllyAt(x, y),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      eventBus.off(GameEvents.EnemyKilled, this.onEnemyKilled, this);
      eventBus.off(GameEvents.BossSpawned, this.onBossSpawned, this);
      eventBus.off(GameEvents.EnemyDamaged, this.onEnemyDamaged, this);
      this.scene.stop(SceneKeys.Hud);
      eventBus.off(GameEvents.LevelUp, this.onLevelUp, this);
      eventBus.off(GameEvents.PlayerDied, this.onPlayerDied, this);
      this.charms.destroy();
      this.bonds.destroy();
      this.quests.destroy();
      this.bossSkills.destroy();
      this.pickups.destroy();
      this.particles.destroy();
    });
  }

  update(time: number, delta: number): void {
    this.particles.update(delta); // 环境粒子在升级菜单打开时也照常
    if (this.uiLock || this.ended) return;
    const dt = Math.min(delta, 100); // 切后台回来防跳帧
    this.runTimeMs += dt;

    // 沙暴环境每帧注入：风力推玩家 + 粒子扬沙
    const env = this.director.env;
    this.player.envWindX = env.windX;
    this.player.envWindY = env.windY;
    this.particles.stormWindX = env.stormActive ? env.windX : 0;
    this.particles.stormWindY = env.stormActive ? env.windY : 0;

    this.player.update(dt);
    // 最终Boss出场后停止普通刷怪（无尽模式继续刷）
    if (!this.finalSpawned || this.endless) this.director.update(this.runTimeMs / 1000, dt);
    this.weapons.update(time);
    this.pickups.update();
    this.mapSystem.update(dt);
    this.charms.update();
    this.bonds.recheck();
    this.bossSkills.update();
    this.quests.update(this.runTimeMs / 1000, dt);
    this.ally?.update(time);
    // 旅人弹道超时回收
    this.allyShots.children.each((s) => {
      const p = s as Projectile;
      if (p.active && time > p.dieAt) p.deactivate();
      return true;
    });

    const runSec = this.runTimeMs / 1000;
    // Boss Rush：按序列出 Boss，间隔召唤
    if (this.stageDef.mode === 'bossrush' && this.stageDef.bossSequence && runSec >= this.nextRushAt) {
      const seq = this.stageDef.bossSequence;
      const b = seq[this.rushIdx % seq.length];
      const mul = b.hpMul * Math.pow(1.6, this.rushCycle);
      this.director.spawnAt(b.enemyId, mul);
      this.nextRushAt = runSec + 9999; // 击杀后才排下一只
      this.floatText(this.player.x, this.player.y - 60, `讨伐 ${this.rushIdx + 1}：${db().enemy(b.enemyId).name}`, '#ff7050', 18);
    }
    if (this.stageDef.mode !== 'bossrush' && runSec >= this.stageDef.durationSec) {
      if (this.stageDef.finalBoss) {
        // 召最终Boss，击杀才通关
        if (!this.finalSpawned) {
          this.finalSpawned = true;
          this.director.spawnAt(this.stageDef.finalBoss.enemyId, this.stageDef.finalBoss.hpMul);
        }
      } else {
        this.endRun(true);
      }
    }
    // 无尽讨伐周期：每 90s 一波强化 Boss
    if (this.endless && this.stageDef.finalBoss && runSec >= this.nextEndlessBossAt) {
      this.nextEndlessBossAt = runSec + 90;
      const mul = this.stageDef.finalBoss.hpMul * Math.pow(1.6, this.endlessDepth);
      this.director.spawnAt(this.stageDef.finalBoss.enemyId, mul);
      this.floatText(this.player.x, this.player.y - 60, `无尽讨伐 第${this.endlessDepth + 1}波！`, '#ff7050', 18);
    }
  }

  /** 虚拟摇杆：屏幕左下半区按住拖动，松手回零（鼠标/触屏通用） */
  private setupJoystick(): void {
    const cam = this.cameras.main;
    const base = this.add.graphics().setScrollFactor(0).setDepth(Depths.Hud + 6).setVisible(false);
    const nub = this.add.graphics().setScrollFactor(0).setDepth(Depths.Hud + 7).setVisible(false);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.uiLock || this.ended) return;
      if (p.x > cam.width * 0.55 || p.y < cam.height * 0.45) return;
      this.joy = { base, nub, pointerId: p.id, cx: p.x, cy: p.y };
      this.drawJoy(p.x, p.y, p.x, p.y);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.joy || p.id !== this.joy.pointerId) return;
      this.drawJoy(this.joy.cx, this.joy.cy, p.x, p.y);
      const dx = p.x - this.joy.cx, dy = p.y - this.joy.cy;
      const len = Math.hypot(dx, dy);
      const k = Math.min(1, len / 50);
      this.player.virtualVec.x = len > 6 ? (dx / len) * k : 0;
      this.player.virtualVec.y = len > 6 ? (dy / len) * k : 0;
    });
    const release = (p: Phaser.Input.Pointer) => {
      if (!this.joy || p.id !== this.joy.pointerId) return;
      this.joy = undefined;
      this.player.virtualVec.x = 0;
      this.player.virtualVec.y = 0;
      base.setVisible(false);
      nub.setVisible(false);
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
  }

  private drawJoy(cx: number, cy: number, px: number, py: number): void {
    if (!this.joy) return;
    const dx = px - cx, dy = py - cy;
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, len / 50);
    const nx = cx + (dx / len) * 50 * k;
    const ny = cy + (dy / len) * 50 * k;
    this.joy.base.clear().setVisible(true)
      .lineStyle(2, 0xd8a838, 0.5).strokeCircle(cx, cy, 52)
      .fillStyle(0x141008, 0.3).fillCircle(cx, cy, 52);
    this.joy.nub.clear().setVisible(true)
      .fillStyle(0xd8a838, 0.7).fillCircle(nx, ny, 20)
      .lineStyle(2, 0xfff4d0, 0.8).strokeCircle(nx, ny, 20);
  }

  /** 通关抉择：领取奖励 or 无尽挑战 */
  private offerEndlessChoice(): void {
    this.uiLock = true;
    this.physics.world.pause();
    const W = 500, H = 220;
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;
    const bg = this.add.rectangle(cx, cy, W, H, 0x141008, 0.96)
      .setScrollFactor(0).setDepth(Depths.Hud + 10)
      .setStrokeStyle(2, 0xd8a838, 0.9);
    const title = txt(this, cx, cy - 70, '讨伐成功！', { fontSize: '26px', color: '#ffe08a' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(Depths.Hud + 11);
    const sub = txt(this, cx, cy - 36, '领取奖励离开，或留下挑战无尽深渊', { fontSize: '14px', color: '#c8b890' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(Depths.Hud + 11);
    const b1 = makeButton(this, cx - 130, cy + 50, '领取通关奖励', () => {
      this.closeEndlessChoice();
      this.endRun(true);
    }, { width: 200 });
    const b2 = makeButton(this, cx + 130, cy + 50, '无尽挑战！', () => {
      this.closeEndlessChoice();
      this.endless = true;
      this.endlessDepth = 0;
      this.nextEndlessBossAt = this.runTimeMs / 1000 + 60;
      this.floatText(this.player.x, this.player.y - 60, '无尽深渊开启——怪物将无限增强！', '#ff9050', 16);
    }, { width: 200, variant: 'wine' });
    this.endlessChoice = this.add.container(0, 0, [bg, title, sub, b1, b2]).setDepth(Depths.Hud + 10);
  }

  private closeEndlessChoice(): void {
    this.endlessChoice?.destroy();
    this.endlessChoice = undefined;
    this.uiLock = false;
    this.physics.world.resume();
  }

  /** 旅人任务奖励：首次救援时实例化永久弓箭手并挂入碰撞 */
  private spawnAllyAt(x: number, y: number): Ally | null {
    if (!this.ally || !this.ally.active) {
      this.ally = new Ally(this, this.player, this.enemyGroup, this.allyShots);
      this.add.existing(this.ally);
      this.physics.add.existing(this.ally);
      this.physics.add.overlap(this.ally, this.enemyGroup, (_a, e) => {
        this.ally?.tryHurt((e as Enemy).contactDamage * 0.5);
      });
    }
    return this.ally.spawnAt(x, y);
  }

  private onEnemyKilled(p: EnemyKilledPayload): void {
    this.kills += 1;
    this.player.kills = this.kills;
    if (!p.isBoss) return;
    this.bossSkills.unregister(p.enemy);
    this.bosses = this.bosses.filter((b) => b !== p.enemy);
    this.floatText(p.x, p.y - 30, `${p.enemy.def.name} 被消灭！`, '#ffd700');
    // Boss Rush：讨伐成功 → 回血+奖励，排下一波；循环后整体强化
    if (this.stageDef.mode === 'bossrush' && this.stageDef.bossSequence) {
      const seq = this.stageDef.bossSequence;
      this.rushIdx += 1;
      if (this.rushIdx % seq.length === 0) this.rushCycle += 1;
      const heal = Math.floor(this.player.stats.maxHp * 0.3);
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + heal);
      this.pickups.spawn('pickup_chest', p.x + 40, p.y + 40);
      this.pickups.spawn('pickup_relic_shard', p.x - 40, p.y + 40);
      this.nextRushAt = this.runTimeMs / 1000 + 8;
      this.floatText(p.x, p.y - 50, `讨伐完成 ${this.rushIdx}！`, '#ffd700', 18);
      return;
    }
    // 击杀最终Boss：无尽中算一波讨伐，否则弹通关抉择
    if (this.stageDef.finalBoss && p.enemy.def.id === this.stageDef.finalBoss.enemyId) {
      if (this.endless) {
        this.endlessDepth += 1;
        this.floatText(p.x, p.y - 50, `讨伐完成！深度 ${this.endlessDepth}`, '#ffd700', 18);
      } else {
        this.time.delayedCall(900, () => this.offerEndlessChoice());
      }
    }
  }

  private onBossSpawned(p: { enemy: Enemy }): void {
    this.bosses.push(p.enemy);
    this.bossSkills.register(p.enemy);
    this.floatText(p.enemy.x, p.enemy.y - 40, `${p.enemy.def.name} 出现了！`, '#ff5050');
    this.particles.shake(300, 0.005);
  }

  private onEnemyDamaged(p: { dmg: number; x: number; y: number; crit?: boolean }): void {
    // 暴击：更大更亮，橙色区分普通命中
    if (p.crit) this.floatText(p.x, p.y - 10, `${Math.round(p.dmg)}`, '#ff9838', 19);
    else this.floatText(p.x, p.y - 10, `${Math.round(p.dmg)}`, '#ffd25e');
  }

  private onLevelUp(): void {
    this.pendingLevels += 1;
    if (!this.uiLock) this.openLevelUpMenu();
  }

  private hudScene(): HudScene | undefined {
    return this.scene.get(SceneKeys.Hud) as HudScene | undefined;
  }

  private openLevelUpMenu(): void {
    this.uiLock = true;
    this.physics.world.pause();
    this.hudScene()?.showLevelUp(this.levelUps.rollOptions(3), (opt: LevelUpOption) => {
      this.levelUps.apply(opt);
      this.pendingLevels -= 1;
      this.closeLevelUpMenuOrReroll();
    });
  }

  /** 还有排队的升级则继续抽，否则关菜单恢复世界 */
  private closeLevelUpMenuOrReroll(): void {
    if (this.pendingLevels > 0) {
      const opts = this.levelUps.rollOptions(3);
      this.hudScene()?.showLevelUp(opts, (opt) => {
        this.levelUps.apply(opt);
        this.pendingLevels -= 1;
        this.closeLevelUpMenuOrReroll();
      });
    } else {
      this.hudScene()?.hideLevelUp();
      this.uiLock = false;
      this.physics.world.resume();
    }
  }

  private onPlayerDied(): void {
    this.time.delayedCall(900, () => this.endRun(false));
  }

  private onSpawnChest(): void {
    const x = this.player.x + Phaser.Math.Between(-100, 100);
    const y = this.player.y + Phaser.Math.Between(-100, 100);
    this.pickups.spawn('pickup_chest', x, y);
  }

  private onChestOpened(): void {
    const result = this.levelUps.grantChestReward();
    this.floatText(this.player.x, this.player.y - 40, `宝箱：${result}`, '#ffe08a');
  }

  private endRun(won: boolean): void {
    if (this.ended) return;
    this.ended = true;
    const timeSec = Math.floor(this.runTimeMs / 1000);
    const base = Math.floor(this.kills / 2) + Math.floor(timeSec / 5);
    const goldEarned = Math.floor(base * (1 + this.goldBonusPct));
    saveSystem.addGold(goldEarned);
    const depth = this.stageDef.mode === 'bossrush' ? this.rushIdx : this.endlessDepth;
    const result: RunResult = {
      won, timeSec, kills: this.kills, level: this.player.level, goldEarned,
      endlessDepth: depth,
      modifiers: this.modIds.length ? this.modIds : undefined,
      daily: this.daily || undefined,
    };
    if (this.daily) saveSystem.saveDailyBest(result);
    this.scene.start(SceneKeys.Result, result);
  }

  private floatText(x: number, y: number, text: string, color: string, fontSize = 14): void {
    if (this.floaters > 60) return;
    this.floaters += 1;
    const t = txt(this, x, y, text, { fontSize: `${fontSize}px`, color })
      .setOrigin(0.5)
      .setDepth(Depths.Hud);
    this.tweens.add({
      targets: t,
      y: y - 32,
      alpha: 0,
      duration: 550,
      onComplete: () => {
        t.destroy();
        this.floaters -= 1;
      },
    });
  }
}
