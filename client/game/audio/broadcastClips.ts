export interface BroadcastClip {
  readonly text: string;
  readonly voice: 'female' | 'male';
  readonly start: number;
  readonly duration: number;
}

// Positions in seconds in the bundled Qwen3-TTS recording. Each cue variant has one announcer.
export const BROADCAST = {
  tipoff: [
    { text: "Game on! Light up the court!", voice: "female", start: 0.1, duration: 1.83 },
  ],
  dunk: [
    { text: "Roof rattler! That rim felt it!", voice: "female", start: 2.01333, duration: 2.11 },
    { text: "Straight through the skyline!", voice: "male", start: 18.06687, duration: 1.86 },
  ],
  three: [
    { text: "From the deep end! Splash!", voice: "female", start: 4.20667, duration: 1.89 },
    { text: "Three on the board! Turn up the lights!", voice: "male", start: 20.01021, duration: 2.53 },
  ],
  basket: [
    { text: "Threaded the rim! Count it!", voice: "female", start: 6.18, duration: 1.79 },
    { text: "Clean finish! Make that two!", voice: "male", start: 22.62354, duration: 2.25 },
  ],
  block: [
    { text: "Door slammed! What a stop!", voice: "female", start: 8.05333, duration: 1.86 },
    { text: "The rim is closed for business!", voice: "male", start: 24.95688, duration: 1.87 },
  ],
  steal: [
    { text: "Pocket picked! The floor just flipped!", voice: "female", start: 9.99667, duration: 2.14 },
    { text: "Quick hands! New ball game!", voice: "male", start: 26.91021, duration: 2.15 },
  ],
  miss: [
    { text: "The rim wins that round!", voice: "female", start: 12.22, duration: 1.52687 },
    { text: "Off the iron! Next possession!", voice: "male", start: 29.14354, duration: 2.14688 },
  ],
  fire: [
    { text: "Three straight right! The court is heating up!", voice: "female", start: 13.83021, duration: 2.57 },
  ],
  stepback: [
    { text: "Back-step lightning!", voice: "male", start: 16.48354, duration: 1.5 },
  ],
  clock: [
    { text: "The clock takes this one!", voice: "male", start: 31.37375, duration: 1.68 },
  ],
} as const satisfies Record<string, readonly BroadcastClip[]>;

export type ArcadeCue = keyof typeof BROADCAST;
