import Phaser from 'phaser';
import { Depths } from '../config';

const WALK_FRAMES = ['tex_minion_skeleton', 'tex_minion_skeleton_f1'];
const ATTACK_FRAME = 'tex_minion_skeleton_f2';
const WALK_INTERVAL_MS = 170;
const ATTACK_HOLD_MS = 260;

/**
 * 召唤仆从：自动索敌扑咬，可被击杀，由 SummonBehavior 管理重生。
 * 索敌/归位移动由行为每帧驱动，这里只承载状态 + 行走/攻击帧动画。
 */
export class Minion extends Phaser.Physics.Arcade.Sprite {
  hp = 1;
  maxHp = 1;
  damage = 1;
  sourceId = '';
  weaponId = '';
  /** 受击冷却（被敌人接触反伤节流） */
  private nextHurtAt = 0;
  private attackUntil = 0;
  private walkAcc = 0;
  private walkIdx = 0;
  private lastAnimAt = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'tex_minion_skeleton');
    this.setDepth(Depths.Player - 1);
    this.setScale(0.85);
  }

  spawn(x: number, y: number, hp: number, damage: number, sourceId: string, weaponId: string): this {
    this.setTexture('tex_minion_skeleton');
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    this.setAlpha(1);
    this.hp = hp;
    this.maxHp = hp;
    this.damage = damage;
    this.sourceId = sourceId;
    this.weaponId = weaponId;
    this.attackUntil = 0;
    this.walkIdx = 0;
    this.lastAnimAt = this.scene.time.now;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    body.setSize(this.width * 0.8, this.height * 0.8);
    return this;
  }

  /** 由 SummonBehavior.tick 每帧驱动：攻击帧优先，否则按移动速度走步帧 */
  tickAnim(nowMs: number, moving: boolean): void {
    if (nowMs < this.attackUntil) return;
    const dt = nowMs - this.lastAnimAt;
    this.lastAnimAt = nowMs;
    if (!moving) {
      if (this.walkIdx !== 0) {
        this.walkIdx = 0;
        this.setTexture(WALK_FRAMES[0]);
      }
      return;
    }
    this.walkAcc += dt;
    if (this.walkAcc >= WALK_INTERVAL_MS) {
      this.walkAcc = 0;
      this.walkIdx ^= 1;
      this.setTexture(WALK_FRAMES[this.walkIdx]);
    }
  }

  /** 接触伤害命中瞬间调用：切扑咬帧一小段时间 */
  playAttack(): void {
    this.attackUntil = this.scene.time.now + ATTACK_HOLD_MS;
    this.setTexture(ATTACK_FRAME);
  }

  /** 敌人接触反伤：400ms 节流 */
  tryHurt(nowMs: number, dmg: number): void {
    if (!this.active || nowMs < this.nextHurtAt) return;
    this.nextHurtAt = nowMs + 400;
    this.hp -= dmg;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => {
      if (this.active) this.clearTint();
    });
    if (this.hp <= 0) this.die();
  }

  private die(): void {
    this.setActive(false);
    this.setVisible(false);
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
  }
}
