import Phaser from 'phaser';
import { txt } from './text';

/**
 * 全局 UI 主题：中世纪手卷风格。
 * 羊皮纸（parchment）承载正文，深色橡木（wood）承载按钮/卡片，
 * 描金（gold）描边与标题，酒红（wine）标记危险/Boss，苔绿（moss）标记已完成。
 */
export const UI = {
  font: '"Fusion Pixel", "KaiTi", "STKaiti", monospace',
  colors: {
    bgDeep: 0x100c14,        // 场景底色：深夜林色
    woodDark: 0x241a10,
    woodMid: 0x3a2c1c,
    woodHover: 0x4a3824,
    parchment: 0xe6d7b2,
    parchmentDim: 0xc9b88e,
    gold: 0xc8a044,
    goldBright: 0xe8c860,
    goldDim: 0x8a6a30,
    wine: 0x7a2e3a,
    moss: 0x4a6a42,
    rune: 0x8a5fd0,
    blood: 0xa83a2e,
    ivory: 0xf2ecd8,
  },
  text: {
    title: '#e8c860',
    gold: '#ffd25e',
    body: '#e8dfc8',
    dim: '#9a8f78',
    /** 羊皮纸上的墨色文字 */
    ink: '#2c1f14',
    inkDim: '#6a5638',
    danger: '#e06050',
    ok: '#8ac86a',
  },
} as const;

/** 四角描金饰钉：小菱形 + 内点，中世纪装帧风格 */
function cornerStuds(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  const o = 5;
  for (const [cx, cy] of [[x + o, y + o], [x + w - o, y + o], [x + o, y + h - o], [x + w - o, y + h - o]]) {
    g.fillStyle(UI.colors.gold, 1);
    g.fillPoints([
      new Phaser.Geom.Point(cx, cy - 3),
      new Phaser.Geom.Point(cx + 3, cy),
      new Phaser.Geom.Point(cx, cy + 3),
      new Phaser.Geom.Point(cx - 3, cy),
    ], true);
  }
}

/** 羊皮纸面板：用于正文阅读区（升级选项/结算报告） */
export function parchmentPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  // 木底托 + 纸面 + 双描金框
  g.fillStyle(UI.colors.woodDark, 1).fillRoundedRect(x - 5, y - 5, w + 10, h + 10, 6);
  g.fillStyle(UI.colors.parchment, 1).fillRoundedRect(x, y, w, h, 4);
  g.lineStyle(2, UI.colors.gold, 1).strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, 3);
  g.lineStyle(1, UI.colors.goldDim, 0.8).strokeRoundedRect(x + 7, y + 7, w - 14, h - 14, 2);
  cornerStuds(g, x, y, w, h);
  return scene.add.container(0, 0, [g]);
}

/** 橡木面板：用于按钮/卡片底（描金双框 + 角钉） */
export function woodPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { hover?: boolean; dim?: boolean; fill?: number } = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const fill = opts.fill ?? (opts.dim ? 0x1a140e : opts.hover ? UI.colors.woodHover : UI.colors.woodMid);
  g.fillStyle(fill, 1)
    .fillRoundedRect(x, y, w, h, 5);
  g.lineStyle(2, UI.colors.gold, opts.dim ? 0.4 : 0.95).strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, 4);
  g.lineStyle(1, UI.colors.goldDim, opts.dim ? 0.25 : 0.6).strokeRoundedRect(x + 5, y + 5, w - 10, h - 10, 3);
  if (!opts.dim) cornerStuds(g, x, y, w, h);
  return g;
}

/** 缎带标题条：羊皮纸横条 + 两端燕尾缺口 + 描金文字（场景大标题用） */
export function ribbonBanner(
  scene: Phaser.Scene,
  cx: number,
  y: number,
  label: string,
  opts: { width?: number; fontSize?: number } = {},
): Phaser.GameObjects.Container {
  const w = opts.width ?? Math.max(220, label.length * 34 + 80);
  const h = 54;
  const g = scene.add.graphics();
  const x = cx - w / 2;
  // 燕尾端头：左右各内切一个三角缺口
  g.fillStyle(UI.colors.parchmentDim, 1);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h);
  g.lineTo(x, y + h);
  g.lineTo(x + 14, y + h / 2);
  g.lineTo(x, y);
  g.closePath();
  g.fillPath();
  g.beginPath();
  g.moveTo(x + w, y);
  g.lineTo(x, y);
  g.lineTo(x, y + h);
  g.lineTo(x + w, y + h);
  g.lineTo(x + w - 14, y + h / 2);
  g.lineTo(x + w, y);
  g.closePath();
  g.fillPath();
  // 中央纸面 + 上下金线
  g.fillStyle(UI.colors.parchment, 1).fillRect(x + 16, y + 4, w - 32, h - 8);
  g.lineStyle(2, UI.colors.gold, 1)
    .lineBetween(x + 20, y + 8, x + w - 20, y + 8)
    .lineBetween(x + 20, y + h - 8, x + w - 20, y + h - 8);
  const t = txt(scene, cx, y + h / 2, label, {
    fontSize: `${opts.fontSize ?? 26}px`,
    color: UI.text.ink,
  }).setOrigin(0.5);
  return scene.add.container(0, 0, [g, t]);
}
