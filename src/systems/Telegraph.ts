import Phaser from 'phaser';
import { Depths } from '../config';

/** 预警圈：描边圆 + 内圈填充渐强，到时触发回调并自毁。返回 Graphics 供调用方跟踪清理 */
export function telegraphCircle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  r: number,
  ms: number,
  color: number,
  onFire: () => void,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(Depths.Map + 3);
  const tween = scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: ms,
    onUpdate: () => {
      const t = tween.getValue() ?? 0;
      g.clear();
      g.lineStyle(2, color, 0.9).strokeCircle(x, y, r);
      g.fillStyle(color, 0.10 + t * 0.22).fillCircle(x, y, r * (0.3 + t * 0.7));
    },
    onComplete: () => {
      g.destroy();
      onFire();
    },
  });
  return g;
}
