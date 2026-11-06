import { db } from '../core/DataRegistry';
import { saveSystem } from '../core/SaveSystem';
import type { MetaNode, Stats, WeaponMod } from '../types';

/**
 * 局外成长：每个角色一棵前置树，节点点亮后永久生效。
 * 数值保守——通用属性只给小额加成，构筑大头仍在局内。
 */

function unlockedNodes(charId: string): MetaNode[] {
  const owned = new Set(saveSystem.metaNodeIds(charId));
  return db().metaTree(charId).nodes.filter((n) => owned.has(n.id));
}

/** 进局通用属性加成（树中已点亮节点的 stat/value 求和） */
export function metaBonusStats(charId: string): Partial<Stats> {
  const out: Partial<Stats> = {};
  for (const n of unlockedNodes(charId)) {
    if (n.stat && n.value !== undefined) {
      out[n.stat] = (out[n.stat] ?? 0) + n.value;
    }
  }
  return out;
}

/** 进局武器专属修正：key=武器id */
export function metaWeaponMods(charId: string): Record<string, WeaponMod> {
  const out: Record<string, WeaponMod> = {};
  for (const n of unlockedNodes(charId)) {
    if (n.weapon && n.weaponMod) {
      const cur = (out[n.weapon] ??= {});
      cur.projectiles = (cur.projectiles ?? 0) + (n.weaponMod.projectiles ?? 0);
      cur.damagePct = (cur.damagePct ?? 0) + (n.weaponMod.damagePct ?? 0);
      cur.cooldownPct = (cur.cooldownPct ?? 0) + (n.weaponMod.cooldownPct ?? 0);
      cur.areaPct = (cur.areaPct ?? 0) + (n.weaponMod.areaPct ?? 0);
      cur.pierce = (cur.pierce ?? 0) + (n.weaponMod.pierce ?? 0);
    }
  }
  return out;
}

export type NodeState = 'owned' | 'canBuy' | 'locked' | 'cantAfford';

export function nodeState(charId: string, node: MetaNode): NodeState {
  if (saveSystem.hasMetaNode(charId, node.id)) return 'owned';
  const reqsMet = node.requires.every((r) => saveSystem.hasMetaNode(charId, r));
  if (!reqsMet) return 'locked';
  return saveSystem.gold >= node.cost ? 'canBuy' : 'cantAfford';
}

/** 尝试点亮节点：前置满足+金币足够才成功 */
export function tryUnlockNode(charId: string, node: MetaNode): boolean {
  if (nodeState(charId, node) !== 'canBuy') return false;
  if (!saveSystem.spendGold(node.cost)) return false;
  saveSystem.unlockMetaNode(charId, node.id);
  return true;
}
