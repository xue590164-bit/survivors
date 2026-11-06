import { eventBus, GameEvents } from '../core/EventBus';
import { saveSystem } from '../core/SaveSystem';
import type { AchievementDef } from '../types';

/**
 * 成就系统：统计计数在 SaveSystem 持久化，bump/mark 后全量比对解锁。
 * 解锁时发 QuestToast 横幅（局内可见）并发放金币奖励。
 */
class AchievementSystem {
  private defs: AchievementDef[] = [];

  init(defs: AchievementDef[]): void {
    this.defs = defs;
  }

  /** 累计型统计 +n（击杀/场次/金币等） */
  bump(stat: string, n = 1): void {
    saveSystem.statInc(stat, n);
    this.check();
  }

  /** 峰值型统计（等级/深度/护符数等） */
  mark(stat: string, v: number): void {
    saveSystem.statMax(stat, v);
    this.check();
  }

  /** 全量检查未解锁项；返回本批新解锁（调用方结算页展示用） */
  check(): AchievementDef[] {
    const fresh: AchievementDef[] = [];
    for (const d of this.defs) {
      if (saveSystem.isAchievementUnlocked(d.id)) continue;
      if (saveSystem.stat(d.stat) >= d.threshold) {
        saveSystem.unlockAchievement(d.id);
        if (d.rewardGold > 0) saveSystem.addGold(d.rewardGold);
        fresh.push(d);
        eventBus.emit(GameEvents.QuestToast, {
          text: `🏆 成就解锁「${d.name}」${d.rewardGold > 0 ? ` +${d.rewardGold}金` : ''}`,
          color: '#ffd700',
        });
      }
    }
    return fresh;
  }

  list(): AchievementDef[] {
    return this.defs;
  }

  progress(d: AchievementDef): { cur: number; done: boolean } {
    const cur = Math.min(saveSystem.stat(d.stat), d.threshold);
    return { cur, done: saveSystem.isAchievementUnlocked(d.id) };
  }
}

export const achievements = new AchievementSystem();
