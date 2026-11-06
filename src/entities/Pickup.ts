import Phaser from 'phaser';
import type { PickupDef } from '../types';
import { Depths } from '../config';

/** 掉落物：经验宝石/回复/磁铁等。磁吸移动由 PickupSystem 驱动。 */
export class Pickup extends Phaser.Physics.Arcade.Sprite {
  def!: PickupDef;
  value = 0;
  magnetized = false;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, 'tex_pickup_xp_small');
    this.setDepth(Depths.Pickup);
  }

  spawn(def: PickupDef, x: number, y: number): this {
    this.def = def;
    this.value = def.value;
    this.magnetized = false;
    this.setTexture(`tex_${def.id}`);
    this.setScale(1.05);
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    body.setVelocity(0, 0);
    return this;
  }

  addValue(v: number): void {
    this.value += v;
  }

  collect(): void {
    this.setActive(false);
    this.setVisible(false);
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
  }
}
