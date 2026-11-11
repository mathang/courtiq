import { createCourtSound, type DesignedSound } from "./courtSoundBank";

const RECORDED = [
  "bounce-1",
  "bounce-2",
  "bounce-3",
  "squeak-1",
  "squeak-2",
  "squeak-3",
  "cheer",
] as const;
/** One mixed audio bus, reusable Foley buffers, bounded voices and gesture unlock. */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private meter: AnalyserNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private raw = new Map<string, ArrayBuffer>();
  private loading: Promise<void> | null = null;
  private decoding = false;
  private bed: AudioBufferSourceNode | null = null;
  private bedGain: GainNode | null = null;
  private voices = new Set<AudioBufferSourceNode>();
  private serial = 0;
  private paused = false;
  private status = "idle";
  private counts: Record<string, number> = {};
  private recent: Array<{ sound: string; time: number }> = [];
  public muted = false;

  constructor() {
    if (typeof window !== "undefined") this.prime();
  }
  private prime(): void {
    if (this.loading) return;
    this.status = "loading";
    this.loading = Promise.all(
      RECORDED.map(async (name) => {
        const response = await fetch("/assets/audio/" + name + ".wav");
        if (!response.ok) throw Error(name + " " + response.status);
        this.raw.set(name, await response.arrayBuffer());
      }),
    )
      .then(() => {
        if (this.ctx) this.decode();
      })
      .catch(() => {
        this.status = "fallback";
      });
  }
  private decode(): void {
    if (this.decoding || !this.ctx || this.raw.size !== RECORDED.length) return;
    this.decoding = true;
    Promise.all(
      [...this.raw].map(async ([name, bytes]) => {
        this.buffers.set(name, await this.ctx!.decodeAudioData(bytes.slice(0)));
      }),
    )
      .then(() => {
        this.status = "ready";
        this.raw.clear();
      })
      .catch(() => {
        this.status = "fallback";
      });
  }
  private ensureContext(): AudioContext | null {
    if (this.muted || this.paused || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        const ctx = (this.ctx = new AudioCtx());
        this.bus = ctx.createGain();
        this.master = ctx.createGain();
        this.master.gain.value = 0.7;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 14;
        compressor.ratio.value = 3.5;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.18;
        this.bus.connect(this.master);
        this.master.connect(compressor);
        this.meter = ctx.createAnalyser();
        this.meter.fftSize = 512;
        compressor.connect(this.meter);
        this.meter.connect(ctx.destination);
        const convolver = ctx.createConvolver(),
          send = ctx.createGain();
        send.gain.value = 0.11;
        const impulse = ctx.createBuffer(
          2,
          Math.ceil(ctx.sampleRate * 0.25),
          ctx.sampleRate,
        );
        for (let c = 0; c < 2; c++) {
          const a = impulse.getChannelData(c);
          let seed = 653 + c;
          for (let i = 0; i < a.length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const t = i / ctx.sampleRate;
            a[i] = (seed / 2147483648 - 1) * Math.exp(-t * 24) * 0.06;
          }
          for (const [delay, level] of [
            [0.024, 0.3],
            [0.047, 0.16],
            [0.081, 0.08],
          ])
            a[Math.floor((delay + c * 0.003) * ctx.sampleRate)] += level;
        }
        convolver.buffer = impulse;
        this.bus.connect(send);
        send.connect(convolver);
        convolver.connect(this.master);
        this.decode();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  public unlock(): void {
    this.ensureContext();
    this.prime();
  }
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopSlowMoAtmosphere();
      this.silenceActiveVoices();
    }
    if (!muted) this.ensureContext();
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        muted || this.paused ? 0 : 0.7,
        this.ctx.currentTime,
        0.008,
      );
    }
  }
  public setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.stopSlowMoAtmosphere();
      this.silenceActiveVoices();
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        paused || this.muted ? 0 : 0.7,
        this.ctx.currentTime,
        0.01,
      );
    }
  }
  private silenceActiveVoices(): void {
    if (!this.ctx) return;
    const stopAt = this.ctx.currentTime + 0.015;
    for (const v of this.voices) {
      try {
        v.stop(stopAt);
      } catch {}
    }
  }
  private buffer(name: DesignedSound): AudioBuffer {
    const key = "designed:" + name;
    const old = this.buffers.get(key);
    if (old) return old;
    const data = createCourtSound(name, this.ctx!.sampleRate),
      buffer = this.ctx!.createBuffer(1, data.length, this.ctx!.sampleRate);
    buffer.getChannelData(0).set(data);
    this.buffers.set(key, buffer);
    return buffer;
  }
  private play(
    name: string,
    fallback: DesignedSound,
    gain = 0.7,
    pan = 0,
    delay = 0,
    rateOverride?: number,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.bus || this.voices.size >= 28) return;
    const source = ctx.createBufferSource();
    source.buffer = this.buffers.get(name) ?? this.buffer(fallback);
    const volume = ctx.createGain(),
      panner = ctx.createStereoPanner();
    volume.gain.value = gain;
    panner.pan.value = Math.max(-0.65, Math.min(0.65, pan));
    source.playbackRate.value =
      rateOverride ?? 1 + Math.sin(this.serial++ * 2.399) * 0.035;
    source.connect(volume);
    volume.connect(panner);
    panner.connect(this.bus);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      volume.disconnect();
      panner.disconnect();
    };
    source.start(ctx.currentTime + delay);
    this.counts[fallback] = (this.counts[fallback] ?? 0) + 1;
    this.recent.push({ sound: name, time: +ctx.currentTime.toFixed(3) });
    if (this.recent.length > 8) this.recent.shift();
  }
  public playBounce(pan = 0): void {
    this.play("bounce-" + (1 + (this.serial % 3)), "bounce", 0.76, pan);
  }
  public playFootstep(pan = 0, intensity = 1): void {
    this.play("step", "step", 0.2 + 0.18 * intensity, pan);
  }
  public playCut(pan = 0): void {
    this.play("squeak-" + (1 + (this.serial % 3)), "step", 0.33, pan);
  }
  public playGather(pan = 0): void {
    this.playCut(pan);
    this.play("gather", "gather", 0.55, pan);
  }
  public playLanding(pan = 0): void {
    this.play("step", "step", 0.65, pan);
    this.play("step", "step", 0.4, pan - 0.08, 0.035);
    this.playCut(pan);
  }
  public playShotRelease(): void {
    this.play("flight", "flight", 0.42);
  }
  public playAnswerLock(): void {
    this.play("answer", "answer", 0.5);
  }
  public playDunkSlam(): void {
    this.play("slam", "slam", 0.95);
    this.play("net", "net", 0.6, 0, 0.025);
    this.play("cheer", "net", 0.28, 0, 0.07);
  }
  public playSwish(): void {
    this.play("net", "net", 0.78);
    this.play("cheer", "net", 0.22, 0, 0.06);
  }
  public playRimClank(): void {
    this.play("rim", "rim", 0.72);
  }
  public playBlockSwat(): void {
    this.play("swat", "swat", 0.92);
  }
  public playBuzzer(): void {
    this.play("buzzer", "buzzer", 0.5);
  }
  public playComboChain(chainLevel: number, pan = 0): void {
    const pitch = chainLevel >= 3 ? 1.26 : chainLevel === 2 ? 1.12 : 1.0;
    this.play("combo", "combo", 0.52, pan, 0, pitch);
  }
  public playOnFireIgnite(): void {
    this.play("fire", "fire", 0.68, 0, 0, 1.0);
    this.play("cheer", "net", 0.24, 0, 0.05);
  }
  public startSlowMoAtmosphere(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.bed || !this.bus) return;
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = this.buffer("air");
    source.loop = true;
    filter.type = "lowpass";
    filter.frequency.value = 500;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 0.35);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.bus);
    source.start();
    this.bed = source;
    this.bedGain = gain;
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
  public stopSlowMoAtmosphere(): void {
    if (this.bed && this.ctx) {
      const t = this.ctx.currentTime;
      this.bedGain?.gain.setTargetAtTime(0, t, 0.035);
      try {
        this.bed.stop(t + 0.18);
      } catch {}
    }
    this.bed = this.bedGain = null;
  }
  public diagnostics() {
    let peak = 0;
    if (this.meter) {
      const samples = new Float32Array(this.meter.fftSize);
      this.meter.getFloatTimeDomainData(samples);
      for (const s of samples) peak = Math.max(peak, Math.abs(s));
    }
    return {
      samples: this.status,
      muted: this.muted,
      paused: this.paused,
      context: this.ctx?.state ?? "locked",
      voices: this.voices.size,
      peak: +peak.toFixed(4),
      counts: { ...this.counts },
      recent: [...this.recent],
    };
  }
}
