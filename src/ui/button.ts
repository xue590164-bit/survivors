import Phaser from 'phaser';
import { MOBILE } from '../config';
import { txt } from './text';
import { UI, woodPanel, parchmentPanel } from './theme';

interface ButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  /** 木按钮（默认）/羊皮纸（选项卡片）/酒红（危险操作） */
  variant?: 'wood' | 'parchment' | 'wine';
  bg?: number;
  bgHover?: number;
  /** 描边色（默认描金） */
  borderColor?: number;
  /** 文字色覆盖 */
  textColor?: string;
}

/** 中世纪风格按钮：木纹底 + 描金双框 + 角钉；variant=parchment 时羊皮纸+墨字 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): Phaser.GameObjects.Container {
  const w = opts.width ?? 240;
  const h = Math.round((opts.height ?? 48) * (MOBILE ? 1.45 : 1));
  const variant = opts.variant ?? 'wood';
  const parchment = variant === 'parchment';
  const fill = opts.bg ?? (parchment ? UI.colors.parchment : variant === 'wine' ? UI.colors.wine : UI.colors.woodMid);
  const fg = opts.textColor ?? (parchment ? UI.text.ink : UI.text.body);

  let bgObj: Phaser.GameObjects.GameObject;
  if (parchment) {
    bgObj = parchmentPanel(scene, -w / 2, -h / 2, w, h);
  } else {
    bgObj = woodPanel(scene, -w / 2, -h / 2, w, h, { fill });
  }
  // 悬停态：统一的淡金光晕提亮
  const hoverRect = scene.add.rectangle(0, 0, w - 8, h - 8, 0xfff4d0, 0);

  const text = txt(scene, 0, 0, label, { fontSize: `${opts.fontSize ?? 20}px`, color: fg })
    .setOrigin(0.5);
  // 隐形 Zone 独占输入：Container 的 origin 被硬编码为 0.5，命中映射有坑；
  // Zone 走标准非容器路径（自身 displayOrigin 归一），且热区外扩 8px 提升手感。
  const hit = scene.add.zone(0, 0, w + 8, h + 8).setInteractive({ useHandCursor: true });
  const c = scene.add.container(x, y, [bgObj, hoverRect, text, hit]);
  c.setSize(w, h);
  c.setScrollFactor(0);
  hit.on('pointerover', () => hoverRect.setFillStyle(0xfff4d0, 0.22));
  hit.on('pointerout', () => hoverRect.setFillStyle(0xfff4d0, 0));
  hit.on('pointerdown', onClick);
  // 供外部改选中描边（CharSelect 用 strokeColor 判选中态）
  const frame = scene.add.graphics();
  frame.lineStyle(2.5, opts.borderColor ?? UI.colors.gold, 1)
    .strokeRoundedRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 4);
  c.add(frame);
  return c;
}
