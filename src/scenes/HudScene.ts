import Phaser from 'phaser';
import { SceneKeys, Depths, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { txt } from '../ui/text';
import { Hud } from '../ui/Hud';
import { LevelUpMenu } from '../ui/LevelUpMenu';
import { eventBus, GameEvents } from '../core/EventBus';
import type { BondSystem } from '../systems/BondSystem';
import type { BondDef } from '../types';
import { DebugSystem, DEV_MODE } from '../systems/DebugSystem';
import type { LevelUpOption } from '../systems/LevelUpSystem';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import type { WeaponManager } from '../systems/WeaponManager';
import type { PassiveManager } from '../systems/PassiveManager';
import type { CharmSystem } from '../systems/CharmSystem';
import type { PickupSystem } from '../systems/PickupSystem';
import type { SpawnDirector } from '../systems/SpawnDirector';
import type { MapSystem } from '../systems/MapSystem';

/** GameScene 递来的运行时句柄：HUD 只读这些引用，不反向依赖场景内部 */
export interface HudRefs {
  player: Player;
  weapons: WeaponManager;
  passives: PassiveManager;
  charms: CharmSystem;
  bonds: BondSystem;
  pickups: PickupSystem;
  director: SpawnDirector;
  mapSystem: MapSystem;
  enemies: Phaser.Physics.Arcade.Group;
  /** dev.scene 控制台句柄指向世界场景 */
  gameScene: Phaser.Scene;
  durationSec: number;
  /** Boss Rush 等模式的计时栏替代文案；undefined 走默认 "当前/总时长" */
  getTimerLabel?: () => string | undefined;
  /** 本局难度词条名（开局传入，局内不变） */
  modNames?: string;
  getRunSec: () => number;
  getKills: () => number;
  getBosses: () => Enemy[];
  skipTime: (sec: number) => void;
}

/**
 * 局内 UI 层：与 GameScene 平行运行的独立场景。
 * 世界相机 zoom=1.5 会把 scrollFactor(0) 的对象一起缩放推离屏幕，
 * 所以 HUD/升级菜单/调试层必须放在 zoom=1 的独立场景里。
 */
export class HudScene extends Phaser.Scene {
  private refs!: HudRefs;
  private hud!: Hud;
  private menu!: LevelUpMenu;
  private debug: DebugSystem | null = null;
  private arrows: Phaser.GameObjects.Image[] = [];

  constructor() {
    super(SceneKeys.Hud);
  }

  init(data: { refs: HudRefs }): void {
    this.refs = data.refs;
  }

  create(): void {
    const r = this.refs;
    this.hud = new Hud(this, r.player, r.weapons, r.passives, r.charms, r.bonds);
    const onBond = (p: { bond: BondDef }) => this.hud.announceBond(p.bond);
    eventBus.on(GameEvents.BondActivated, onBond);
    this.menu = new LevelUpMenu(this);

    if (r.modNames) {
      txt(this, 16, 82, `词条 ${r.modNames}`, { fontSize: '11px', color: '#ff9050' })
        .setOrigin(0, 0)
        .setDepth(Depths.Hud + 1);
    }

    if (DEV_MODE) {
      this.debug = new DebugSystem(this, {
        player: r.player,
        weapons: r.weapons,
        passives: r.passives,
        charms: r.charms,
        pickups: r.pickups,
        director: r.director,
        enemies: r.enemies,
        skipTime: r.skipTime,
        getRunSec: r.getRunSec,
        gameScene: r.gameScene,
      });
      txt(this, GAME_WIDTH - 10, 12, 'DEV MODE', { fontSize: '12px', color: '#8affa0' })
        .setOrigin(1, 0)
        .setDepth(Depths.Overlay);
    }

    const onCompass = (p: { x: number; y: number; label: string } | null) => {
      this.questTarget = p;
    };
    const onToast = (p: { text: string; color?: string }) => this.questToast(p.text, p.color ?? '#9ad8ff');
    const onBlizzard = (p: { durationSec: number }) => this.blizzard(p.durationSec);
    eventBus.on(GameEvents.QuestCompass, onCompass);
    eventBus.on(GameEvents.QuestToast, onToast);
    eventBus.on(GameEvents.Blizzard, onBlizzard);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      eventBus.off(GameEvents.BondActivated, onBond);
      eventBus.off(GameEvents.QuestCompass, onCompass);
      eventBus.off(GameEvents.QuestToast, onToast);
      eventBus.off(GameEvents.Blizzard, onBlizzard);
      this.debug?.destroy();
      if (DEV_MODE) delete (window as unknown as { dev?: unknown }).dev;
    });
  }

  private questTarget: { x: number; y: number; label: string } | null = null;
  private questArrow?: Phaser.GameObjects.Image;
  private questLabel?: Phaser.GameObjects.Text;
  private blizzardVeil?: Phaser.GameObjects.Rectangle;

  update(_time: number, delta: number): void {
    if (!this.refs) return;
    this.hud.update(this.refs.getRunSec(), this.refs.durationSec, this.refs.getKills(), this.refs.getBosses(), this.refs.getTimerLabel?.());
    this.updateAltarHints();
    this.updateQuestCompass();
    this.debug?.update(delta);
  }

  /** 祭坛方位提示：近距（~900px）且屏外才在屏幕边缘画金色箭头 */
  private updateAltarHints(): void {
    const ms = this.refs.mapSystem;
    const cam = this.refs.gameScene.cameras.main;
    const p = this.refs.player;
    const hints = ms.altarHints(p.x, p.y, 900);
    const zoom = cam.zoom;
    let used = 0;
    for (const h of hints) {
      const sx = (h.x - cam.scrollX) * zoom;
      const sy = (h.y - cam.scrollY) * zoom;
      if (sx > 40 && sx < GAME_WIDTH - 40 && sy > 40 && sy < GAME_HEIGHT - 40) continue; // 屏内能看见建筑本身
      const ax = Phaser.Math.Clamp(sx, 40, GAME_WIDTH - 40);
      const ay = Phaser.Math.Clamp(sy, 40, GAME_HEIGHT - 40);
      const arrow = this.obtainArrow(used++);
      // 贴图本体朝左：+PI 转向目标方位
      arrow.setVisible(true).setPosition(ax, ay).setRotation(Math.atan2(sy - ay, sx - ax) + Math.PI);
      arrow.setScale(0.85 + Math.sin(this.time.now / 300) * 0.15);
    }
    for (let i = used; i < this.arrows.length; i++) this.arrows[i].setVisible(false);
  }

  private obtainArrow(i: number): Phaser.GameObjects.Image {
    while (this.arrows.length <= i) {
      this.arrows.push(this.add.image(0, 0, 'tex_ui_arrow').setDepth(Depths.Overlay - 1).setVisible(false));
    }
    return this.arrows[i];
  }

  /** 任务指北针：青色箭头指最近活动任务点（屏内目标隐藏） */
  private updateQuestCompass(): void {
    const t = this.questTarget;
    if (!t) {
      this.questArrow?.setVisible(false);
      this.questLabel?.setVisible(false);
      return;
    }
    const cam = this.refs.gameScene.cameras.main;
    const sx = (t.x - cam.scrollX) * cam.zoom;
    const sy = (t.y - cam.scrollY) * cam.zoom;
    const onScreen = sx > 40 && sx < GAME_WIDTH - 40 && sy > 40 && sy < GAME_HEIGHT - 40;
    if (onScreen) {
      this.questArrow?.setVisible(false);
      this.questLabel?.setVisible(false);
      return;
    }
    this.questArrow ??= this.add
      .image(0, 0, 'tex_ui_arrow')
      .setDepth(Depths.Overlay - 1)
      .setTint(0x9ad8ff);
    this.questLabel ??= txt(this, 0, 0, '', { fontSize: '12px', color: '#9ad8ff' })
      .setDepth(Depths.Overlay - 1)
      .setOrigin(0.5);
    const ax = Phaser.Math.Clamp(sx, 40, GAME_WIDTH - 40);
    const ay = Phaser.Math.Clamp(sy, 40, GAME_HEIGHT - 40);
    this.questArrow
      .setVisible(true)
      .setPosition(ax, ay)
      .setRotation(Math.atan2(sy - ay, sx - ax) + Math.PI)
      .setScale(1 + Math.sin(this.time.now / 280) * 0.18);
    this.questLabel.setVisible(true).setText(t.label).setPosition(ax, ay - 22);
  }

  /** 任务横幅：顶部金色提示条，淡出 */
  private questToast(text: string, color: string): void {
    const t = txt(this, GAME_WIDTH / 2, 76, text, { fontSize: '17px', color })
      .setOrigin(0.5)
      .setDepth(Depths.Overlay)
      .setAlpha(0);
    this.tweens.add({
      targets: t,
      alpha: 1,
      y: 64,
      duration: 260,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({ targets: t, alpha: 0, y: 58, delay: 2600, duration: 500, onComplete: () => t.destroy() });
      },
    });
  }

  /** 暴雪暗角：全屏幽蓝渐晕，durationSec 后淡出（<=0 常驻到下条事件） */
  private blizzard(durationSec: number): void {
    this.blizzardVeil ??= this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0a1830, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(Depths.Overlay - 2);
    const veil = this.blizzardVeil;
    this.tweens.add({ targets: veil, fillAlpha: 0.3, duration: 900 });
    if (durationSec > 0) {
      this.time.delayedCall(durationSec * 1000, () => {
        this.tweens.add({ targets: veil, fillAlpha: 0, duration: 1200 });
      });
    }
  }

  /** GameScene 升级时调用：弹出三选一（可能先于 create 被调，容错） */
  showLevelUp(options: LevelUpOption[], onPick: (opt: LevelUpOption) => void): void {
    this.menu?.show(options, onPick);
  }

  hideLevelUp(): void {
    this.menu?.hide();
  }
}
