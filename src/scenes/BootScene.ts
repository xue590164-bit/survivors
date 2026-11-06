import Phaser from 'phaser';
import { SceneKeys } from '../config';
import { initRegistry } from '../core/DataRegistry';
import { SPRITES } from '../art/sprites';
import { soundSystem } from '../systems/SoundSystem';

/** 启动场景：加载全部 JSON 数据 + 程序生成像素纹理，然后进主菜单 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  preload(): void {
    this.load.json('characters', 'data/characters.json');
    this.load.json('weapons', 'data/weapons.json');
    this.load.json('passives', 'data/passives.json');
    this.load.json('charms', 'data/charms.json');
    this.load.json('bonds', 'data/bonds.json');
    this.load.json('enemies', 'data/enemies.json');
    this.load.json('stages', 'data/stages.json');
    this.load.json('metaUpgrades', 'data/metaUpgrades.json');
    this.load.json('pickups', 'data/pickups.json');
    this.load.json('buildings', 'data/buildings.json');
  }

  create(): void {
    initRegistry(this.cache);
    this.generateTextures();
    soundSystem.attach(this);
    this.scene.start(SceneKeys.MainMenu);
  }

  private generateTextures(): void {
    const g = this.make.graphics({}, false);

    // 地块：64px 草地噪点，明暗两块交错 + 草屑，弱边缘保持位移可读性
    g.fillStyle(0x1a3020, 1).fillRect(0, 0, 64, 64);
    g.fillStyle(0x172a1c, 1).fillRect(0, 0, 32, 32).fillRect(32, 32, 32, 32);
    for (let i = 0; i < 14; i++) {
      g.fillStyle(Phaser.Math.RND.pick([0x234029, 0x1f3a26, 0x2a4a30]), 1);
      g.fillRect(Phaser.Math.Between(1, 60), Phaser.Math.Between(1, 60), Phaser.Math.Between(2, 4), 2);
    }
    for (let i = 0; i < 4; i++) {
      g.fillStyle(0x14301a, 1);
      g.fillRect(Phaser.Math.Between(2, 58), Phaser.Math.Between(2, 58), 2, 5);
    }
    g.generateTexture('tile', 64, 64);
    g.clear();

    // 古堡石板：64px 深灰砖块，砖缝线+磨损斑块
    g.fillStyle(0x232030, 1).fillRect(0, 0, 64, 64);
    g.fillStyle(0x1e1a28, 1).fillRect(0, 0, 32, 32).fillRect(32, 32, 32, 32);
    g.fillStyle(0x161220, 1);
    g.fillRect(0, 0, 64, 2).fillRect(0, 32, 64, 2);
    g.fillRect(0, 0, 2, 32).fillRect(32, 32, 2, 32);
    for (let i = 0; i < 8; i++) {
      g.fillStyle(Phaser.Math.RND.pick([0x2a2540, 0x1a1626, 0x302a44]), 1);
      g.fillRect(Phaser.Math.Between(4, 58), Phaser.Math.Between(4, 58), Phaser.Math.Between(2, 4), 2);
    }
    g.generateTexture('tile_castle', 64, 64);
    g.clear();

    // 沙漠：64px 黄沙，交错明暗 + 风蚀纹 + 细砾
    g.fillStyle(0xc8a050, 1).fillRect(0, 0, 64, 64);
    g.fillStyle(0xbd964a, 1).fillRect(0, 0, 32, 32).fillRect(32, 32, 32, 32);
    for (let i = 0; i < 10; i++) {
      g.fillStyle(Phaser.Math.RND.pick([0xd8b060, 0xb08c44, 0xc0a058]), 1);
      g.fillRect(Phaser.Math.Between(1, 58), Phaser.Math.Between(1, 60), Phaser.Math.Between(4, 9), 2);
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle(0xa8843c, 1);
      g.fillRect(Phaser.Math.Between(2, 60), Phaser.Math.Between(2, 60), 2, 2);
    }
    g.generateTexture('tile_desert', 64, 64);
    g.clear();

    // 通用范围区纹理（光环/伤害区共用，白色圆，使用时 tint）
    g.fillStyle(0xffffff, 1).fillCircle(64, 64, 63);
    g.generateTexture('tex_zone', 128, 128);
    g.clear();

    // 瘴气云团：多块半透明斑叠出不规则云轮廓+内部浓淡（tint 复用）
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 28;
      const cx = 48 + Math.cos(a) * r;
      const cy = 48 + Math.sin(a) * r;
      g.fillStyle(0xffffff, 0.2 + Math.random() * 0.45);
      g.fillCircle(cx, cy, 5 + Math.random() * 15);
    }
    g.fillStyle(0xffffff, 0.55).fillCircle(48, 48, 14);
    g.generateTexture('fx_mist', 96, 96);
    g.clear();

    // 逐像素精灵（含序列帧 _f1/_f2...）
    const drawRows = (rows: string[], palette: Record<string, number>, key: string) => {
      g.clear();
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === '.') continue;
          g.fillStyle(palette[ch] ?? 0xff00ff, 1);
          g.fillRect(x, y, 1, 1);
        }
      });
      g.generateTexture(key, rows[0].length, rows.length);
    };
    for (const s of SPRITES) {
      drawRows(s.rows, s.palette, s.key);
      s.extraFrames?.forEach((fr, i) => drawRows(fr, s.palette, `${s.key}_f${i + 1}`));
    }

    g.destroy();
  }
}
