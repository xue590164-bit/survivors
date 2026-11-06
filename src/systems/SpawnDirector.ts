import Phaser from 'phaser';
import type { StageDef, StageEvent } from '../types';
import { db } from '../core/DataRegistry';
import { eventBus, GameEvents } from '../core/EventBus';
import { Enemy } from '../entities/Enemy';
import { telegraphCircle } from './Telegraph';
import type { Player } from '../entities/Player';

const MAX_ACTIVE_ENEMIES = 400;
const SPAWN_RING_PADDING = 120;
const SAND_COLOR = 0xd8b060;

/**
 * 刷怪导演：按关卡 spawnTimeline 时间轴控制刷怪节奏，
 * 并按 events 表触发一次性事件（精英潮/Boss/宝箱）。
 */
export class SpawnDirector {
  private credits: number[] = [];
  private firedEvents = new Set<number>();
  private bossSpawned = false;
  /** 难度词条系数：由 GameScene 开局注入 */
  mods = { hp: 1, dmg: 1, spd: 1, spawn: 1, xp: 1 };

  private elapsedSec = 0;
  /** 沙暴环境状态：spawnMul 作用于时间轴刷怪；wind 由 Player 每帧读取叠加速度 */
  readonly env = { spawnMul: 1, windX: 0, windY: 0, stormActive: false };
  private wormNextAt = 0;
  private wormUntil = 0;
  private wormCfg = { intervalSec: 12, damage: 25, radius: 56 };

