import Phaser from 'phaser';
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
  return scene.add.text(x, y, content, {
    fontFamily: UI.font,
    padding: { top: 4, bottom: 2 },
    ...style,
  });
}
