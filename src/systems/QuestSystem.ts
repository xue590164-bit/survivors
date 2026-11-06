import Phaser from 'phaser';
import { Depths } from '../config';
import { eventBus, GameEvents } from '../core/EventBus';
import { achievements } from './AchievementSystem';
import { telegraphCircle } from './Telegraph';
import type { StageDef, StageQuest } from '../types';
import type { Player } from '../entities/Player';
import type { Ally } from '../entities/Ally';
import type { Enemy } from '../entities/Enemy';
import type { SpawnDirector } from './SpawnDirector';
import type { PickupSystem } from './PickupSystem';

const CHANNEL_R = 64;       // 站位充能半径
const OBJ_DIST_MIN = 480;   // 任务物落点最小距（玩家为圆心）
const OBJ_DIST_MAX = 760;
const COMPASS_MS = 150;     // 指北针广播节流

interface QuestObj {
  x: number;
  y: number;
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  /** 充能进度 ms（channelMs 类目标用） */
  charge: number;
  need: number;
  done: boolean;
  /** 子状态（beacon=是否点燃；rift=喷怪计时；airdrop=落地倒计时） */
  state: number;
  /** 任务自定义参数（贴图/文案/刷怪覆盖），来自 StageQuest.params */
  data?: Record<string, unknown>;
}

/**
 * 局内任务系统：时间轴触发地图目标物，HUD 指北针引导，
 * 站位充能/倒计时完成动作 → 发放特殊增益与助战奖励。
 * 首个落地：冰原冻土（旅人/烽火台×3/裂隙/空投）。
 */
export class QuestSystem {
  private objs: QuestObj[] = [];
  private fired = new Set<number>();
  private beaconLit = 0;
  private beaconTotal = 0;
  private riftAcc = 0;
  private compassAcc = 0;
  private questLabel = '';

  constructor(
    private scene: Phaser.Scene,
    private stage: StageDef,
    private ctx: {
      player: Player;
      director: SpawnDirector;
      pickups: PickupSystem;
      enemies: Phaser.Physics.Arcade.Group;
      spawnAlly: (x: number, y: number) => Ally | null;
    },
  ) {}

  update(elapsedSec: number, deltaMs: number): void {
    const quests = this.stage.quests;
    if (!quests) return;
    quests.forEach((q, i) => {
      if (elapsedSec >= q.timeSec && !this.fired.has(i)) {
        this.fired.add(i);
        this.startQuest(q);
      }
    });
    this.updateObjs(deltaMs);
    this.emitCompass(deltaMs);
  }

  /** 玩家周围随机落点（视野外一圈，保证要"跑图"） */
  private objPos(minR = OBJ_DIST_MIN, maxR = OBJ_DIST_MAX): [number, number] {
    const a = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    return [this.ctx.player.x + Math.cos(a) * r, this.ctx.player.y + Math.sin(a) * r];
  }

  private makeObj(tex: string, x: number, y: number, needMs: number, tint = 0x9ad8ff): QuestObj {
    const img = this.scene.add.image(x, y, tex).setDepth(Depths.Map + 2).setScale(1.1);
    const glow = this.scene.add
      .image(x, y, 'tex_zone')
      .setTint(tint)
      .setAlpha(0.22)
      .setDepth(Depths.Map + 1)
      .setScale((CHANNEL_R * 2) / 128);
    const obj: QuestObj = { x, y, img, glow, charge: 0, need: needMs, done: false, state: 0 };
    this.objs.push(obj);
    return obj;
  }

