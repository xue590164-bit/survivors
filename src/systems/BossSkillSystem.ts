import Phaser from 'phaser';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { BossSkillDef } from '../types';
import { telegraphCircle as telegraphCircleFx } from './Telegraph';
import type { SpawnDirector } from './SpawnDirector';
import type { ParticleSystem } from './ParticleSystem';

const TELEGRAPH_COLOR = 0xe04030;

interface BossState {
  nextAt: number[];
}

/**
 * Boss 技能引擎：按 def.skills 数据驱动调度，全部技能带预警可躲。
 * 预警统一用 Graphics 画圈/扇形，到点后一次性判定玩家是否在范围内。
 */
export class BossSkillSystem {
  private states = new Map<Enemy, BossState>();
  private fx: Phaser.GameObjects.Graphics[] = [];

  constructor(
    private scene: Phaser.Scene,
    private player: Player,
    private director: SpawnDirector,
    private particles: ParticleSystem,
  ) {}

  register(boss: Enemy): void {
    if (!boss.def.skills?.length) return;
    this.states.set(boss, {
      // 出场后 2.5s 才开始放技能，给玩家反应时间
      nextAt: boss.def.skills.map((_, i) => this.scene.time.now + 2500 + i * 900),
    });
  }

  unregister(boss: Enemy): void {
    this.states.delete(boss);
  }

  update(): void {
    const now = this.scene.time.now;
    for (const [boss, st] of this.states) {
      if (!boss.active) continue;
      const skills = boss.def.skills!;
      skills.forEach((sk, i) => {
        if (now < st.nextAt[i]) return;
        st.nextAt[i] = now + sk.cooldownMs;
        this.cast(boss, sk);
      });
    }
  }

  private cast(boss: Enemy, sk: BossSkillDef): void {
    switch (sk.type) {
      case 'charge': {
        const windup = sk.windupMs ?? 700;
        boss.setTintFill(0xffd0a0);
        this.scene.time.delayedCall(windup, () => {
          if (!boss.active) return;
          boss.clearTint();
          const dx = this.player.x - boss.x;
          const dy = this.player.y - boss.y;
          const len = Math.hypot(dx, dy) || 1;
          const baseDmg = boss.contactDamage;
          boss.contactDamage = Math.round(baseDmg * (sk.dmgMul ?? 1.5));
          boss.startCharge(dx / len, dy / len, sk.durationMs ?? 520, boss.def.speed * (sk.speedMul ?? 5));
          this.scene.time.delayedCall(sk.durationMs ?? 520, () => {
            if (boss.active) boss.contactDamage = baseDmg;
          });
        });
        break;
      }
      case 'nova': {
        this.telegraphCircle(boss.x, boss.y, sk.radius, sk.telegraphMs ?? 800, sk.color ?? TELEGRAPH_COLOR, () => {
          const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, boss.x, boss.y);
          if (d <= sk.radius) this.player.takeDamage(sk.damage, this.scene.time.now);
          this.particles.shake(200, 0.006);
        });
        break;
      }
      case 'volley': {
        const spread = sk.spread ?? 170;
        for (let i = 0; i < sk.count; i++) {
          const tx = this.player.x + Phaser.Math.Between(-spread, spread);
          const ty = this.player.y + Phaser.Math.Between(-spread, spread);
          const delay = (sk.telegraphMs ?? 900) + i * 120;
          this.telegraphCircle(tx, ty, sk.radius, delay, sk.color ?? TELEGRAPH_COLOR, () => {
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, tx, ty);
            if (d <= sk.radius) this.player.takeDamage(sk.damage, this.scene.time.now);
          });
        }
        break;
      }
      case 'summon': {
        this.director.spawnRing(sk.enemyId, boss.x, boss.y, sk.count, sk.radius ?? 160);
        break;
      }
      case 'leap': {
        // 锁定当前玩家位置：预警圈 → Boss 快速位移过去 → 落地 AoE
        const tx = this.player.x;
        const ty = this.player.y;
        const windup = sk.windupMs ?? 900;
        this.telegraphCircle(tx, ty, sk.radius, windup, sk.color ?? TELEGRAPH_COLOR, () => {
          const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, tx, ty);
          if (d <= sk.radius) this.player.takeDamage(sk.damage, this.scene.time.now);
          this.particles.shake(280, 0.008);
        });
        this.scene.time.delayedCall(windup * 0.7, () => {
          if (!boss.active) return;
          const dx = tx - boss.x;
          const dy = ty - boss.y;
          const len = Math.hypot(dx, dy) || 1;
          // 位移耗时 = 预警剩余时间，保证落地和判定同时
          boss.startCharge(dx / len, dy / len, windup * 0.3, len / (windup * 0.3 / 1000));
        });
        break;
      }
    }
  }

  /** 预警圈：描边圆 + 内圈填充渐强（共享实现见 Telegraph.ts），fx 跟踪用于 destroy */
  private telegraphCircle(x: number, y: number, r: number, ms: number, color: number, onFire: () => void): void {
    const g = telegraphCircleFx(this.scene, x, y, r, ms, color, () => {
      const i = this.fx.indexOf(g);
      if (i >= 0) this.fx.splice(i, 1);
      onFire();
    });
    this.fx.push(g);
  }

  destroy(): void {
    for (const g of this.fx) g.destroy();
    this.fx.length = 0;
    this.states.clear();
  }
}
