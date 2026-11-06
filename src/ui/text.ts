import Phaser from 'phaser';
import { UI_SCALE } from '../config';
import { UI } from './theme';

/**
 * 统一文本创建。中文字形实际渲染高度高于 fontSize 度量值，
 * 默认上下留白防止纹理顶部被裁掉；默认衬线字体（中世纪手卷风格）。
 */
export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  content: string | string[],
  style: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.GameObjects.Text {
  // 移动端全局字体放大：'20px' → 20*UI_SCALE
  const fs = style.fontSize;
  const scaledFs =
    typeof fs === 'string' && fs.endsWith('px')
      ? `${Math.round(parseFloat(fs) * UI_SCALE)}px`
      : typeof fs === 'number'
        ? `${Math.round(fs * UI_SCALE)}px`
        : `${Math.round(16 * UI_SCALE)}px`;
  return scene.add.text(x, y, content, {
    fontFamily: UI.font,
    padding: { top: 4, bottom: 2 },
    ...style,
    fontSize: scaledFs,
  });
}
