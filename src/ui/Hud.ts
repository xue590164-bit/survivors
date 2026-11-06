import Phaser from 'phaser';
import { Depths, GAME_WIDTH } from '../config';
import { db } from '../core/DataRegistry';
import type { Player } from '../entities/Player';
import type { WeaponManager } from '../systems/WeaponManager';
import type { PassiveManager } from '../systems/PassiveManager';
import type { CharmSystem } from '../systems/CharmSystem';
import type { BondSystem } from '../systems/BondSystem';
import type { BondDef } from '../types';
import type { Enemy } from '../entities/Enemy';
import { txt } from './text';
import { UI } from './theme';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface IconSlot {
  img: Phaser.GameObjects.Image;
  lv: Phaser.GameObjects.Text;
}

/** 局内 HUD：经验条/血条/计时 + 装备·被动·护符图标栏，全部固定屏幕、深色描金底衬 */
export class Hud {
  private g: Phaser.GameObjects.Graphics;
  private infoText: Phaser.GameObjects.Text;
  private timerText: Phaser.GameObjects.Text;
  private bossText: Phaser.GameObjects.Text;
  private weaponIcons: IconSlot[] = [];
  private passiveIcons: IconSlot[] = [];
  private charmIcons: IconSlot[] = [];
  private bondIcons: IconSlot[] = [];
  private iconSig = '';
  private scene: Phaser.Scene;
  private shardText: Phaser.GameObjects.Text;
  private shardImg: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    private player: Player,
    private weapons: WeaponManager,
    private passives: PassiveManager,
    private charms: CharmSystem,
    private bonds: BondSystem,
  ) {
    this.scene = scene;
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(Depths.Hud);
    this.infoText = txt(scene, 16, 30, '', { fontSize: '15px', color: UI.text.body })
      .setScrollFactor(0)
      .setDepth(Depths.Hud + 1);
    this.timerText = txt(scene, GAME_WIDTH / 2, 16, '', { fontSize: '22px', color: UI.text.gold })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(Depths.Hud + 1);
    this.bossText = txt(scene, GAME_WIDTH / 2, 52, '', { fontSize: '14px', color: UI.text.danger })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(Depths.Hud + 1);
    this.shardImg = scene.add.image(288, 48, 'tex_pickup_relic_shard')
      .setScale(1).setScrollFactor(0).setDepth(Depths.Hud + 1).setVisible(false);
    this.shardText = txt(scene, 302, 48, '', { fontSize: '14px', color: UI.text.gold })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(Depths.Hud + 1).setVisible(false);
  }

  update(runSec: number, durationSec: number, kills: number, bosses: Enemy[], timerLabel?: string): void {
    const p = this.player;
    const g = this.g;
    g.clear();

    // ===== XP 条（顶部通栏，描金） =====
    const xpRatio = Phaser.Math.Clamp(p.xp / p.xpToNext, 0, 1);
    g.fillStyle(0x141008, 0.92).fillRect(0, 0, GAME_WIDTH, 12);
    g.fillStyle(UI.colors.gold, 1).fillRect(1, 2, (GAME_WIDTH - 2) * xpRatio, 8);
    g.lineStyle(1, UI.colors.goldDim, 0.8).strokeRect(0, 0, GAME_WIDTH, 12);

    // ===== 左上信息板：暗底金边 + 血条 + Lv/击杀 =====
    g.fillStyle(0x141008, 0.72).fillRoundedRect(8, 20, 262, 56, 4);
    g.lineStyle(1, UI.colors.goldDim, 0.7).strokeRoundedRect(8, 20, 262, 56, 4);
    const hpRatio = Phaser.Math.Clamp(p.hp / p.stats.maxHp, 0, 1);
    g.fillStyle(0x2a120c, 1).fillRect(16, 50, 246, 14);
    g.fillStyle(UI.colors.blood, 1).fillRect(16, 50, 246 * hpRatio, 14);
    g.lineStyle(1, UI.colors.gold, 0.6).strokeRect(16, 50, 246, 14);
    this.infoText.setText(`Lv.${p.level}   HP ${Math.ceil(p.hp)}/${p.stats.maxHp}   击杀 ${kills}`);

    this.timerText.setText(timerLabel ?? `${fmt(runSec)} / ${fmt(durationSec)}`);

    // 神兵残片计数（>0 才显示）
    const shards = p.relicShards;
    this.shardImg.setVisible(shards > 0);
    this.shardText.setVisible(shards > 0);
    if (shards > 0) this.shardText.setText(`×${shards}`);

    // ===== 装备/被动/护符图标栏（变化才重建，省重绘） =====
    const wIds = this.weapons.ownedIds();
    const pIds = this.passives.ownedIds();
    const cIds = this.charms.ownedIds();
    const bIds = this.bonds.activeIds();
    const sig = `${wIds.join(',')}|${pIds.join(',')}|${cIds.join(',')}|${bIds.join(',')}`;
    if (sig !== this.iconSig) {
      this.iconSig = sig;
      this.rebuildIcons(wIds, pIds, cIds, bIds);
    }
    // 等级角标每帧刷（升级不重建图标）
    this.weaponIcons.forEach((s, i) => s.lv.setText(`${this.weapons.levelOf(wIds[i])}`));
    this.passiveIcons.forEach((s, i) => s.lv.setText(`${this.passives.levelOf(pIds[i])}`));

    // ===== Boss 血条（顶部居中） =====
    const boss = bosses.find((b) => b.active && b.isBoss);
    if (boss) {
      const bw = 420;
      const ratio = Phaser.Math.Clamp(boss.hp / boss.maxHp, 0, 1);
      g.fillStyle(0x24100e, 0.9).fillRect(GAME_WIDTH / 2 - bw / 2, 72, bw, 12);
      g.fillStyle(UI.colors.wine, 1).fillRect(GAME_WIDTH / 2 - bw / 2, 72, bw * ratio, 12);
      g.lineStyle(1, UI.colors.gold, 0.7).strokeRect(GAME_WIDTH / 2 - bw / 2, 72, bw, 12);
      this.bossText.setText(`${boss.def.name}   ${Math.ceil(boss.hp)}/${boss.maxHp}`);
    } else {
      this.bossText.setText('');
    }
  }

  /** 图标行：武器(主行)/被动/护符/羁绊四行，图标+右下等级角标 */
  private rebuildIcons(wIds: string[], pIds: string[], cIds: string[], bIds: string[]): void {
    for (const s of [...this.weaponIcons, ...this.passiveIcons, ...this.charmIcons, ...this.bondIcons]) {
      s.img.destroy();
      s.lv.destroy();
    }
    const rows: { ids: string[]; y: number }[] = [
      { ids: wIds, y: 96 },
      { ids: pIds, y: 130 },
      { ids: cIds, y: 164 },
      { ids: bIds, y: 198 },
    ];
    const make = (texId: string, x: number, y: number): IconSlot => ({
      img: this.scene.add.image(x, y, `tex_${texId}`)
        .setScale(1).setScrollFactor(0).setDepth(Depths.Hud + 1),
      lv: txt(this.scene, x + 10, y + 8, '', { fontSize: '11px', color: UI.text.gold })
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(Depths.Hud + 1),
    });
    this.weaponIcons = wIds.map((id, i) => make(id, 26 + i * 34, rows[0].y));
    this.passiveIcons = pIds.map((id, i) => make(id, 26 + i * 34, rows[1].y));
    this.charmIcons = cIds.map((id, i) => make(id, 26 + i * 34, rows[2].y));
    this.bondIcons = bIds.map((id, i) => {
      // 羁绊无专属贴图：用配对武器的图标 + 金色调 + ✦ 角标
      const s = make(this.bondWeaponTex(id) ?? id, 26 + i * 34, rows[3].y);
      s.img.setTint(0xffd870);
      s.lv.setText('✦');
      return s;
    });
  }

  private bondWeaponTex(bondId: string): string | undefined {
    return db().bond(bondId)?.weaponIds[0];
  }

  /** 羁绊激活横幅：金色描边弹出后淡出 */
  announceBond(bond: BondDef): void {
    const t = txt(this.scene, GAME_WIDTH / 2, 150, `✦ 羁绊激活「${bond.name}」\n${bond.desc}`, {
      fontSize: '20px',
      color: UI.text.gold,
      align: 'center',
    })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(Depths.Hud + 2)
      .setScale(0.6)
      .setAlpha(0);
    this.scene.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, alpha: 0, y: 120, delay: 2400, duration: 500, onComplete: () => t.destroy() });
  }
}
