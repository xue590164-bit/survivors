import Phaser from 'phaser';
import { WeaponBehavior, type WeaponContext } from './WeaponBehavior';
import type { WeaponDef } from '../../types';
import { Minion } from '../Minion';
import type { Enemy } from '../Enemy';

const MINION_SPEED = 235;
const AGGRO_RANGE = 330;  // 围绕玩家的索敌半径（超出就归位）
const ORBIT_DIST = 52;
const RESPAWN_MS = 4000;

/** 召唤类武器：仆从环绕待命→索敌扑咬→可被打死→冷却后重生（机制强→单击伤害最低档） */
export class SummonBehavior extends WeaponBehavior {
  private group: Phaser.Physics.Arcade.Group;
  /** 已死仆从的重生时刻表（长度=在排队的尸体数） */
  private respawnAt: number[] = [];
  private spawnSeq = 0;

  constructor(ctx: WeaponContext, def: WeaponDef) {
    super(ctx, def);
    this.group = ctx.scene.physics.add.group({ classType: Minion, runChildUpdate: false });
    ctx.combat.registerMinionGroup(this.group);
  }

  private minionHp(): number {
    return this.lv.minionHp ?? Math.round(24 + this.level * 14);
  }

  protected fire(nowMs: number): void {
    // 尸体数（group.get 懒创建，inactive 的都是被打死过的）
    const dead = (this.group.getChildren() as Minion[]).filter((m) => !m.active).length;
    while (this.respawnAt.length < dead) this.respawnAt.push(nowMs + RESPAWN_MS);
    if (this.respawnAt.length > dead) this.respawnAt.length = dead;
    // 到期的释放位置，交给补编循环立刻重召
    this.respawnAt = this.respawnAt.filter((t) => t > nowMs);
    while (
      this.group.countActive(true) + this.respawnAt.length < this.effProjectiles()
      && this.spawnMinion()
    ) { /* top up */ }
    for (const m of this.group.getChildren() as Minion[]) {
      if (m.active) m.damage = this.effDamage();
    }
  }

  private spawnMinion(): boolean {
    const m = this.group.get() as Minion | null;
    if (!m) return false;
    const a = Math.random() * Math.PI * 2;
    m.spawn(
      this.ctx.player.x + Math.cos(a) * 30,
      this.ctx.player.y + Math.sin(a) * 30,
      this.minionHp(),
      this.effDamage(),
      `minion_${this.def.id}_${this.spawnSeq++}`,
      this.def.id,
    );
    return true;
  }

  protected tick(nowMs: number): void {
    const px = this.ctx.player.x;
    const py = this.ctx.player.y;
    const minions = this.group.getChildren() as Minion[];

    minions.forEach((m, i) => {
      if (!m.active) return;
      const body = m.body as Phaser.Physics.Arcade.Body;
      // 索敌：玩家 AGGRO 范围内最近的敌人
      let target: Enemy | null = null;
      let best = Infinity;
      for (const e of this.ctx.enemies.getMatching('active', true) as Enemy[]) {
        const dp = (e.x - px) ** 2 + (e.y - py) ** 2;
        if (dp > AGGRO_RANGE * AGGRO_RANGE) continue;
        const dm = (e.x - m.x) ** 2 + (e.y - m.y) ** 2;
        if (dm < best) { best = dm; target = e; }
      }
      let dx: number;
      let dy: number;
      let spd: number;
      if (target) {
        dx = target.x - m.x;
        dy = target.y - m.y;
        spd = MINION_SPEED;
      } else {
        // 归位：绕玩家轨道缓行
        const slot = (i / Math.max(minions.length, 1)) * Math.PI * 2 + nowMs / 1200;
        dx = px + Math.cos(slot) * ORBIT_DIST - m.x;
        dy = py + Math.sin(slot) * ORBIT_DIST - m.y;
        const d = Math.hypot(dx, dy) || 1;
        spd = Math.min(d * 6, MINION_SPEED * 0.8);
      }
      const len = Math.hypot(dx, dy) || 1;
      body.setVelocity((dx / len) * spd, (dy / len) * spd);
      m.setFlipX(dx < 0);
      m.tickAnim(nowMs, spd > 30);
    });
  }

  destroy(): void {
    this.group.destroy(true);
    this.respawnAt.length = 0;
  }
}