  constructor(
    private scene: Phaser.Scene,
    public readonly stage: StageDef,
    private enemies: Phaser.Physics.Arcade.Group,
    private player: Player,
  ) {
    this.credits = stage.spawnTimeline.map(() => 0);
    eventBus.on(GameEvents.BossPhase, this.onBossPhase, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      eventBus.off(GameEvents.BossPhase, this.onBossPhase, this);
    });
  }

  /** 分段线性插值取曲线上 t 时刻的倍率 */
  private curveMul(points: [number, number][] | undefined, t: number): number {
    if (!points || points.length === 0) return 1;
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i][0]) {
        const [t0, v0] = points[i - 1];
        const [t1, v1] = points[i];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return points[points.length - 1][1];
  }

  /** 时间缩放后的三系数（Boss 豁免曲线，血量由数据按出场时点标定） */
  private scaled(enemyId: string, hpMul: number): { hp: number; dmg: number; xp: number } {
    const def = db().enemy(enemyId);
    if (def.isBoss) return { hp: hpMul, dmg: 1, xp: 1 };
    const hpCurve = this.curveMul(this.stage.difficultyCurve?.hp, this.elapsedSec);
    // 无尽加深：超出图定时长后，敌人血量每分钟 +40%、伤害 +20%
    const over = Math.max(0, this.elapsedSec - this.stage.durationSec) / 60;
    const endHp = 1 + over * 0.4;
    const endDmg = 1 + over * 0.2;
    return {
      hp: hpMul * hpCurve * endHp * this.mods.hp,
      dmg: this.curveMul(this.stage.difficultyCurve?.dmg, this.elapsedSec) * endDmg * this.mods.dmg,
      xp: (1 + (hpCurve * endHp - 1) * 0.35) * this.mods.xp, // 后期击杀经验更值钱，保证升级不断流
    };
  }

  private lastElapsedSec = 0;

  update(elapsedSec: number, deltaMs: number): void {
    this.lastElapsedSec = elapsedSec;
    this.elapsedSec = elapsedSec;
    const dt = deltaMs / 1000;

    this.stage.spawnTimeline.forEach((entry, i) => {
      if (elapsedSec < entry.timeSec) return;
      this.credits[i] += entry.ratePerSec * this.env.spawnMul * this.mods.spawn * dt;
      while (this.credits[i] >= 1) {
        this.credits[i] -= 1;
        this.spawnEnemy(entry.enemyId);
      }
    });

    this.stage.events.forEach((ev, i) => {
      if (elapsedSec >= ev.timeSec && !this.firedEvents.has(i)) {
        this.firedEvents.add(i);
        this.runEvent(ev);
      }
    });

    // 沙虫伏击：窗口期内周期在玩家脚下预警→沙虫跃出
    if (this.wormUntil > 0 && elapsedSec < this.wormUntil && elapsedSec >= this.wormNextAt) {
      this.wormNextAt = elapsedSec + this.wormCfg.intervalSec;
      const tx = this.player.x;
      const ty = this.player.y;
      const r = this.wormCfg.radius;
      const dmg = this.wormCfg.damage;
      telegraphCircle(this.scene, tx, ty, r, 1100, SAND_COLOR, () => {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, tx, ty);
        if (d <= r) this.player.takeDamage(dmg, this.scene.time.now);
        this.scene.events.emit('fx-sand-burst', tx, ty);
      });
    }
  }

  private spawnEnemy(enemyId: string, hpMul = 1): void {
    if (this.enemies.countActive(true) >= MAX_ACTIVE_ENEMIES) return;
    const [x, y] = this.ringPosition();
    this.doSpawn(enemyId, x, y, hpMul);
  }

  /** 在指定位置生成并应用时间曲线。返回生成的敌人。 */
  private doSpawn(enemyId: string, x: number, y: number, hpMul = 1): Enemy | null {
    const def = db().enemy(enemyId);
    const s = this.scaled(enemyId, hpMul);
    const e = this.enemies.get(0, 0, `tex_${def.id}`) as Enemy | null;
    if (!e) return null;
    // 精英判定只看事件倍率（hpMul>1），时间曲线不算——否则全场变精英
    e.spawn(def, x, y, this.player, s.hp, s.dmg, s.xp, !def.isBoss && hpMul > 1);
    e.spdMul = this.mods.spd;
    if (e.isBoss) eventBus.emit(GameEvents.BossSpawned, { enemy: e });
    return e;
  }

  /** 精确坐标生成：裂隙/空投等任务事件用 */
  spawnAtPos(enemyId: string, x: number, y: number, hpMul = 1): Enemy | null {
    return this.doSpawn(enemyId, x, y, hpMul);
  }

  /** 公开生成：调试模式/最终Boss/任意位置事件调用。返回生成的敌人。 */
  spawnAt(enemyId: string, hpMul = 1, nearPlayer = false): Enemy | null {
    const [x, y] = nearPlayer
      ? [this.player.x + 180, this.player.y]
      : this.ringPosition();
    return this.doSpawn(enemyId, x, y, hpMul);
  }

  /** 围绕 (x,y) 一圈召唤（Boss 转阶段/技能共用入口） */
  spawnRing(enemyId: string, x: number, y: number, count: number, radius = 150, hpMul = 1): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.doSpawn(enemyId, x + Math.cos(a) * radius, y + Math.sin(a) * radius, hpMul);
    }
  }

  /** Boss 转阶段：围绕 Boss 一圈召唤增援；phase.sandstorm 时拉永久沙暴 */
  private onBossPhase(p: { enemy: Enemy; phase: { spawnEnemyId: string; count: number; sandstorm?: boolean } }): void {
    this.spawnRing(p.phase.spawnEnemyId, p.enemy.x, p.enemy.y, p.phase.count, 150);
    if (p.phase.sandstorm) {
      this.startSandstorm(0, 45, 0, 1.35);
      if (this.stage.theme === 'tundra') eventBus.emit(GameEvents.Blizzard, { durationSec: 0 });
    }
  }

  /** 在玩家视野外一圈随机取点（worldView 已计 zoom） */
  private ringPosition(): [number, number] {
    const view = this.scene.cameras.main.worldView;
    const r = Math.hypot(view.width, view.height) / 2 + SPAWN_RING_PADDING;
    const a = Math.random() * Math.PI * 2;
    return [this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r];
  }

  private runEvent(ev: StageEvent): void {
    const p = ev.params ?? {};
    switch (ev.type) {
      case 'elite_wave': {
        const n = Number(p.count ?? 8);
        const hpMul = Number(p.hpMul ?? 3);
        for (let i = 0; i < n; i++) this.spawnEnemy(String(p.enemyId), hpMul);
        if (p.wakeDormant) this.wakeAllDormant();
        break;
      }
      case 'swarm_ring': {
        const n = Number(p.count ?? 40);
        for (let i = 0; i < n; i++) this.spawnEnemy(String(p.enemyId));
        break;
      }
      case 'miniboss': {
        const hpMul = Number(p.hpMul ?? 1);
        this.spawnEnemy(String(p.enemyId), hpMul);
        break;
      }
      case 'boss': {
        if (this.bossSpawned) break;
        this.bossSpawned = true;
        this.spawnEnemy(String(p.enemyId), Number(p.hpMul ?? 30));
        break;
      }
      case 'chest':
        // 由 PickupSystem 监听更合理；骨架期直接广播给场景处理
        this.scene.events.emit('spawn-chest-near-player');
        break;
      case 'sandstorm': {
        const dur = Number(p.durationSec ?? 15);
        this.startSandstorm(dur, Number(p.windX ?? 40), Number(p.windY ?? 0), Number(p.spawnMul ?? 1.5));
        break;
      }
      case 'blizzard': {
        // 暴雪：弱风场+视野暗角+刷怪增幅（沙暴骨架复用，HUD 暗角由事件驱动）
        const dur = Number(p.durationSec ?? 15);
        this.startSandstorm(dur, Number(p.windX ?? 25), Number(p.windY ?? 0), Number(p.spawnMul ?? 1.5));
        eventBus.emit(GameEvents.Blizzard, { durationSec: dur });
        break;
      }
      case 'burrow_swarm': {
        const n = Number(p.count ?? 12);
        const r = Number(p.radius ?? 200);
        this.spawnBurrow(String(p.enemyId), n, r);
        break;
      }
      case 'wormstrike': {
        this.wormCfg = {
          intervalSec: Number(p.intervalSec ?? 12),
          damage: Number(p.damage ?? 25),
          radius: Number(p.radius ?? 56),
        };
        this.wormUntil = this.lastElapsedSec + Number(p.durationSec ?? 90);
        this.wormNextAt = this.lastElapsedSec + Number(p.delaySec ?? 6);
        break;
      }
    }
  }

  /** 沙暴：风场推力 + 刷怪增幅，持续 dur 秒（dur<=0 为常驻，如 Boss 阶段二） */
  startSandstorm(durSec: number, windX: number, windY: number, spawnMul: number): void {
    this.env.windX = windX;
    this.env.windY = windY;
    this.env.spawnMul = Math.max(this.env.spawnMul, spawnMul);
    this.env.stormActive = true;
    eventBus.emit(GameEvents.Sandstorm, { durationSec: durSec, windX, windY });
    if (durSec > 0) {
      this.scene.time.delayedCall(durSec * 1000, () => {
        this.env.windX = 0;
        this.env.windY = 0;
        this.env.spawnMul = 1;
        this.env.stormActive = false;
      });
    }
  }

  /** 钻沙虫群：玩家周围随机点先冒沙尘 0.8s 再钻出（区别 swarm_ring 的瞬时包围） */
  private spawnBurrow(enemyId: string, count: number, radius: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * radius;
      const x = this.player.x + Math.cos(a) * r;
      const y = this.player.y + Math.sin(a) * r;
      this.scene.events.emit('fx-sand-puff', x, y);
      this.scene.time.delayedCall(800, () => {
        if (this.enemies.countActive(true) >= MAX_ACTIVE_ENEMIES) return;
        this.doSpawn(enemyId, x, y, 1);
      });
    }
  }

  /** 沉眠守卫：建图时在指定点生成休眠怪（接近/受击/唤醒波前无 AI） */
  spawnDormant(enemyId: string, x: number, y: number): Enemy | null {
    const e = this.doSpawn(enemyId, x, y, 1);
    e?.enterDormant();
    return e;
  }

  /** 唤醒全部沉眠守卫（精英波联动） */
  wakeAllDormant(): void {
    for (const e of this.enemies.getMatching('active', true) as Enemy[]) {
      if (e.dormant) e.wake();
    }
  }
}
