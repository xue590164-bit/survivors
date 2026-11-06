import Phaser from 'phaser';
import { Depths } from '../config';
import type { Enemy } from './Enemy';

/** 直线弹道：命中计数到 pierce 上限或存活超时就回收 */
export class Projectile extends Phaser.Physics.Arcade.Sprite {
  damage = 1;
  pierce = 0;
  dieAt = 0;
  weaponId = '';
  private hitSet = new Set<Enemy>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'tex_weapon_knife');
    this.setDepth(Depths.Projectile);
  }

  fire(
    x: number, y: number, angle: number, speed: number,
    damage: number, pierce: number, texKey: string, lifespanMs: number,
    nowMs: number, weaponId = '',
  ): this {
    this.setTexture(texKey);
    // 弹道专用贴图(tex_proj_)是小画布，放大一档；武器图标仍按 0.75
    this.setScale(texKey.startsWith('tex_proj_') ? 1.35 : 0.75);
    this.setPosition(x, y);
    this.setRotation(angle);
    this.setActive(true);
    this.setVisible(true);
    this.damage = damage;
    this.pierce = pierce;
    this.weaponId = weaponId;
    this.dieAt = nowMs + lifespanMs;
    this.hitSet.clear();

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    body.setSize(this.width, this.height);
    return this;
  }

  /** 返回 false 表示该敌人已被此弹道命中过（穿透不重复结算） */
  tryHit(enemy: Enemy): boolean {
    if (this.hitSet.has(enemy)) return false;
    this.hitSet.add(enemy);
    return true;
  }

  consumeHit(): void {
    if (this.hitSet.size > this.pierce) this.deactivate();
  }

  /** 清空命中记录（回旋镖回程二次命中用） */
  resetHits(): void {
    this.hitSet.clear();
  }

  deactivate(): void {
    this.setActive(false);
    this.setVisible(false);
    if (this.body) (this.body as Phaser.Physics.Arcade.Body).enable = false;
  }
}
