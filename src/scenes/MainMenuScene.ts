import Phaser from 'phaser';
import { SceneKeys, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { db } from '../core/DataRegistry';
import { saveSystem } from '../core/SaveSystem';
import { makeButton } from '../ui/button';
import { txt } from '../ui/text';
import { UI, ribbonBanner } from '../ui/theme';

/** 日期种子 PRNG：今日全服同题 */
function dailySeed(): number {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let h = 2166136261;
  for (const ch of d) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DailyCombo {
  charId: string;
  stageId: string;
  modIds: string[];
}

function todayCombo(): DailyCombo {
  const rng = mulberry32(dailySeed());
  const chars = db().characters();
  const stages = db().stages().filter((s) => s.mode !== 'bossrush');
  const mods = db().modifiers();
  const char = chars[Math.floor(rng() * chars.length)];
  const stage = stages[Math.floor(rng() * stages.length)];
  // 挑 2 个不重复词条
  const pool = [...mods];
  const modIds: string[] = [];
  for (let i = 0; i < 2 && pool.length; i++) {
    modIds.push(pool.splice(Math.floor(rng() * pool.length), 1)[0].id);
  }
  return { charId: char.id, stageId: stage.id, modIds };
}

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.MainMenu);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.colors.bgDeep);

    ribbonBanner(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 190, '像素幸存者', { width: 380, fontSize: 30 });
    txt(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, 'S U R V I V O R S', {
        fontSize: '20px',
        color: UI.text.gold,
      })
      .setOrigin(0.5);

    txt(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, `金币: ${saveSystem.gold}`, {
        fontSize: '18px',
        color: UI.text.gold,
      })
      .setOrigin(0.5);

    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, '开始游戏', () => {
      this.scene.start(SceneKeys.CharSelect);
    });
    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 100, '局外成长', () => {
      this.scene.start(SceneKeys.MetaShop);
    });

    // ===== 每日挑战：日期种子固定 角色+地图+双词条 =====
    const combo = todayCombo();
    const char = db().character(combo.charId);
    const stage = db().stage(combo.stageId);
    const modNames = combo.modIds.map((id) => db().modifier(id).name).join('·');
    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 170, '⚔ 每日挑战', () => {
      this.scene.start(SceneKeys.Game, {
        characterId: combo.charId,
        stageId: combo.stageId,
        modifiers: combo.modIds,
        daily: true,
      });
    }, { width: 240 });
    txt(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 205, `今日：${char.name} @ ${stage.name} · ${modNames}`, {
      fontSize: '12px',
      color: UI.text.dim,
    }).setOrigin(0.5);
    const best = saveSystem.dailyBest;
    if (best) {
      txt(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 224, `今日最佳：${best.won ? '通关' : '阵亡'} 深${best.depth} 杀${best.kills}`, {
        fontSize: '12px',
        color: UI.text.gold,
      }).setOrigin(0.5);
    }

    makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 258, '成 就', () => {
      this.scene.start(SceneKeys.Achievements);
    }, { width: 160, height: 40 });

    txt(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, 'WASD / 方向键移动，武器自动攻击', {
        fontSize: '14px',
        color: UI.text.dim,
      })
      .setOrigin(0.5);
  }
}
