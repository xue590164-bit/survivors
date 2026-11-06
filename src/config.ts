export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/** 移动端检测：触屏 + 小屏（排除桌面触控本/平板投屏） */
export const MOBILE =
  typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 1 || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) &&
  Math.min(screen.width, screen.height) < 860;
/** UI 缩放：手机端所有字体/控件放大，弥补 FIT 缩放的物理像素损失 */
export const UI_SCALE = MOBILE ? 1.6 : 1;
/** 世界相机缩放：手机端放大视野内像素（可见范围换可读性） */
export const GAME_ZOOM = MOBILE ? 2.4 : 1.5;

export const SceneKeys = {
  Boot: 'BootScene',
  MainMenu: 'MainMenuScene',
  MetaShop: 'MetaShopScene',
  Achievements: 'AchievementsScene',
  CharSelect: 'CharSelectScene',
  Game: 'GameScene',
  Hud: 'HudScene',
  Result: 'ResultScene',
} as const;

export const Depths = {
  Map: -100,
  Pickup: 0,
  Enemy: 10,
  Projectile: 15,
  Player: 20,
  Hud: 100,
  Overlay: 200,
} as const;

export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;
export const MAX_CHARMS = 3;
export const INVULN_MS = 600;
export const MAX_GEMS = 350;
