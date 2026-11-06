import Phaser from 'phaser';
import { Depths, GAME_WIDTH, GAME_HEIGHT } from '../config';
import type { LevelUpOption } from '../systems/LevelUpSystem';
import { makeButton } from './button';
import { txt } from './text';
import { UI, ribbonBanner } from './theme';

const KEY_MAP: Record<string, number> = {
  Digit1: 0, Digit2: 1, Digit3: 2,
  Numpad1: 0, Numpad2: 1, Numpad3: 2,
};

/** 升级三选一浮层：展示选项，点击后回调并把控制权交还 GameScene */
export class LevelUpMenu {
  private container: Phaser.GameObjects.Container;
  private optionsBox: Phaser.GameObjects.Container;
  private currentOptions: LevelUpOption[] = [];
  private currentCb: ((opt: LevelUpOption) => void) | null = null;

  constructor(private scene: Phaser.Scene) {
    const overlay = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, UI.colors.bgDeep, 0.78).setOrigin(0);
    const title = ribbonBanner(scene, GAME_WIDTH / 2, 128, '升 级', { width: 300, fontSize: 30 });
    const hint = txt(scene, GAME_WIDTH / 2, 196, '点击选项，或按 1 / 2 / 3 快速选择', {
      fontSize: '14px',
      color: UI.text.dim,
    }).setOrigin(0.5);
    this.optionsBox = scene.add.container(0, 0);
    this.container = scene.add.container(0, 0, [overlay, title, hint, this.optionsBox]);
    this.container.setScrollFactor(0).setDepth(Depths.Overlay).setVisible(false);
  }

  show(options: LevelUpOption[], onPick: (opt: LevelUpOption) => void): void {
    this.currentOptions = options;
    this.currentCb = onPick;

    const kb = this.scene.input.keyboard;
    kb?.off('keydown', this.onKeyDown, this);
    kb?.on('keydown', this.onKeyDown, this);

    this.optionsBox.removeAll(true);
    options.forEach((opt, i) => {
      const y = GAME_HEIGHT / 2 - 60 + i * 110;
      const isEvolve = opt.kind === 'weapon_evolve';
      const btn = makeButton(this.scene, GAME_WIDTH / 2, y, '', () => onPick(opt), {
        width: 560,
        height: 90,
        variant: 'parchment',
        borderColor: isEvolve ? UI.colors.rune : undefined,
      });
      const num = txt(this.scene, -268, 0, `${i + 1}`, { fontSize: '22px', color: UI.text.inkDim })
        .setOrigin(0.5);
      const children: Phaser.GameObjects.GameObject[] = [num];
      if (opt.icon && this.scene.textures.exists(opt.icon)) {
        const icon = this.scene.add.image(-232, 0, opt.icon).setScale(1.6).setOrigin(0.5);
        children.push(icon);
      }
      const label = txt(this.scene, -196, -28, opt.label, { fontSize: '20px', color: isEvolve ? '#6a3fa0' : UI.text.ink })
        .setOrigin(0, 0.5);
      const desc = txt(this.scene, -196, 10, opt.desc, { fontSize: '15px', color: UI.text.inkDim, wordWrap: { width: 460 } })
        .setOrigin(0, 0.5);
      children.push(label, desc);
      if (opt.bondHint) {
        children.push(
          txt(this.scene, -196, -8, opt.bondHint, { fontSize: '13px', color: '#c8862a' }).setOrigin(0, 0.5),
        );
      }
      btn.add(children);
      this.optionsBox.add(btn);
    });
    this.container.setVisible(true);
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (!this.container.visible || !this.currentCb) return;
    const idx = KEY_MAP[ev.code];
    if (idx === undefined) return;
    const opt = this.currentOptions[idx];
    if (opt) this.currentCb(opt);
  }

  hide(): void {
    this.scene.input.keyboard?.off('keydown', this.onKeyDown, this);
    this.currentCb = null;
    this.container.setVisible(false);
  }
}
