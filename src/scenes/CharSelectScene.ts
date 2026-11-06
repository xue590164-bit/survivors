import Phaser from 'phaser';
import { SceneKeys, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { db } from '../core/DataRegistry';
import { saveSystem } from '../core/SaveSystem';
import { makeButton } from '../ui/button';
import { charCard } from '../ui/charCard';
import { txt } from '../ui/text';
import { UI, ribbonBanner } from '../ui/theme';
import type { CharacterDef, StageDef } from '../types';

/** 选人 + 选图：两步流程，先横排选英雄，再选地图出发 */
export class CharSelectScene extends Phaser.Scene {
  private selectedChar: CharacterDef | null = null;
  private view!: Phaser.GameObjects.Container;
  private stageCards = new Map<StageDef, Phaser.GameObjects.Rectangle>();
  private selectedStage: StageDef | null = null;
  private startBtn!: Phaser.GameObjects.Container;

  constructor() {
    super(SceneKeys.CharSelect);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.colors.bgDeep);
    this.selectedChar = null;
    this.selectedStage = null;
    this.stageCards.clear();
    this.view = this.add.container(0, 0);
    this.renderCharPick();
  }

  /** 第一步：英雄横排铺开 */
  private renderCharPick(): void {
    this.view.removeAll(true);
    this.stageCards.clear();
    this.selectedStage = null;

    this.view.add(ribbonBanner(this, GAME_WIDTH / 2, 46, '选择你的英雄', { width: 360 }));
    this.view.add(txt(this, GAME_WIDTH / 2, 130, '挑一位勇士踏上征途', {
      fontSize: '15px', color: UI.text.dim,
    }).setOrigin(0.5));
    this.view.add(txt(this, GAME_WIDTH - 30, 46, `金币: ${saveSystem.gold}`, {
      fontSize: '18px', color: UI.text.gold,
    }).setOrigin(1, 0.5));

    const chars = db().characters();
    const cardW = 150;
    const cardH = 190;
    const gap = 22;
    const cols = 7; // 每排最多 7 张，两排各自居中
    const rowPitch = cardH + 46; // 卡高 + 描述区
    const rows = Math.ceil(chars.length / cols);
    const top = (GAME_HEIGHT - rows * rowPitch) / 2 + cardH / 2 + 30;
    chars.forEach((c, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const inRow = Math.min(cols, chars.length - row * cols);
      const rowW = inRow * cardW + (inRow - 1) * gap;
      const x = (GAME_WIDTH - rowW) / 2 + cardW / 2 + col * (cardW + gap);
      const y = top + row * rowPitch;
      const card = charCard(this, x, y, c, (r) => {
        if (r === 'poor') return this.flashMsg(GAME_WIDTH / 2, 150, '金币不足');
        if (r === 'bought') return this.renderCharPick();
        if (r === 'ok') {
          this.selectedChar = c;
          this.renderStagePick();
        }
      });
      this.view.add(card);
      // 描述贴在每张卡正下方
      this.view.add(txt(this, x, y + cardH / 2 + 6, c.description, {
        fontSize: '11px', color: UI.text.dim, wordWrap: { width: cardW - 16 }, align: 'center',
      }).setOrigin(0.5, 0));
    });

    this.view.add(makeButton(this, 80, GAME_HEIGHT - 50, '返回', () => this.scene.start(SceneKeys.MainMenu), {
      width: 110, height: 42,
    }));
  }

  /** 第二步：选地图 + 出发 */
  private renderStagePick(): void {
    this.view.removeAll(true);
    const c = this.selectedChar!;

    this.view.add(ribbonBanner(this, GAME_WIDTH / 2, 46, '选择战场', { width: 300 }));
    this.view.add(txt(this, GAME_WIDTH - 30, 46, `金币: ${saveSystem.gold}`, {
      fontSize: '18px', color: UI.text.gold,
    }).setOrigin(1, 0.5));

    // 已选英雄条：左侧小卡
    const mini = this.add.container(GAME_WIDTH / 2, 170, [
      this.add.image(-210, 0, `tex_${c.id}`).setScale(2.4),
      txt(this, -180, -16, c.name, { fontSize: '22px', color: UI.text.title }).setOrigin(0, 0.5),
      txt(this, -180, 16, `HP ${c.baseStats.maxHp} · 移速 ${c.baseStats.speed} · 护甲 ${c.baseStats.armor} · 起始 ${db().weapon(c.startingWeapon).name}`, {
        fontSize: '14px', color: UI.text.dim,
      }).setOrigin(0, 0.5),
    ]);
    this.view.add(mini);

    const stages = db().stages();
    stages.forEach((s, i) => {
      const x = GAME_WIDTH / 2;
      const y = 300 + i * 120;
      const unlocked = saveSystem.isStageUnlocked(s.id);
      const canBuy = !unlocked && s.unlockCost !== undefined;
      const card = this.add
        .rectangle(x, y, 420, 92, unlocked ? UI.colors.woodMid : UI.colors.woodDark)
        .setStrokeStyle(2, UI.colors.goldDim)
        .setInteractive({ useHandCursor: true });
      this.stageCards.set(s, card);
      const title = unlocked ? s.name : canBuy ? `${s.name} 🔒 ${s.unlockCost}金` : `${s.name} 🔒`;
      this.view.add(card);
      this.view.add(txt(this, x - 190, y - 18, title, {
        fontSize: '21px', color: canBuy ? UI.text.gold : UI.text.body,
      }).setOrigin(0, 0.5));
      this.view.add(txt(this, x - 190, y + 16, canBuy ? `时长 ${Math.floor(s.durationSec / 60)} 分钟（点击解锁）` : `时长 ${Math.floor(s.durationSec / 60)} 分钟`, {
        fontSize: '13px', color: UI.text.dim,
      }).setOrigin(0, 0.5));
      if (unlocked) {
        card.on('pointerdown', () => {
          this.selectedStage = s;
          for (const [, rc] of this.stageCards) rc.setStrokeStyle(2, UI.colors.goldDim);
          card.setStrokeStyle(3, UI.colors.goldBright);
          this.startBtn.setAlpha(1);
        });
      } else if (canBuy) {
        card.on('pointerdown', () => {
          if (!saveSystem.spendGold(s.unlockCost!)) {
            this.flashMsg(x, y - 60, '金币不足');
            return;
          }
          saveSystem.unlockStage(s.id);
          this.renderStagePick();
        });
      }
    });

    this.startBtn = makeButton(this, GAME_WIDTH / 2 + 110, GAME_HEIGHT - 70, '出发！', () => {
      if (!this.selectedChar || !this.selectedStage) return;
      this.scene.start(SceneKeys.Game, {
        characterId: this.selectedChar.id,
        stageId: this.selectedStage.id,
      });
    }, { width: 240, height: 56, fontSize: 24 });
    this.startBtn.setAlpha(0.4);
    this.view.add(this.startBtn);

    this.view.add(makeButton(this, GAME_WIDTH / 2 - 110, GAME_HEIGHT - 70, '重选英雄', () => this.renderCharPick(), {
      width: 160, height: 56,
    }));
  }

  private flashMsg(x: number, y: number, msg: string): void {
    const t = txt(this, x, y - 20, msg, { fontSize: '14px', color: UI.text.danger }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: y - 44, alpha: 0, duration: 750, onComplete: () => t.destroy() });
  }
}
