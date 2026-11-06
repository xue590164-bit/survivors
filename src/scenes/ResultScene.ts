import Phaser from 'phaser';
import { SceneKeys, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { makeButton } from '../ui/button';
import { txt } from '../ui/text';
import { UI, parchmentPanel } from '../ui/theme';
import type { RunResult } from '../types';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export class ResultScene extends Phaser.Scene {
  private result!: RunResult;

  constructor() {
    super(SceneKeys.Result);
  }

  init(data: RunResult): void {
    this.result = data;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.colors.bgDeep);
    const r = this.result;

    txt(this, GAME_WIDTH / 2, 150, r.won ? '胜 利' : '阵 亡', {
        fontSize: '52px',
        color: r.won ? UI.text.ok : UI.text.danger,
      })
      .setOrigin(0.5);

    parchmentPanel(this, GAME_WIDTH / 2 - 190, GAME_HEIGHT / 2 - 130, 380, 210);

    const lines = [
      `存活时间   ${fmt(r.timeSec)}`,
      `击杀数     ${r.kills}`,
      `等级       Lv.${r.level}`,
      `获得金币   ${r.goldEarned}`,
    ];
    if (r.endlessDepth && r.endlessDepth > 0) {
      lines.splice(2, 0, `无尽讨伐   ${r.endlessDepth} 波`);
    }
    txt(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, lines.join('\n'), {
        fontSize: '22px',
        color: UI.text.ink,
        lineSpacing: 14,
        align: 'left',
      })
      .setOrigin(0.5);

    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 140, '再来一局', () => {
      this.scene.start(SceneKeys.CharSelect);
    });
    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 70, '回主菜单', () => {
      this.scene.start(SceneKeys.MainMenu);
    });
  }
}
