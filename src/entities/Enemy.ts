import Phaser from 'phaser';
import type { EnemyDef } from '../types';
import { eventBus, GameEvents } from '../core/EventBus';
import { Depths } from '../config';
import { FrameAnimator, frameKeysOf } from './FrameAnimator';
import type { Player } from './Player';

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  def!: EnemyDef;
  hp = 1;
  maxHp = 1;
  xpValue = 1;
  isElite = false;
  isBoss = false;
  /** 接触伤害（含时间缩放），CombatSystem 读这个而不是 def.damage */
  contactDamage = 1;
  /** 休眠守卫：半埋沙中不动不攻，靠近/受击/导演唤醒 */
  dormant = false;
  /** 图腾增益区注册表：stationary 敌人生成时挂入，死亡摘除 */
  static auraZones: { src: Enemy; x: number; y: number; r: number; mul: number }[] = [];
  private auraZone?: (typeof Enemy.auraZones)[number];
  private shootNextAt = 0;
  private baseScale = 1;
  private anim: FrameAnimator | null = null;
  private target!: Player;
  private phaseIdx = 0;
  private invulnUntil = 0;
  /** 中毒 DOT / 冰冻（护符效果） */
  private dotDps = 0;
  private dotUntil = 0;
  private nextDotAt = 0;
  private frozenUntil = 0;
  /** 击退：短时覆盖移动 */
  private kbVelX = 0;
  private kbVelY = 0;
  private kbUntil = 0;
  /** 冲锋（charger AI 与 Boss charge/leap 技能共用）：固定速度冲到时间结束 */
  private chargeVx = 0;
  private chargeVy = 0;
  private chargeUntil = 0;
  /** charger AI 状态机：'idle'→'windup'→'dash' */
  private chargeState: 'idle' | 'windup' = 'idle';
  private chargeNextAt = 0;
  private windupUntil = 0;
  /** 出生时刻（淡入用）与悬浮/透明度脉动的相位错开值 */
  private spawnAtMs = 0;
  private hoverPhase = 0;

  /** 每个伤害源的独立命中冷却：key=sourceId，value=下次允许命中的时间戳 */
  private hitCooldowns = new Map<string, number>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'tex_enemy_slime');
    this.setDepth(Depths.Enemy);
  }

  spawn(def: EnemyDef, x: number, y: number, target: Player, hpMul = 1, dmgMul = 1, xpMul = 1, elite = false): this {
    this.def = def;
    this.target = target;
    this.hp = def.hp * hpMul;
    this.maxHp = this.hp;
    this.xpValue = Math.max(0, Math.round(def.xp * xpMul));
    this.contactDamage = Math.max(1, Math.round(def.damage * dmgMul));
    this.isBoss = !!def.isBoss;
    this.isElite = elite;
    this.phaseIdx = 0;
    this.invulnUntil = 0;
    this.dotDps = 0;
    this.frozenUntil = 0;
    this.chargeUntil = 0;
    this.chargeState = 'idle';
    this.chargeNextAt = 0;
    this.dormant = false;
    this.shootNextAt = this.scene.time.now + 1500;
    this.hitCooldowns.clear();

    this.setTexture(`tex_${def.id}`);
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    this.setAlpha(def.alpha ?? 1);
    this.rotation = 0;
    this.spawnAtMs = this.scene.time.now;
    this.hoverPhase = (((Math.abs(x) + Math.abs(y)) % 1000) / 1000) * Math.PI * 2;
    // 精英：体型放大 + 暖色偏，和普通怪一眼区分
    this.baseScale = def.scale * (this.isElite ? 1.35 : 1);
    this.setScale(this.baseScale);
    if (this.isElite) this.setTint(0xffb070);
    else this.clearTint();

    // 有序列帧就建动画器，相位按出生点错开
    const frames = frameKeysOf(this.scene, `tex_${def.id}`);
    this.anim = frames.length > 1
      ? new FrameAnimator(this, frames, def.animMs ?? 300, (Math.abs(x) + Math.abs(y)) % (def.animMs ?? 300))
      : null;

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    body.setSize(this.width * 0.7, this.height * 0.7);
    // stationary 增益源：注册光环区（寒冰图腾给周围敌人加速）
    if (def.aiType === 'stationary' && def.auraRadius) {
      this.auraZone = { src: this, x, y, r: def.auraRadius, mul: def.auraSpeedMul ?? 1.25 };
      Enemy.auraZones.push(this.auraZone);
    } else {
      this.auraZone = undefined;
    }
    return this;
  }

  /** 沉眠状态：进入休眠（沙丘半埋、色调灰暗、无 AI） */
  enterDormant(): void {
    this.dormant = true;
    this.setAlpha(0.55);
    this.setTint(0x8a7a58);
    if (this.anim) this.anim.playing = false;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
  }

  /** 唤醒：恢复行动，带一次小型破土弹跳 */
  wake(): void {
    if (!this.dormant) return;
    this.dormant = false;
    this.setAlpha(this.def.alpha ?? 1);
    this.restoreTint();
    if (this.anim) this.anim.playing = true;
    this.scene.tweens.add({
      targets: this, scaleX: this.baseScale * 1.18, scaleY: this.baseScale * 1.18,
      duration: 120, yoyo: true, ease: 'Quad.easeOut',
      onComplete: () => { if (this.active) this.setScale(this.baseScale); },
    });
  }

  update(nowMs: number, deltaMs: number): void {
    if (!this.active || !this.target) return;
    const body = this.body as Phaser.Physics.Arcade.Body;

    // 休眠守卫：静止不动，玩家逼近 60px 自行苏醒
    if (this.dormant) {
      body.setVelocity(0, 0);
      const ddx = this.target.x - this.x;
      const ddy = this.target.y - this.y;
      if (ddx * ddx + ddy * ddy < 3600) this.wake();
      return;
    }

    // 中毒 DOT：每 400ms 跳一次
    if (this.dotDps > 0) {
      if (nowMs >= this.dotUntil) {
        this.dotDps = 0;
      } else if (nowMs >= this.nextDotAt) {
        this.nextDotAt = nowMs + 400;
        this.takeDamage(this.dotDps * 0.4);
      }
    }
    // 冰冻：定身，解冻时恢复色调
    if (this.frozenUntil > 0) {
      if (nowMs < this.frozenUntil) {
        body.setVelocity(0, 0);
        return;
      }
      this.frozenUntil = 0;
      this.restoreTint();
    }
    // 击退覆盖：沿击退方向滑出并衰减
    if (nowMs < this.kbUntil) {
      const t = (this.kbUntil - nowMs) / 180;
      body.setVelocity(this.kbVelX * t, this.kbVelY * t);
      this.anim?.update(deltaMs);
      return;
    }
    // 冲锋中：固定速度，不被追击逻辑覆盖
    if (nowMs < this.chargeUntil) {
      body.setVelocity(this.chargeVx, this.chargeVy);
      this.anim?.update(deltaMs);
      return;
    }

    // stationary AI（寒冰图腾）：不动不攻，只做光环桩
    if (this.def.aiType === 'stationary') {
      body.setVelocity(0, 0);
      this.anim?.update(deltaMs);
      return;
    }

    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const len = Math.hypot(dx, dy) || 1;
    // 图腾光环：站在增益区内的敌人提速（自己不享受）
    let auraMul = 1;
    for (const z of Enemy.auraZones) {
      if (z.src === this || !z.src.active) continue;
      const ax = this.x - z.x;
      const ay = this.y - z.y;
      if (ax * ax + ay * ay < z.r * z.r) { auraMul = z.mul; break; }
    }
    // Boss 低血加速：失血越多追得越凶
    const speed = this.isBoss
      ? this.def.speed * (1 + (1 - this.hp / this.maxHp) * 0.6) * auraMul
      : this.def.speed * auraMul;

    // charger AI：进入射程先亮白蓄力，再三倍速冲刺
    if (this.def.aiType === 'charger') {
      const cd = this.def.chargeCdMs ?? 3200;
      if (this.chargeState === 'windup') {
        body.setVelocity(0, 0);
        this.anim?.update(deltaMs);
        if (nowMs >= this.windupUntil) {
          this.chargeState = 'idle';
          this.startCharge(dx / len, dy / len, 450, (this.def.chargeSpeedMul ?? 3) * speed);
        }
        return;
      }
      if (nowMs >= this.chargeNextAt && len < (this.def.chargeRange ?? 260)) {
        this.chargeState = 'windup';
        this.windupUntil = nowMs + 450;
        this.chargeNextAt = nowMs + cd;
        this.setTintFill(0xffffff);
        this.scene.time.delayedCall(450, () => { if (this.active) this.restoreTint(); });
      }
    }

    // ranged AI：超出射程逼近、过近后撤、中距站桩抬手开火
    if (this.def.aiType === 'ranged') {
      const standoff = this.def.standoff ?? 160;
      const range = this.def.shootRange ?? 300;
      if (len > range) {
        body.setVelocity((dx / len) * speed, (dy / len) * speed);
      } else if (len < standoff) {
        body.setVelocity((-dx / len) * speed * 0.7, (-dy / len) * speed * 0.7);
      } else {
        body.setVelocity(0, 0);
        if (nowMs >= this.shootNextAt) {
          this.shootNextAt = nowMs + (this.def.shootCdMs ?? 2600);
          this.setTintFill(0xffe8a0);
          this.scene.time.delayedCall(350, () => {
            if (!this.active) return;
            this.restoreTint();
            eventBus.emit(GameEvents.EnemyShot, {
              x: this.x, y: this.y,
              dx: this.target.x - this.x, dy: this.target.y - this.y,
              speed: this.def.shotSpeed ?? 170,
              damage: Math.max(1, Math.round(this.contactDamage * 0.8)),
              tex: this.def.shotTex,
            });
          });
        }
      }
      this.setFlipX(dx < 0);
      this.anim?.update(deltaMs);
      return;
    }

    // weave：垂直于追击方向的正弦飘移（幽灵/魔典的漂浮感）
    let vx = (dx / len) * speed;
    let vy = (dy / len) * speed;
    if (this.def.weave) {
      const w = Math.sin(nowMs / 380 + this.x * 0.05) * this.def.weave;
      vx += (-dy / len) * w;
      vy += (dx / len) * w;
    }
    // hover：纵向悬浮，速度振幅按 1.4s 周期折算成位置振幅 hoverPx
    if (this.def.hoverPx) {
      vy += Math.cos((nowMs / 1400) * Math.PI * 2 + this.hoverPhase) * this.def.hoverPx * 4.49;
    }
    body.setVelocity(vx, vy);
    this.setFlipX(dx < 0);
    // 出生淡入 + 幽灵感透明脉动；无敌闪白期不覆盖 alpha
    const fade = Math.min(1, (nowMs - this.spawnAtMs) / 160);
    if ((fade < 1 || this.def.alphaPulse) && nowMs >= this.invulnUntil) {
      let a = (this.def.alpha ?? 1) * fade;
      if (this.def.alphaPulse) a += Math.sin(nowMs / 620 + this.hoverPhase) * this.def.alphaPulse;
      this.setAlpha(Math.max(0.12, a));
    }
    // 随水平速度侧倾（飞行单位压弯感）
    if (this.def.lean) this.rotation = (vx / (speed || 1)) * this.def.lean;
    this.anim?.update(deltaMs);
    if (this.isBoss) {
      // 呼吸感：轻微缩放脉动
      this.setScale(this.baseScale * (1 + Math.sin(nowMs / 450) * 0.045));
      // 阶段转换：血线触发短暂无敌 + 广播召唤增援
      const phases = this.def.phases;
      if (phases && this.phaseIdx < phases.length) {
        const ph = phases[this.phaseIdx];
        if (this.hp <= this.maxHp * ph.atHpPct) {
          this.phaseIdx += 1;
          this.invulnUntil = nowMs + 2500;
          this.setTintFill(0xffffff);
          this.setAlpha(0.6);
          eventBus.emit(GameEvents.BossPhase, { enemy: this, phase: ph });
        }
      }
      if (this.invulnUntil > 0 && nowMs >= this.invulnUntil) {
        this.invulnUntil = 0;
        this.setAlpha(1);
        this.clearTint();
      }
    }
  }

  /** 同一伤害源在 intervalMs 内只能命中一次（环绕/光环类武器用） */
  canBeHitBy(sourceId: string, nowMs: number, intervalMs: number): boolean {
    const next = this.hitCooldowns.get(sourceId) ?? -Infinity;
    if (nowMs < next) return false;
    this.hitCooldowns.set(sourceId, nowMs + intervalMs);
    return true;
  }

  /** weaponId 供护符/羁绊联动判定（护符/DOT 伤害传 undefined 不再触发）；crit 供暴击飘字/粒子 */
  takeDamage(dmg: number, weaponId?: string, crit = false): void {
    if (this.dormant) this.wake();
    if (!this.active) return;
    // 阶段转换无敌期免疫伤害
    if (this.scene.time.now < this.invulnUntil) return;
    // damageCap：单次命中最多掉这么多血（Boss 防秒杀）
    const applied = this.def.damageCap ? Math.min(dmg, this.def.damageCap) : dmg;
    this.hp -= applied;
    eventBus.emit(GameEvents.EnemyDamaged, { enemy: this, dmg: applied, x: this.x, y: this.y, weaponId, crit });
    if (this.hp <= 0) {
      this.die();
    } else {
      this.setTintFill(0xffffff);
      this.scene.time.delayedCall(60, () => {
        if (!this.active) return;
        this.restoreTint();
      });
    }
  }

  /** 中毒：每秒 dps，持续 durationMs（重复施加刷新时长） */
  applyDot(dps: number, durationMs: number): void {
    if (!this.active) return;
    this.dotDps = Math.max(this.dotDps, dps);
    this.dotUntil = this.scene.time.now + durationMs;
    this.nextDotAt = Math.min(this.nextDotAt || Infinity, this.scene.time.now + 400);
  }

  /** 击退：从 (x,y) 往外推，Boss 只吃 25% 力度 */
  applyKnockback(fromX: number, fromY: number, power: number): void {
    if (!this.active) return;
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const k = (this.isBoss ? 0.25 : 1) * power;
    this.kbVelX = (dx / len) * k;
    this.kbVelY = (dy / len) * k;
    this.kbUntil = this.scene.time.now + 180;
  }

  /** 冲锋：给定方向/速度冲 durationMs，期间不被击退/追击覆盖（charger 与 Boss 技能共用） */
  startCharge(dirX: number, dirY: number, durationMs: number, speed: number): void {
    this.chargeVx = dirX * speed;
    this.chargeVy = dirY * speed;
    this.chargeUntil = this.scene.time.now + durationMs;
  }

  /** 冰冻定身：Boss 抗性（时长仅 15%） */
  applyFreeze(durationMs: number): void {
    if (!this.active) return;
    const ms = this.isBoss ? durationMs * 0.15 : durationMs;
    this.frozenUntil = Math.max(this.frozenUntil, this.scene.time.now + ms);
    this.setTint(0x9adfff);
  }

  private restoreTint(): void {
    if (this.frozenUntil > this.scene.time.now) {
      this.setTint(0x9adfff);
      return;
    }
    if (this.isElite) this.setTint(0xffb070);
    else this.clearTint();
  }

  private die(): void {
    eventBus.emitEnemyKilled({
      enemy: this,
      x: this.x,
      y: this.y,
      xpValue: this.xpValue,
      isElite: this.isElite,
      isBoss: this.isBoss,
    });
    this.setActive(false);
    this.setVisible(false);
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
    if (this.auraZone) {
      const i = Enemy.auraZones.indexOf(this.auraZone);
      if (i >= 0) Enemy.auraZones.splice(i, 1);
      this.auraZone = undefined;
    }
  }

  /** 炸弹/机制直接清怪时也走 die() 保证掉落和计数一致 */
  killSilent(): void {
    this.die();
  }
}
