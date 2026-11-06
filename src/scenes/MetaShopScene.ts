import Phaser from 'phaser';
import { SceneKeys, GAME_WIDTH, GAME_HEIGHT } from '../config';
import { db } from '../core/DataRegistry';
import { saveSystem } from '../core/SaveSystem';
import { nodeState, tryUnlockNode, type NodeState } from '../systems/MetaSystem';
import { makeButton } from '../ui/button';
import { charCard } from '../ui/charCard';
import { txt } from '../ui/text';
import { UI, ribbonBanner } from '../ui/theme';
import type { MetaNode } from '../types';

const TREE_X = 300;
const TREE_Y = 200;
const COL_W = 210;
const ROW_H = 155;

const STATE_COLOR: Record<NodeState, { bg: number; note: string; noteColor: string; dim: number }> = {
  owned: { bg: UI.colors.moss, note: '已点亮', noteColor: '#c8f0b0', dim: 1 },
  canBuy: { bg: UI.colors.woodMid, note: '', noteColor: UI.text.gold, dim: 1 },
  locked: { bg: UI.colors.woodDark, note: '未解锁', noteColor: '#6a6050', dim: 0.4 },
  cantAfford: { bg: 0x2e1c18, note: '金币不足', noteColor: UI.text.danger, dim: 0.65 },
};

/** 局外成长：先选职业，再进专属成长树（前置点亮才能点下一个） */
export class MetaShopScene extends Phaser.Scene {
  private charId: string | null = null;
  private treeBox!: Phaser.GameObjects.Container;
  private lines!: Phaser.GameObjects.Graphics;
  private goldText!: Phaser.GameObjects.Text;
  private view!: Phaser.GameObjects.Container;

  constructor() {
    super(SceneKeys.MetaShop);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI.colors.bgDeep);
    this.charId = null;
    this.view = this.add.container(0, 0);
    this.renderCharPick();
  }

  /** 第一步：选职业 */
  private renderCharPick(): void {
    this.view.removeAll(true);
    this.view.add(ribbonBanner(this, GAME_WIDTH / 2, 46, '局外成长', { width: 300 }));
    this.view.add(txt(this, GAME_WIDTH / 2, 126, '每个职业有独立的成长树，先选职业', {
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
    const rowPitch = cardH + 46;
    const rows = Math.ceil(chars.length / cols);
    const top = (GAME_HEIGHT - rows * rowPitch) / 2 + cardH / 2 + 30;
    chars.forEach((c, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const inRow = Math.min(cols, chars.length - row * cols);
      const rowW = inRow * cardW + (inRow - 1) * gap;
      const x = (GAME_WIDTH - rowW) / 2 + cardW / 2 + col * (cardW + gap);
      const y = top + row * rowPitch;
      const lit = saveSystem.metaNodeIds(c.id).length;
      const all = db().metaTree(c.id).nodes.length;
      const card = charCard(this, x, y, c, (r) => {
        if (r === 'poor') return this.flashMsg(GAME_WIDTH / 2, 150, '金币不足');
        if (r === 'bought') return this.renderCharPick();
        if (r === 'ok') {
          this.charId = c.id;
          this.renderTree();
        }
      }, { subtitle: `已点亮 ${lit}/${all}` });
      this.view.add(card);
    });

    this.view.add(makeButton(this, 80, GAME_HEIGHT - 50, '返回', () => this.scene.start(SceneKeys.MainMenu), {
      width: 110, height: 42,
    }));
  }

  private nodeXY(n: MetaNode): [number, number] {
    return [TREE_X + n.pos[0] * COL_W, TREE_Y + n.pos[1] * ROW_H];
  }

  /** 第二步：该职业的技能树 */
  private renderTree(): void {
    this.view.removeAll(true);
    const charId = this.charId!;
    const charDef = db().character(charId);

    this.lines = this.add.graphics();
    this.treeBox = this.add.container(0, 0);
    this.view.add([this.lines, this.treeBox]);

    // 顶部：职业名 + 金币 + 换职业
    this.view.add(txt(this, 60, 40, `${charDef.name} · 成长树`, { fontSize: '30px', color: UI.text.title }));
    this.view.add(txt(this, 60, 82, '点亮前置节点才能解锁后续', { fontSize: '13px', color: UI.text.dim }));
    this.goldText = txt(this, GAME_WIDTH - 60, 46, `金币: ${saveSystem.gold}`, {
      fontSize: '22px', color: UI.text.gold,
    }).setOrigin(1, 0);
    this.view.add(this.goldText);
    this.view.add(makeButton(this, GAME_WIDTH - 90, 90, '换职业', () => this.renderCharPick(), {
      width: 110, height: 38, fontSize: 15,
    }));
    this.view.add(makeButton(this, 80, GAME_HEIGHT - 44, '返回', () => this.scene.start(SceneKeys.MainMenu), {
      width: 110, height: 42,
    }));

    const tree = db().metaTree(charId);
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));

    // 连接线（节点下层）
    for (const n of tree.nodes) {
      const [x, y] = this.nodeXY(n);
      for (const reqId of n.requires) {
        const req = byId.get(reqId);
        if (!req) continue;
        const [rx, ry] = this.nodeXY(req);
        const lit =
          saveSystem.hasMetaNode(charId, reqId) && saveSystem.hasMetaNode(charId, n.id);
        const halfLit = saveSystem.hasMetaNode(charId, reqId);
        this.lines.lineStyle(3, lit ? UI.colors.goldBright : halfLit ? UI.colors.goldDim : 0x3a342a, 0.9);
        this.lines.lineBetween(rx + 64, ry, x - 64, y);
      }
    }

    for (const n of tree.nodes) {
      const [x, y] = this.nodeXY(n);
      const st = nodeState(charId, n);
      const stc = STATE_COLOR[st];

      const btn = makeButton(this, x, y, '', () => this.onNode(n), {
        width: 140,
        height: 112,
        bg: stc.bg,
      });
      if (st === 'locked' || st === 'cantAfford') btn.setAlpha(stc.dim);

      const children: Phaser.GameObjects.GameObject[] = [];
      if (n.icon && this.textures.exists(n.icon)) {
        children.push(this.add.image(0, -28, n.icon).setScale(2.4));
      }
      children.push(
        txt(this, 0, 6, n.name, { fontSize: '16px', color: UI.text.body }).setOrigin(0.5),
        txt(this, 0, 30, st === 'canBuy' ? `${n.cost} 金` : stc.note, {
          fontSize: '13px',
          color: stc.noteColor,
        }).setOrigin(0.5),
        txt(this, 0, 48, n.desc, { fontSize: '11px', color: UI.text.dim }).setOrigin(0.5),
      );
      btn.add(children);
      this.treeBox.add(btn);
    }
  }

  private onNode(n: MetaNode): void {
    const charId = this.charId!;
    if (tryUnlockNode(charId, n)) {
      this.renderTree();
      return;
    }
    const st = nodeState(charId, n);
    if (st === 'owned') return;
    const [x, y] = this.nodeXY(n);
    const msg = st === 'locked' ? '需先点亮前置节点' : '金币不足';
    const t = txt(this, x, y - 74, msg, { fontSize: '14px', color: UI.text.danger })
      .setOrigin(0.5);
    this.tweens.add({
      targets: t,
      y: y - 98,
      alpha: 0,
      duration: 750,
      onComplete: () => t.destroy(),
    });
  }

  private flashMsg(x: number, y: number, msg: string): void {
    const t = txt(this, x, y, msg, { fontSize: '14px', color: UI.text.danger }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: y - 24, alpha: 0, duration: 750, onComplete: () => t.destroy() });
  }
}