  private startQuest(q: StageQuest): void {
    const p = q.params ?? {};
    switch (q.type) {
      case 'thaw_survivor': {
        const [x, y] = this.objPos();
        const o = this.makeObj(String(p.tex ?? 'tex_quest_survivor'), x, y, Number(p.channelMs ?? 4000), Number(p.glow ?? 0x88d8f0));
        o.data = p;
        this.questLabel = String(p.label ?? '救援冻僵旅人');
        this.toast(String(p.toast ?? '有旅人冻在冰里了！循着蓝光去救他'), '#9ad8ff');
        break;
      }
      case 'light_beacons': {
        const n = Number(p.count ?? 3);
        this.beaconLit = 0;
        this.beaconTotal = n;
        for (let i = 0; i < n; i++) {
          const [x, y] = this.objPos(550, 900);
          const o = this.makeObj(String(p.tex ?? 'tex_bld_beacon_off'), x, y, Number(p.channelMs ?? 2500), Number(p.glow ?? 0xff9030));
          o.data = p;
        }
        this.questLabel = String(p.label ?? '点燃烽火台');
        this.toast(String(p.toast ?? `点燃 ${n} 座烽火台，唤来暖阳！`), '#ffb860');
        break;
      }
      case 'seal_rift': {
        const [x, y] = this.objPos();
        const o = this.makeObj(String(p.tex ?? 'tex_quest_rift'), x, y, Number(p.channelMs ?? 6000), Number(p.glow ?? 0x40e0ff));
        o.state = 1; // 1=开启中（持续喷怪）
        o.data = p;
        this.questLabel = String(p.label ?? '封印寒冰裂隙');
        this.toast(String(p.toast ?? '寒冰裂隙在吐怪——封印它，或留着刷经验'), '#40e0ff');
        break;
      }
      case 'airdrop': {
        const [x, y] = this.objPos(400, 600);
        const o = this.makeObj(String(p.tex ?? 'tex_bld_flag'), x, y, 0, Number(p.glow ?? 0xffd25e));
        o.need = Number(p.delayMs ?? 8000); // 借 need 当倒计时
        o.state = -0.001; // state<0=落地倒计时（逐帧累计负值）
        o.data = p;
        this.questLabel = String(p.label ?? '抢占空投点');
        this.toast(String(p.toast ?? '信号弹升空！空投落点已标记——敌人也盯上它了'), '#ffd25e');
        // 敌人朝落点汇聚两波
        const waves = (p.waves as [string, number][]) ?? [['enemy_icewolf', 8], ['enemy_frozen_corpse', 10]];
        this.ctx.director.spawnRing(waves[0][0], x, y, waves[0][1], 220);
        if (waves[1]) {
          this.scene.time.delayedCall(4000, () => {
            this.ctx.director.spawnRing(waves[1][0], x, y, waves[1][1], 260);
          });
        }
        break;
      }
    }
  }

  private updateObjs(deltaMs: number): void {
    const p = this.ctx.player;
    for (const o of this.objs) {
      if (o.done) continue;
      const d = Phaser.Math.Distance.Between(p.x, p.y, o.x, o.y);

      // 空投：倒计时推进，不看站位
      if (o.state < 0) {
        o.state -= deltaMs / 1000; // state 负值累计秒数
        o.glow.setScale(((CHANNEL_R * 2) / 128) * (1 + Math.sin(this.scene.time.now / 200) * 0.15));
        if (-o.state >= o.need / 1000) this.landAirdrop(o);
        continue;
      }

      // 裂隙开启中：持续喷怪（节流）
      if (o.state === 1) {
        this.riftAcc += deltaMs;
        if (this.riftAcc >= 4000) {
          this.riftAcc = 0;
          if (this.ctx.enemies.countActive(true) < 380) {
            this.ctx.director.spawnAtPos(
              String(o.data?.spawnEnemyId ?? 'enemy_frozen_corpse'),
              o.x + Phaser.Math.Between(-30, 30),
              o.y + Phaser.Math.Between(-30, 30),
            );
          }
        }
      }

      // 充能：站在圈内推进，离开按 2× 退
      if (o.need > 0) {
        if (d < CHANNEL_R) {
          o.charge += deltaMs;
          const k = Math.min(1, o.charge / o.need);
          o.glow.setScale(((CHANNEL_R * 2) / 128) * (0.8 + k * 1.4)).setAlpha(0.22 + k * 0.4);
          if (o.charge >= o.need) this.completeObj(o);
        } else if (o.charge > 0) {
          o.charge = Math.max(0, o.charge - deltaMs * 2);
        }
      }
    }
  }

