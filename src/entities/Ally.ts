import Phaser from 'phaser';
import { Depths } from '../config';
import { Projectile } from './Projectile';
import type { Player } from './Player';
import type { Enemy } from './Enemy';

const FOLLOW_DIST = 70;
const FOLLOW_SPEED = 210;
const SHOOT_RANGE = 320;
const SHOOT_CD_MS = 1100;
const SHOT_SPEED = 320;

/**
 * 旅人弓箭手（冰原任务永久奖励）：跟随玩家的独立随从。
 * 自动索敌射冰箭，可被敌人啃死（死了就是死了——任务收益有代价）。
 */
export class Ally extends Phaser.Physics.Arcade.Sprite {
  hp = 80;
  maxHp = 80;
  damage = 8;
  private shootNextAt = 0;
  private hurtUntil = 0;

  constructor(
    scene: Phaser.Scene,
    private player: Player,
    private enemies: Phaser.Physics.Arcade.Group,
    /** 已注册进 CombatSystem 的玩家弹道组（冰箭复用命中管线） */
    private shots: Phaser.Physics.Arcade.Group,
  ) {
    super(scene, 0, 0, 'tex_ally_archer');
    this.setDepth(Depths.Player - 1);
    this.setScale(1.1);
  }

  spawnAt(x: number, y: number): this {
    this.setPosition(x, y).setActive(true).setVisible(true).setAlpha(1).clearTint();
    this.hp = this.maxHp;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    body.setSize(this.width * 0.7, this.height * 0.7);
    return this;
  }

  update(nowMs: number): void {
    if (!this.active) return;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const dx = this.player.x - this.x;
    const dy = this.player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    // 跟随：超出距离追，到位停
    if (d > FOLLOW_DIST + 20) {
      body.setVelocity((dx / d) * FOLLOW_SPEED, (dy / d) * FOLLOW_SPEED);
    } else if (d > FOLLOW_DIST) {
      body.setVelocity((dx / d) * FOLLOW_SPEED * 0.5, (dy / d) * FOLLOW_SPEED * 0.5);
    } else {
      body.setVelocity(0, 0);
    }
    this.setFlipX(dx < 0);

    // 索敌开火：最近敌在射程内 → 冰箭
    if (nowMs >= this.shootNextAt) {
      const t = this.nearestEnemy();
      if (t) {
        this.shootNextAt = nowMs + SHOOT_CD_MS;
        const a = Math.atan2(t.y - this.y, t.x - this.x);
        const p = this.shots.get(this.x, this.y, 'tex_proj_ice') as Projectile | null;
        if (p) p.fire(this.x, this.y, a, SHOT_SPEED, this.damage, 1, 'tex_proj_ice', 1600, nowMs, 'ally_archer');
      }
    }
  }

  private nearestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    let bd = SHOOT_RANGE * SHOOT_RANGE;
    for (const e of this.enemies.getMatching('active', true) as Enemy[]) {
      if (e.dormant) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** 敌人接触反伤（CombatSystem 挂碰撞调用） */
  tryHurt(dmg: number): void {
    const now = this.scene.time.now;
    if (now < this.hurtUntil) return;
    this.hurtUntil = now + 400;
    this.hp -= dmg;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(90, () => { if (this.active) this.clearTint(); });
    if (this.hp <= 0) {
      this.setActive(false).setVisible(false);
      (this.body as Phaser.Physics.Arcade.Body).enable = false;
    }
  }
}
