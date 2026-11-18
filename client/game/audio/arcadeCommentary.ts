import { BROADCAST, type ArcadeCue } from './broadcastClips';
import type { SoundEngine } from './soundEngine';

export type { ArcadeCue } from './broadcastClips';

export class ArcadeCommentary {
  private counts: Partial<Record<ArcadeCue, number>> = {};
  private remainingMs = 0;
  public lastCue: ArcadeCue | null = null;

  constructor(
    private readonly caption: HTMLElement,
    private readonly sound: Pick<SoundEngine, 'playCommentary' | 'stopCommentary'>,
  ) {}

  public call(cue: ArcadeCue, speak: boolean): void {
    // Frequent setup moves cannot interrupt an active result call.
    if (cue === 'stepback' && this.remainingMs > 0) return;
    const clips = BROADCAST[cue];
    const turn = this.counts[cue] ?? 0;
    this.counts[cue] = turn + 1;
    const clip = clips[turn % clips.length];
    this.lastCue = cue;
    this.remainingMs = Math.max(2350, clip.duration * 1000);
    this.caption.textContent = clip.text;
    this.caption.classList.remove('hidden');

    if (speak) this.sound.playCommentary(clip);
    else this.stopVoice();
  }

  public step(deltaMs: number): void {
    if (this.remainingMs <= 0) return;
    this.remainingMs -= deltaMs;
    if (this.remainingMs <= 0) this.caption.classList.add('hidden');
  }

  public stopVoice(): void {
    this.sound.stopCommentary();
  }

  public reset(): void {
    this.stopVoice();
    this.remainingMs = 0;
    this.lastCue = null;
    this.caption.classList.add('hidden');
  }
}
