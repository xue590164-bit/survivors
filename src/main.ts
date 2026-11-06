import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config';
import { BootScene } from './scenes/BootScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { MetaShopScene } from './scenes/MetaShopScene';
import { CharSelectScene } from './scenes/CharSelectScene';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';
import { ResultScene } from './scenes/ResultScene';

async function boot(): Promise<void> {
  try {
    // 等像素字体加载完再建游戏，否则首屏文字会用回退字体渲染
    await Promise.race([
      document.fonts.load('12px "Fusion Pixel"'),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    /* 字体加载失败则用主题里的回退字体 */
  }
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    pixelArt: true,
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [BootScene, MainMenuScene, MetaShopScene, CharSelectScene, GameScene, HudScene, ResultScene],
  });
}

void boot();