  private completeObj(o: QuestObj): void {
    const kind = o.img.texture.key;
    switch (kind) {
      case 'tex_quest_survivor': {
        o.done = true;
        achievements.bump('questDone');
        o.img.setTint(0x666666).setAlpha(0.7);
        o.glow.setVisible(false);
        const ally = o.data?.ally === false ? null : this.ctx.spawnAlly(o.x, o.y - 14);
        this.ctx.pickups.spawn('pickup_chest', o.x + 30, o.y + 18);
        this.ctx.pickups.spawn('pickup_relic_shard', o.x - 30, o.y + 18);
        this.toast(String(o.data?.doneToast ?? (ally ? '旅人加入了你！弓箭手永久助战' : '旅人获救，留下谢礼')), '#9ad8ff');
        break;
      }
      case 'tex_bld_beacon_off': {
        o.done = true;
        achievements.bump('questDone');
        o.img.setTexture(String(o.data?.texOn ?? 'tex_bld_beacon_on'));
        o.glow.setTint(0xffb860).setAlpha(0.4);
        this.beaconLit++;
        this.ctx.player.applyStatPatch({ damagePct: 0.05 });
        this.toast(`烽火燃起 ${this.beaconLit}/${this.beaconTotal} —— 伤害+5%`, '#ffb860');
        if (this.beaconLit >= this.beaconTotal) this.sunburst(o.x, o.y);
        break;
      }
      case 'tex_quest_rift': {
        o.done = true;
        achievements.bump('questDone');
        o.state = 0;
        o.img.setTint(0x335566).setAlpha(0.6);
        o.glow.setVisible(false);
        this.ctx.pickups.spawn('pickup_chest', o.x, o.y + 24);
        this.ctx.pickups.spawn('pickup_relic_shard', o.x + 24, o.y - 18);
        this.ctx.player.applyStatPatch({ armor: 2 });
        this.toast('裂隙封印！护甲+2 永久', '#40e0ff');
        break;
      }
    }
  }

  /** 暖阳普照：烽火全燃奖励——屏内非Boss敌人全灭 + 大宝箱 */
  private sunburst(x: number, y: number): void {
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    for (const e of this.ctx.enemies.getMatching('active', true) as Enemy[]) {
      if (e.isBoss || e.dormant) continue;
      if (e.x > view.x - 60 && e.x < view.right + 60 && e.y > view.y - 60 && e.y < view.bottom + 60) {
        e.killSilent();
      }
    }
    this.scene.cameras.main.flash(500, 255, 240, 200);
    this.ctx.pickups.spawn('pickup_chest', x, y + 26);
    this.ctx.pickups.spawn('pickup_relic_shard', x, y - 26);
    this.toast('暖阳普照！视野内敌人尽灭', '#ffe89a');
  }

  private landAirdrop(o: QuestObj): void {
    o.done = true;
    achievements.bump('questDone');
    o.glow.setVisible(false);
    telegraphCircle(this.scene, o.x, o.y, 70, 350, 0xffd25e, () => {
      this.ctx.pickups.spawn('pickup_chest', o.x - 30, o.y + 16);
      this.ctx.pickups.spawn('pickup_chest', o.x + 30, o.y + 16);
      this.ctx.pickups.spawn('pickup_bomb', o.x, o.y - 20);
      this.ctx.pickups.spawn('pickup_meat', o.x, o.y + 30);
      this.scene.events.emit('fx-sand-burst', o.x, o.y);
      this.toast('空投落地！补给到手', '#ffd25e');
    });
  }

  /** 指北针广播：节流 150ms，活动目标优先取最近未完成物 */
  private emitCompass(deltaMs: number): void {
    this.compassAcc += deltaMs;
    if (this.compassAcc < COMPASS_MS) return;
    this.compassAcc = 0;
    const p = this.ctx.player;
    let best: QuestObj | null = null;
    let bd = Number.MAX_VALUE;
    for (const o of this.objs) {
      if (o.done) continue;
      const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    eventBus.emit(GameEvents.QuestCompass, best
      ? { x: best.x, y: best.y, px: p.x, py: p.y, label: this.questLabel }
      : null);
  }

  private toast(text: string, color: string): void {
    eventBus.emit(GameEvents.QuestToast, { text, color });
  }

  destroy(): void {
    for (const o of this.objs) {
      o.img.destroy();
      o.glow.destroy();
    }
    this.objs.length = 0;
  }
}
