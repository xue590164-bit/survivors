import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { DamageZone } from '../DamageZone';
import { Depths } from '../../config';

const BASE_RADIUS = 75;
const HIT_INTERVAL_MS = 500;

/** 三层瘴气云碟：大小/转速/方向交错，最外层贴判定圈边缘 */
const DISCS = [
  { rad: 0.55, spd: 0.5, alpha: 0.6, wob: 0.06 },
  { rad: 0.78, spd: -0.3, alpha: 0.42, wob: 0.08 },
  { rad: 0.98, spd: 0.18, alpha: 0.28, wob: 0.1 },
] as const;

interface Mist {
  img: Phaser.GameObjects.Image;
  rad: number;
  spd: number;
  alpha: number;
  wob: number;
  ph: number;
}

/** 光环类武器：判定圈 + 三层反向旋转的不规则云碟（毒气感）+ 冒泡粒子 */
export class AuraBehavior extends WeaponBehavior {
  private zone!: DamageZone;
  private group: Phaser.Physics.Arcade.Group;
  private mists: Mist[] = [];
  private lastTick = 0;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({
      classType: DamageZone,
      runChildUpdate: false,
    });
    ctx.combat.registerZoneGroup(this.group, HIT_INTERVAL_MS);
    const z = this.group.get() as DamageZone;
    z.activate(ctx.player.x, ctx.player.y, 'tex_zone', `aura_${def.id}`, this.effDamage(), def.id);
    z.setTint(def.color).setAlpha(0.12);
    this.zone = z;

    DISCS.forEach((d, i) => {
      const img = ctx.scene.add
        .image(ctx.player.x, ctx.player.y, 'fx_mist')
        .setTint(def.color)
        .setAlpha(d.alpha)
        .setRotation(Math.random() * Math.PI * 2)
        .setDepth(Depths.Enemy - 2 + i * 0.1);
      this.mists.push({ img, ...d, ph: Math.random() * Math.PI * 2 });
    });
  }

  protected fire(_nowMs: number): void {
    this.zone.damage = this.effDamage();
    const scale = (BASE_RADIUS * this.effArea()) / (this.zone.width / 2);
    this.zone.setScale(scale);
    const body = this.zone.body as Phaser.Physics.Arcade.Body;
    body.setCircle(this.zone.width / 2);
  }

  protected tick(nowMs: number): void {
    if (!this.zone.active) return;
    const dt = this.lastTick > 0 ? Math.min((nowMs - this.lastTick) / 1000, 0.1) : 0.016;
    this.lastTick = nowMs;
    const px = this.ctx.player.x;
    const py = this.ctx.player.y;
    const radius = BASE_RADIUS * this.effArea();

    this.zone.setPosition(px, py);
    (this.zone.body as Phaser.Physics.Arcade.Body).reset(px, py);
    this.zone.setAlpha(0.08 + Math.sin(nowMs / 500) * 0.05);

    // 云碟：反向低速旋转 + 中心游走 + 缩放/透明度呼吸
    for (const m of this.mists) {
      m.img.setRotation(m.img.rotation + m.spd * dt);
      const breathe = 1 + Math.sin(nowMs / 620 + m.ph) * m.wob;
      m.img.setScale(((radius * 2 * m.rad) / 96) * breathe);
      m.img.setAlpha(m.alpha * (0.82 + Math.sin(nowMs / 800 + m.ph) * 0.18));
      m.img.setPosition(
        px + Math.cos(nowMs / 1400 + m.ph) * radius * 0.06,
        py + Math.sin(nowMs / 1400 + m.ph) * radius * 0.06,
      );
    }

    this.ctx.particles?.auraEmit(px, py, radius);
  }

  destroy(): void {
    this.group.destroy(true);
    for (const m of this.mists) m.img.destroy();
    this.mists.length = 0;
  }
}
