import Phaser from 'phaser';
import { SceneKeys, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { achievements } from '../systems/AchievementSystem';
import { makeButton } from '../ui/button';
import { txt } from '../ui/text';
import { UI, ribbonBanner } from '../ui/theme';
import type { AchievementDef } from '../types';

const ROW_H = 56;
const LIST_TOP = 150;
const LIST_BOT = GAME_HEIGHT - 90;

/** 成就总览：滚动列表，解锁打✓，未解锁显进度条 */
export class AchievementsScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Achievements);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.colors.bgDeep);
    ribbonBanner(this, GAME_WIDTH / 2, 60, '成 就', { width: 300 });

    const defs = achievements.list();
    const done = defs.filter((d) => achievements.progress(d).done).length;
    txt(this, GAME_WIDTH / 2, 108, `${done} / ${defs.length} 已解锁`, {
      fontSize: '15px',
      color: UI.text.gold,
    }).setOrigin(0.5);

    const list = this.add.container(0, 0);
    const maskG = this.add.graphics().fillStyle(0xffffff).fillRect(0, LIST_TOP, GAME_WIDTH, LIST_BOT - LIST_TOP);
    list.setMask(maskG.createGeometryMask());

    defs.forEach((d, i) => {
      list.add(this.makeRow(d, GAME_WIDTH / 2, i * ROW_H + ROW_H / 2));
    });

    // 滚动：滚轮 + 拖拽
    const totalH = defs.length * ROW_H;
    const maxScroll = Math.max(0, totalH - (LIST_BOT - LIST_TOP));
    let scroll = 0;
    const apply = () => {
      scroll = Phaser.Math.Clamp(scroll, 0, maxScroll);
      list.y = LIST_TOP - scroll;
    };
    this.input.on('wheel', (_p: unknown, _o: unknown, _x: number, _y: number, dy: number) => {
      scroll += dy * 0.5;
      apply();
    });
    let dragY: number | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y > LIST_TOP && p.y < LIST_BOT) dragY = p.y + scroll;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (dragY !== null && p.isDown) {
        scroll = dragY - p.y;
        apply();
      }
    });
    this.input.on('pointerup', () => (dragY = null));

    // 右侧滚动条
    if (maxScroll > 0) {
      const barG = this.add.graphics().setDepth(10);
      const trackH = LIST_BOT - LIST_TOP;
      const thumbH = Math.max(40, trackH * (trackH / totalH));
      const redraw = () => {
        barG.clear();
        barG.fillStyle(0x141008, 0.7).fillRect(GAME_WIDTH - 18, LIST_TOP, 8, trackH);
        barG.fillStyle(UI.colors.goldDim, 0.9)
          .fillRect(GAME_WIDTH - 18, LIST_TOP + (scroll / maxScroll) * (trackH - thumbH), 8, thumbH);
      };
      redraw();
      this.events.on('update', redraw);
    }

    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 45, '返回', () => {
      this.scene.start(SceneKeys.MainMenu);
    }, { width: 200 });
  }

  private makeRow(d: AchievementDef, cx: number, y: number): Phaser.GameObjects.Container {
    const { cur, done } = achievements.progress(d);
    const c = this.add.container(cx, y);
    const w = 640;

    // 底板
    const bg = this.add.rectangle(0, 0, w, ROW_H - 8, done ? 0x2a2410 : 0x141008, 0.9)
      .setStrokeStyle(1, done ? UI.colors.gold : UI.colors.goldDim, done ? 1 : 0.5);
    c.add(bg);

    // 状态章
    const stamp = txt(this, -w / 2 + 30, 0, done ? '✓' : '?', {
      fontSize: '22px',
      color: done ? '#ffd700' : '#554d40',
    }).setOrigin(0.5);
    c.add(stamp);

    // 名称 + 描述
    c.add(txt(this, -w / 2 + 58, -12, d.name, {
      fontSize: '16px',
      color: done ? UI.text.gold : UI.text.body,
    }).setOrigin(0, 0.5));
    c.add(txt(this, -w / 2 + 58, 10, d.unlockDesc ? `${d.desc} · ${d.unlockDesc}` : d.desc, {
      fontSize: '11px',
      color: UI.text.dim,
    }).setOrigin(0, 0.5));

    // 进度条 + 数字
    const pw = 150;
    const ratio = Math.min(1, cur / d.threshold);
    const pg = this.add.graphics();
    pg.fillStyle(0x241a10, 1).fillRect(w / 2 - pw - 70, -4, pw, 8);
    pg.fillStyle(done ? 0xffd700 : 0x8a6f3f, 1).fillRect(w / 2 - pw - 70, -4, pw * ratio, 8);
    pg.lineStyle(1, UI.colors.goldDim, 0.6).strokeRect(w / 2 - pw - 70, -4, pw, 8);
    c.add(pg);
    c.add(txt(this, w / 2 - 60, 0, `${cur}/${d.threshold}`, {
      fontSize: '11px',
      color: UI.text.dim,
    }).setOrigin(0, 0.5));
    if (d.rewardGold > 0) {
      c.add(txt(this, w / 2 - 8, 0, `+${d.rewardGold}`, {
        fontSize: '11px',
        color: done ? UI.text.gold : UI.text.dim,
      }).setOrigin(1, 0.5));
    }
    return c;
  }
}
