import Phaser from 'phaser';
import { SceneKeys, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { saveSystem } from '../core/SaveSystem';
import { makeButton } from '../ui/button';
import { txt } from '../ui/text';
import { UI, ribbonBanner } from '../ui/theme';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.MainMenu);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.colors.bgDeep);

    ribbonBanner(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 190, '像素幸存者', { width: 380, fontSize: 30 });
    txt(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, 'S U R V I V O R S', {
        fontSize: '20px',
        color: UI.text.gold,
      })
      .setOrigin(0.5);

    txt(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, `金币: ${saveSystem.gold}`, {
        fontSize: '18px',
        color: UI.text.gold,
      })
      .setOrigin(0.5);

    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, '开始游戏', () => {
      this.scene.start(SceneKeys.CharSelect);
    });
    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 110, '局外成长', () => {
      this.scene.start(SceneKeys.MetaShop);
    });

    txt(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, 'WASD / 方向键移动，武器自动攻击', {
        fontSize: '14px',
        color: UI.text.dim,
      })
      .setOrigin(0.5);
  }
}
