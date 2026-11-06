export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const SceneKeys = {
  Boot: 'BootScene',
  MainMenu: 'MainMenuScene',
  MetaShop: 'MetaShopScene',
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
