import Phaser from 'phaser';

/**
 * 序列帧动画器：按间隔循环切换纹理。
 * phase 用于给同屏大量同类单位错开相位，避免全场同步动作。
 */
export class FrameAnimator {
  private acc = 0;
  private idx = 0;
  playing = true;

  constructor(
    private sprite: Phaser.GameObjects.Sprite,
    private frames: string[],
    private intervalMs: number,
    phase = 0,
  ) {
    this.acc = phase;
  }

  update(dtMs: number): void {
    if (!this.playing || this.frames.length < 2) return;
    this.acc += dtMs;
    if (this.acc >= this.intervalMs) {
      this.acc = 0;
      this.idx = (this.idx + 1) % this.frames.length;
      this.sprite.setTexture(this.frames[this.idx]);
    }
  }

  /** 切换帧表（换朝向时用），回到第一帧 */
  setFrames(frames: string[]): void {
    if (this.frames === frames) return;
    this.frames = frames;
    this.idx = 0;
    this.acc = 0;
    this.sprite.setTexture(frames[0]);
  }

  /** 停走回第一帧（待机） */
  reset(): void {
    if (this.idx === 0) return;
    this.idx = 0;
    this.acc = 0;
    this.sprite.setTexture(this.frames[0]);
  }
}

/** 若存在 _f1 序列帧则返回完整帧表，否则返回单帧 */
export function frameKeysOf(scene: Phaser.Scene, baseKey: string, maxFrames = 4): string[] {
  const keys = [baseKey];
  for (let i = 1; i <= maxFrames; i++) {
    const k = `${baseKey}_f${i}`;
    if (!scene.textures.exists(k)) break;
    keys.push(k);
  }
  return keys;
}
