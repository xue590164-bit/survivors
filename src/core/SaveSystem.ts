const SAVE_KEY = 'survivors_save_v1';

/** 测试期开关：全角色/地图解锁 + 金币显示为拉满值、购买必成功。正式平衡测试时改回 false */
const TEST_UNLOCK_ALL = true;
const TEST_GOLD = 9_999_999_999;

export interface SaveData {
  gold: number;
  /** 局外成长已点亮节点：charId -> nodeId[] */
  metaNodes: Record<string, string[]>;
  unlockedCharacters: string[];
  unlockedStages: string[];
}

const DEFAULT_SAVE: SaveData = {
  gold: 0,
  metaNodes: {},
  unlockedCharacters: ['char_knight'],
  unlockedStages: ['stage_forest'],
};

/** 局外存档：localStorage 持久化，负责金币/永久成长/解锁状态 */
export class SaveSystem {
  private data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return { ...DEFAULT_SAVE, ...JSON.parse(raw) };
    } catch {
      // 存档损坏则重置
    }
    return { ...DEFAULT_SAVE };
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // 隐私模式等场景写入失败，静默降级
    }
  }

  get gold(): number {
    return TEST_UNLOCK_ALL ? TEST_GOLD : this.data.gold;
  }

  addGold(n: number): void {
    this.data.gold = Math.max(0, this.data.gold + n);
    this.save();
  }

  spendGold(n: number): boolean {
    if (TEST_UNLOCK_ALL) return true;
    if (this.data.gold < n) return false;
    this.data.gold -= n;
    this.save();
    return true;
  }

  hasMetaNode(charId: string, nodeId: string): boolean {
    return (this.data.metaNodes[charId] ?? []).includes(nodeId);
  }

  unlockMetaNode(charId: string, nodeId: string): void {
    if (this.hasMetaNode(charId, nodeId)) return;
    (this.data.metaNodes[charId] ??= []).push(nodeId);
    this.save();
  }

  metaNodeIds(charId: string): string[] {
    return this.data.metaNodes[charId] ?? [];
  }

  isCharUnlocked(id: string): boolean {
    return TEST_UNLOCK_ALL || this.data.unlockedCharacters.includes(id);
  }

  isStageUnlocked(id: string): boolean {
    return TEST_UNLOCK_ALL || this.data.unlockedStages.includes(id);
  }

  unlockCharacter(id: string): void {
    if (!this.isCharUnlocked(id)) {
      this.data.unlockedCharacters.push(id);
      this.save();
    }
  }

  unlockStage(id: string): void {
    if (!this.isStageUnlocked(id)) {
      this.data.unlockedStages.push(id);
      this.save();
    }
  }

  /** 今日挑战最佳战绩（按 胜>深>杀 排序），跨天自动重置 */
  private dailyKey(): string {
    return `${SAVE_KEY}_daily_${new Date().toISOString().slice(0, 10)}`;
  }

  get dailyBest(): { won: boolean; depth: number; kills: number; level: number } | undefined {
    try {
      const raw = localStorage.getItem(this.dailyKey());
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  saveDailyBest(r: { won: boolean; endlessDepth?: number; kills: number; level: number }): void {
    const cur = this.dailyBest;
    const cand = { won: r.won, depth: r.endlessDepth ?? 0, kills: r.kills, level: r.level };
    const better =
      !cur ||
      (cand.won && !cur.won) ||
      (cand.won === cur.won && cand.depth > cur.depth) ||
      (cand.won === cur.won && cand.depth === cur.depth && cand.kills > cur.kills);
    if (better) {
      try {
        localStorage.setItem(this.dailyKey(), JSON.stringify(cand));
      } catch {
        // ignore
      }
    }
  }
}

export const saveSystem = new SaveSystem();
