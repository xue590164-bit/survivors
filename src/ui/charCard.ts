import Phaser from 'phaser';
import type { CharacterDef } from '../types';
import { saveSystem } from '../core/SaveSystem';
import { db } from '../core/DataRegistry';
import { achievements } from '../systems/AchievementSystem';
import { txt } from './text';
import { UI, woodPanel } from './theme';

export interface CharCardOpts {
  width?: number;
  height?: number;
  /** 副标题行（如"已点亮 3/9"），缺省显示起始武器名 */
  subtitle?: string;
}

/**
 * 角色卡：图标+名+副标题+锁定价签。点击统一走 onPick，
 * 购买逻辑（spendGold+unlockCharacter）内部完成，onPick 收到 'ok' | 'bought' | 'locked' | 'poor'
 */
export function charCard(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  c: CharacterDef,
  onPick: (result: 'ok' | 'bought' | 'locked' | 'poor') => void,
  opts: CharCardOpts = {},
): Phaser.GameObjects.Container {
  const w = opts.width ?? 150;
  const h = opts.height ?? 190;
  const unlocked = saveSystem.isCharUnlocked(c.id);
  const canBuy = !unlocked && c.unlockCost !== undefined;

  const bg = woodPanel(scene, -w / 2, -h / 2, w, h, { fill: unlocked ? UI.colors.woodMid : UI.colors.woodDark, dim: !unlocked });
  // 隐形 Zone 接管输入（同 button.ts：绕开 Container origin 命中映射的坑，热区外扩）
  const hit = scene.add.zone(0, 0, w + 8, h + 8).setInteractive({ useHandCursor: true });
  const box = scene.add.container(cx, cy, [bg, hit]);
  box.setSize(w, h);
  box.setScrollFactor(0);

  const icon = scene.add.image(0, -h / 2 + 44, `tex_${c.id}`).setScale(1.8);
  if (!unlocked) icon.setTint(0x222222);
  const name = txt(scene, 0, 8, c.name, {
    fontSize: '18px',
    color: unlocked ? UI.text.title : UI.text.dim,
  }).setOrigin(0.5);

  const sub = unlocked
    ? (opts.subtitle ?? `HP ${c.baseStats.maxHp} · ${db().weapon(c.startingWeapon).name}`)
    : canBuy
      ? `🔒 ${c.unlockCost} 金`
      : c.unlockAchievement
        ? `🔒 ${db().achievements().find((a) => a.id === c.unlockAchievement)?.name ?? '成就'}解锁`
        : '🔒';
  const subTxt = txt(scene, 0, 34, sub, {
    fontSize: '12px',
    color: unlocked ? UI.text.dim : canBuy ? UI.text.gold : UI.text.dim,
  }).setOrigin(0.5);
  box.add([icon, name, subTxt]);

  const hover = scene.add.rectangle(0, 0, w - 8, h - 8, 0xfff4d0, 0);
  box.add(hover);
  hit.on('pointerover', () => hover.setFillStyle(0xfff4d0, 0.18));
  hit.on('pointerout', () => hover.setFillStyle(0xfff4d0, 0));
  hit.on('pointerdown', () => {
    if (unlocked) return onPick('ok');
    if (!canBuy) return onPick('locked');
    onPick(saveSystem.spendGold(c.unlockCost!) ? (saveSystem.unlockCharacter(c.id), achievements.check(), 'bought') : 'poor');
  });
  return box;
}
