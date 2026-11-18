const LINES = {
  tipoff: ['Game on! Light up the court!'],
  stepback: ['Back-step lightning!'],
  dunk: ['Roof rattler! That rim felt it!', 'Straight through the skyline!'],
  three: ['From the deep end! Splash!', 'Three on the board! Turn up the lights!'],
  basket: ['Threaded the rim! Count it!', 'Clean finish! Make that two!'],
  block: ['Door slammed! What a stop!', 'The rim is closed for business!'],
  steal: ['Pocket picked! The floor just flipped!', 'Quick hands! New ball game!'],
  miss: ['The rim wins that round!', 'Off the iron! Next possession!'],
  clock: ['The clock takes this one!'],
  fire: ['Three straight right! The court is heating up!'],
} as const;

export type ArcadeCue = keyof typeof LINES;

/** Captions always work. Spoken calls use only an installed, on-device browser voice. */
export class ArcadeCommentary {
  private counts: Partial<Record<ArcadeCue, number>> = {};
  private remainingMs = 0;
  private speaking = false;
  public lastCue: ArcadeCue | null = null;

  constructor(private readonly caption: HTMLElement) {}

  public call(cue: ArcadeCue, speak: boolean): void {
    // Frequent setup moves cannot interrupt an active result call.
    if (cue === 'stepback' && this.remainingMs > 0) return;
    const lines = LINES[cue];
    const turn = this.counts[cue] ?? 0;
    this.counts[cue] = turn + 1;
    const text = lines[turn % lines.length];
    this.lastCue = cue;
    this.remainingMs = 2350;
    this.caption.textContent = text;
    this.caption.classList.remove('hidden');

    this.stopVoice();
    if (!speak || !('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(voice => voice.localService && voice.lang === 'en-AU')
      ?? voices.find(voice => voice.localService && /^en\b/i.test(voice.lang));
    if (!voice) return;
    const line = new SpeechSynthesisUtterance(text);
    line.voice = voice;
    line.rate = 1.13;
    line.pitch = 1.17;
    line.volume = 0.85;
    this.speaking = true;
    line.onend = line.onerror = () => { this.speaking = false; };
    window.speechSynthesis.speak(line);
  }

  public step(deltaMs: number): void {
    if (this.remainingMs <= 0) return;
    this.remainingMs -= deltaMs;
    if (this.remainingMs <= 0) this.caption.classList.add('hidden');
  }

  public stopVoice(): void {
    if (!this.speaking) return;
    this.speaking = false;
    window.speechSynthesis.cancel();
  }

  public reset(): void {
    this.stopVoice();
    this.remainingMs = 0;
    this.lastCue = null;
    this.caption.classList.add('hidden');
  }
}
