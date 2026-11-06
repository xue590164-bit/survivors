import Phaser from 'phaser';
import { Depths } from '../config';

/**
 * 持续伤害源（环绕体/光环脉冲共用载体）。
 * 命中节流走 Enemy.hitCooldowns，key = sourceId。
 */
export class DamageZone extends Phaser.Physics.Arcade.Sprite {
  damage = 1;
  sourceId = '';
  /** 所属武器 id，供护符联动判定 */
  weaponId = '';
  /** 命中时把敌人从 zone 中心往外推的力度（0=无击退） */
  knockback = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'tex_zone');
    this.setDepth(Depths.Projectile);
    this.setAlpha(0.55);
  }

  activate(x: number, y: number, texKey: string, sourceId: string, damage: number, weaponId = ''): this {
    this.setTexture(texKey);
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    this.damage = damage;
    this.sourceId = sourceId;
    this.weaponId = weaponId;
    this.knockback = 0;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    body.setVelocity(0, 0);
    return this;
  }

  deactivate(): void {
    this.setActive(false);
    this.setVisible(false);
    if (this.body) (this.body as Phaser.Physics.Arcade.Body).enable = false;
  }
}
