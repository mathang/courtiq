export class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;
  private slowMoOsc: OscillatorNode | null = null;
  private slowMoGain: GainNode | null = null;
  private lastDribbleSoundMs = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') {
      return null;
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopSlowMoAtmosphere();
    }
  }

  public maybePlayDribbleStep(nowMs: number): void {
    if (this.muted || nowMs - this.lastDribbleSoundMs < 380) {
      return;
    }
    this.lastDribbleSoundMs = nowMs;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(135, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.09);

    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  public playShotRelease(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(520, t + 0.18);

    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.21);
  }

  public startSlowMoAtmosphere(): void {
    if (this.muted || this.slowMoOsc) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(72, t);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.06, t + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);

    this.slowMoOsc = osc;
    this.slowMoGain = gain;
  }

  public stopSlowMoAtmosphere(): void {
    if (!this.slowMoOsc || !this.slowMoGain || !this.ctx) {
      this.slowMoOsc = null;
      this.slowMoGain = null;
      return;
    }
    try {
      const t = this.ctx.currentTime;
      this.slowMoGain.gain.setValueAtTime(this.slowMoGain.gain.value, t);
      this.slowMoGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      this.slowMoOsc.stop(t + 0.16);
    } catch {
      // ignore if already stopped
    }
    this.slowMoOsc = null;
    this.slowMoGain = null;
  }

  public playAnswerLock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, t); // D5
    osc.frequency.setValueAtTime(880, t + 0.05); // A5

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  public playDunkSlam(): void {
    this.playSwish();
    const ctx = this.ensureContext(); if (!ctx) return;
    const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.24);
    gain.gain.setValueAtTime(0.32, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(t); osc.stop(t + 0.31);
  }

  public playSwish(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // White noise burst filtered for crisp net swish
    const bufferSize = ctx.sampleRate * 0.28;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((i / bufferSize) * Math.PI);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1900, t);
    filter.Q.setValueAtTime(1.8, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.26, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.27);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t);

    // Celebratory triad chime
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.055);
      g.gain.setValueAtTime(0.1, t + idx * 0.055);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.055 + 0.35);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t + idx * 0.055);
      osc.stop(t + idx * 0.055 + 0.36);
    });
  }

  public playRimClank(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(370, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.16);

    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.19);
  }

  public playBlockSwat(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);

    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  public playBuzzer(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(146.83, t);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.56);
  }
}
