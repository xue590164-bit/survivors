import { eventBus, GameEvents } from '../core/EventBus';
import type { PickupCollectedPayload, EnemyKilledPayload } from '../core/EventBus';

/**
 * 程序化音效系统：WebAudio 合成复古芯片音效，零音频素材。
 * - 懒初始化 AudioContext（浏览器自动播放策略要求首次用户手势后 resume）
 * - 每个音效键有最小触发间隔，命中/拾取这类高频事件不会糊成噪音
 * - M 键全局静音切换，状态存 localStorage
 */
class SoundSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastAt = new Map<string, number>();
  private muted = localStorage.getItem('svs_muted') === '1';

  /** 全局挂接：在 BootScene.create 调一次 */
  attach(scene: Phaser.Scene): void {
    // 首次手势解锁音频（自动播放策略）
    const unlock = () => this.ensureCtx();
    scene.input.once('pointerdown', unlock);
    scene.input.keyboard?.once('keydown', unlock);
    // M 静音
    scene.input.keyboard?.on('keydown-M', () => {
      this.muted = !this.muted;
      localStorage.setItem('svs_muted', this.muted ? '1' : '0');
      if (!this.muted) this.play('ding');
    });
    this.subscribe();
  }

  private ensureCtx(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      // 预生成噪声缓冲（爆炸/命中/风声用）
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private subscribe(): void {
    const B = GameEvents;
    eventBus.on(B.EnemyDamaged, () => this.play('hit', 60));
    eventBus.on(B.EnemyKilled, (p: EnemyKilledPayload) =>
      this.play(p.isBoss ? 'bossDie' : 'kill', p.isBoss ? 0 : 90));
    eventBus.on(B.PlayerDamaged, () => this.play('hurt', 300));
    eventBus.on(B.PlayerDied, () => this.play('die'));
    eventBus.on(B.LevelUp, () => this.play('levelup'));
    eventBus.on(B.WeaponEvolved, () => this.play('evolve'));
    eventBus.on(B.BondActivated, () => this.play('bond'));
    eventBus.on(B.BossSpawned, () => this.play('boss'));
    eventBus.on(B.BossPhase, () => this.play('phase'));
    eventBus.on(B.EnemyShot, () => this.play('eshot', 120));
    eventBus.on(B.Sandstorm, () => this.play('storm'));
    eventBus.on(B.Blizzard, () => this.play('storm'));
    eventBus.on(B.QuestToast, () => this.play('ding', 400));
    eventBus.on(B.PickupCollected, (p: PickupCollectedPayload) => {
      switch (p.pickup.def.type) {
        case 'xp': this.play('xp', 45); break;
        case 'heal': this.play('heal'); break;
        case 'chest': this.play('chest'); break;
        case 'relic': this.play('relic'); break;
        case 'magnet': this.play('magnet'); break;
        case 'bomb': this.play('bomb'); break;
      }
    });
  }

  /** 最小间隔节流后播放音效 */
  private play(key: string, minGapMs = 200): void {
    if (this.muted || !this.ctx || !this.master) return;
    const now = performance.now();
    if (now - (this.lastAt.get(key) ?? -1e9) < minGapMs) return;
    this.lastAt.set(key, now);
    const fn = this.bank[key];
    if (fn) fn();
  }

  // ============ 合成原语 ============

  /** 方波/三角波短音：频率滑移 + 音量包络 */
  private beep(freq: number, durMs: number, type: OscillatorType = 'square', vol = 0.5, slideTo?: number, delayMs = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delayMs / 1000;
    const dur = durMs / 1000;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 滤波噪声：命中/爆炸/风暴 */
  private noise(durMs: number, vol = 0.4, freq = 2000, q = 1, delayMs = 0, sweepTo?: number): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + delayMs / 1000;
    const dur = durMs / 1000;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 上行琶音：升级/宝箱/进化 */
  private arp(freqs: number[], stepMs = 70, durMs = 110, type: OscillatorType = 'square', vol = 0.4): void {
    freqs.forEach((f, i) => this.beep(f, durMs, type, vol, undefined, i * stepMs));
  }

  // ============ 音效库 ============

  private bank: Record<string, () => void> = {
    hit: () => this.noise(45, 0.16, 3200, 2),
    kill: () => { this.beep(420, 60, 'square', 0.14, 140); this.noise(50, 0.1, 1600); },
    hurt: () => { this.beep(180, 140, 'sawtooth', 0.32, 70); this.noise(120, 0.2, 800); },
    die: () => { this.beep(300, 900, 'sawtooth', 0.35, 40); this.noise(700, 0.25, 1200, 1, 0, 200); },
    xp: () => this.beep(880 + Math.random() * 160, 40, 'triangle', 0.09),
    heal: () => this.arp([523, 659, 784], 60, 130, 'triangle', 0.3),
    chest: () => this.arp([392, 523, 659, 784, 1046], 55, 120, 'square', 0.28),
    relic: () => { this.arp([659, 784, 988, 1318, 1568], 70, 160, 'triangle', 0.35); this.noise(300, 0.1, 6000, 3); },
    magnet: () => this.beep(200, 350, 'sine', 0.25, 1400),
    bomb: () => { this.noise(500, 0.5, 500, 1, 0, 80); this.beep(90, 300, 'sawtooth', 0.3, 40); },
    levelup: () => this.arp([523, 659, 784, 1046, 1318], 80, 160, 'square', 0.32),
    evolve: () => { this.arp([392, 523, 659, 784, 1046, 1318, 1568], 90, 200, 'square', 0.35); this.noise(400, 0.12, 5000, 2, 200); },
    bond: () => { this.beep(988, 120, 'triangle', 0.3); this.beep(1318, 160, 'triangle', 0.3, undefined, 110); },
    boss: () => { this.beep(70, 700, 'sawtooth', 0.4, 45); this.noise(600, 0.3, 300, 1, 0, 120); },
    phase: () => { this.beep(220, 300, 'sawtooth', 0.35, 110); this.noise(250, 0.2, 900); },
    bossDie: () => { this.arp([784, 659, 523, 392, 262], 100, 220, 'square', 0.35); this.noise(800, 0.3, 2000, 1, 100, 200); },
    eshot: () => this.beep(1200, 40, 'square', 0.07, 700),
    storm: () => this.noise(1400, 0.22, 500, 0.7, 0, 1400),
    ding: () => this.beep(1175, 180, 'triangle', 0.22, 1175),
  };
}

export const soundSystem = new SoundSystem();
