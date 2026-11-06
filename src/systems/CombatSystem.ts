import Phaser from 'phaser';
import { eventBus, GameEvents, type EnemyShotPayload } from '../core/EventBus';
import type { Player } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import type { Projectile } from '../entities/Projectile';
import type { DamageZone } from '../entities/DamageZone';
import type { Pickup } from '../entities/Pickup';
import type { Minion } from '../entities/Minion';

/**
 * 战斗结算中心：统一管理所有 overlap/collider 关系。
 * - 弹道组 → 穿透+单次激活命中集合
 * - 区域组（环绕/光环）→ 敌人侧 per-source 命中冷却
 * - 暴击/折射在这里统一结算（吃玩家属性）
 */
export class CombatSystem {
  private enemyShots: Phaser.Physics.Arcade.Group;

  constructor(
    private scene: Phaser.Scene,
    private player: Player,
    private enemies: Phaser.Physics.Arcade.Group,
    pickups: Phaser.Physics.Arcade.Group,
  ) {
    // 敌方弹道池（ranged 敌人/Boss 弹幕共用）：小日炎弹，命中即消
    this.enemyShots = scene.physics.add.group({ maxSize: 80 });
    scene.physics.add.overlap(player, this.enemyShots, (_p, s) => {
      const shot = s as Phaser.Physics.Arcade.Image;
      if (!shot.active) return;
      player.takeDamage((shot.getData('dmg') as number) ?? 10, scene.time.now);
      shot.setActive(false).setVisible(false);
    });
    eventBus.on(GameEvents.EnemyShot, this.onEnemyShot, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      eventBus.off(GameEvents.EnemyShot, this.onEnemyShot, this);
    });
    scene.physics.add.overlap(player, enemies, (_p, e) => {
      const enemy = e as Enemy;
      if (!enemy.active) return;
      player.takeDamage(enemy.contactDamage, scene.time.now);
    });

    scene.physics.add.overlap(player, pickups, (_p, pk) => {
      const pickup = pk as Pickup;
      if (!pickup.active) return;
      eventBus.emit(GameEvents.PickupCollected, { pickup });
    });

    // 敌人之间相互推开，避免叠成一团
    scene.physics.add.collider(enemies, enemies);
  }

  /** 弹道组：每发弹道有独立命中集合 + 穿透上限 */
  registerProjectileGroup(group: Phaser.Physics.Arcade.Group): void {
    this.scene.physics.add.overlap(group, this.enemies, (projObj, enemyObj) => {
      const proj = projObj as Projectile;
      const enemy = enemyObj as Enemy;
      if (!proj.active || !enemy.active) return;
      if (!proj.tryHit(enemy)) return;
      this.deal(enemy, proj.damage, proj.weaponId);
      this.rollRicochet(enemy, proj.damage, proj.weaponId);
      proj.consumeHit();
    });
  }

  /** 区域组：同一 sourceId 在 hitIntervalMs 内对同一敌人只结算一次 */
  registerZoneGroup(group: Phaser.Physics.Arcade.Group, hitIntervalMs: number): void {
    this.scene.physics.add.overlap(group, this.enemies, (zoneObj, enemyObj) => {
      const zone = zoneObj as DamageZone;
      const enemy = enemyObj as Enemy;
      if (!zone.active || !enemy.active) return;
      if (!enemy.canBeHitBy(zone.sourceId, this.scene.time.now, hitIntervalMs)) return;
      if (zone.knockback > 0) enemy.applyKnockback(zone.x, zone.y, zone.knockback);
      this.deal(enemy, zone.damage, zone.weaponId);
      this.rollRicochet(enemy, zone.damage, zone.weaponId);
    });
  }

  /** 仆从组：仆从啃咬敌人（每仆从独立命中冷却），同时被敌人反击损耗 */
  registerMinionGroup(group: Phaser.Physics.Arcade.Group): void {
    this.scene.physics.add.overlap(group, this.enemies, (mObj, enemyObj) => {
      const m = mObj as Minion;
      const enemy = enemyObj as Enemy;
      if (!m.active || !enemy.active) return;
      const now = this.scene.time.now;
      if (enemy.canBeHitBy(m.sourceId, now, 350)) {
        this.deal(enemy, m.damage, m.weaponId);
        m.playAttack();
      }
      m.tryHurt(now, Math.max(1, enemy.contactDamage * 0.5));
    });
  }

  /** 敌方开火落池：从弹点向玩家方向直线飞行，4s 自熄 */
  private onEnemyShot(p: EnemyShotPayload): void {
    const len = Math.hypot(p.dx, p.dy) || 1;
    const s = this.enemyShots.get(p.x, p.y, p.tex ?? 'tex_proj_sun') as Phaser.Physics.Arcade.Image | null;
    if (!s) return;
    s.setActive(true).setVisible(true);
    s.setData('dmg', p.damage);
    s.setScale(1.6).setRotation(Math.atan2(p.dy, p.dx));
    (s.body as Phaser.Physics.Arcade.Body).setVelocity((p.dx / len) * p.speed, (p.dy / len) * p.speed);
    this.scene.time.delayedCall(4000, () => { if (s.active) { s.setActive(false); s.setVisible(false); } });
  }

  /** 暴击：critPct 概率 ×2；返回最终伤害与是否暴击（供飘字/粒子区分） */
  private rollDamage(dmg: number): { dmg: number; crit: boolean } {
    const crit = Math.random() < this.player.stats.critPct;
    return { dmg: crit ? dmg * 2 : dmg, crit };
  }

  /** 统一伤害出口：暴击标志随伤害一起传给 takeDamage → 事件载荷 */
  private deal(enemy: Enemy, dmg: number, weaponId?: string): void {
    const r = this.rollDamage(dmg);
    enemy.takeDamage(r.dmg, weaponId, r.crit);
  }

  /** 折射镜被动：命中后概率把 50% 伤害弹到附近另一个敌人（不吃护符，直接结算） */
  private rollRicochet(hit: Enemy, dmg: number, weaponId: string): void {
    const chance = this.player.stats.ricochetPct;
    if (chance <= 0 || Math.random() >= chance) return;
    const px = hit.x;
    const py = hit.y;
    let best: Enemy | null = null;
    let bestD = 240 * 240;
    for (const e of this.enemies.getMatching('active', true) as Enemy[]) {
      if (e === hit) continue;
      const d = (e.x - px) ** 2 + (e.y - py) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    best?.takeDamage(dmg * 0.5, weaponId);
  }
}
