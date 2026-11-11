# CourtIQ — Slow-Motion Basketball Question-Duel Learning Game

- **Live Production App (Netlify)**: [https://courtiq-spx101.netlify.app](https://courtiq-spx101.netlify.app)
- **GitHub Repository**: [https://github.com/mathang/courtiq](https://github.com/mathang/courtiq)

**CourtIQ** is an original browser-based 3D half-court basketball learning game built for **SPX101 (Introduction to Sports and Exercise Science)**. Every shot attempt triggers a slow-motion multiple-choice question duel:

1. **Positioning creates the opportunity**: Create space inside or outside the 3-point arc on offense, or stay within contesting range ($\le 2.6\text{ m}$, forward-facing cone) on defense.
2. **Knowledge determines the advantage**: As the ball rises in slow motion, both players receive the same curriculum question.
3. **Speed and accuracy resolve the shot**:
   - A correct attacking answer significantly boosts basket probability, with a higher bonus for answering sooner after the reading period.
   - An in-range defender who answers correctly before the attacker (outside the $200\text{ ms}$ tie tolerance) **blocks the shot**.
   - An out-of-range defender who answers correctly still earns full credit in their learning record (`correct-out-of-range`) without producing a physical block.
4. **Personal learning feedback**: Each student sees whether they were correct, their chosen answer, an explanation of their specific wrong choice, the correct reasoning and the course source. Feedback waits for Continue; online, both students must continue.

---

## Streetball Flow, Trick Chains & Floodlit Arena

- **280 ms Input Buffering & Legitimate 2–3 Move Trick Chains**: Queue crossovers, spins, eurosteps, stepbacks, dunks, jumpers, and blocks seamlessly through active move recovery (`>= 65%` cancel window or `360 ms` combo grace into a distinct move, e.g., `Crossover -> Spin -> Windmill` or `Crossover -> Stepback -> Fadeaway`). Clean first crossovers and stepbacks protect the ball during separation, while greedy repeat move spam near a defender exposes the ball (`0.55 s` counter-steal window).
- **Learning-powered On Fire**: Three consecutive correct answers ignite Fire for that student. Fire gives 20% faster movement and +20 percentage points to shooting, capped at 95%; physical and question-based blocks still override. A wrong or unanswered question ends Fire. Makes, misses and steals do not change the learning streak. Clean trick chains continue to earn small shot setup bonuses, separately from Fire.
- **Floodlit Campus Streetball Arena & Pro Overhang Hoop**: Pro baseline-clear overhang stanchion (`z = -7.38`, zero dunk/drive stanchion clipping), spring-damped breakaway rim flex, backboard shudder, reactive LED backboard frame, woven-diamond cord net, `2048x2048` multi-plank maple court, `PCFSoftShadowMap` directional shadows in High quality (cleanly disabled in Low/Classroom), stadium floodlights, articulated 4-part courtside spectators, and two-hand triple-threat ball cradle.
- **CourtBot Chains & Mobile Hosting-Badge Clearance**: Intermediate and Advanced CourtBot execute legitimate 2-move separation chains and punish `1.0 s` missed-swipe freezes while preserving delayed observations. On `390x844` portrait viewports, both the 4-option question duel card and touch controls clear bottom-right hosting badges without scrolling.

## Polished possession — 11 November 2026

Choose **Preview a full possession** in the lobby to watch a drive, crossover, spin and a randomly styled take-off, answer the normal question, then see the finish and landing. Movement immediately takes control, and the match continues normally afterwards.

The player now carries 17 keyframed clips, with blended walk/jog/sprint, basketball accents, planted feet and hand/ball contact. A possession camera follows the approach, shifts for take-off and keeps the airborne action above the question card. Reduced Motion uses steady framing. Soft floor shadows and brighter arena lighting improve depth.

Recorded CC0 ball, shoe and crowd sounds sit alongside original designed impacts and net sounds. Cues follow visible contacts, with bounded voices, immediate master mute and pause handling. The player GLB is 1.29 MB; seven audio recordings total 265 kB. Provenance, licences and rebuild instructions are in [assets/source/README.md](assets/source/README.md).

## Integrated kit and smoother motion — 11 November 2026

The singlet, shorts, sleeve and socks share the skinned body surface, removing the floating cuffs and intersecting clothing shells. Jersey names and numbers are mapped directly onto the singlet.

Movement now blends between stances and moves, with a calmer shared dribble, hand changes during crossovers, planted running support feet, a single windmill sweep, a smoother gather and a cushioned landing. Close dunk launches step clear of the rim. Open the [Player Lab](https://courtiq-spx101.netlify.app/player-lab.html) and choose **Full move sequence** to inspect a dribble, run, spin, dunk, landing and defensive recovery together. Pause holds the entire pose; an airborne preview finishes landing before a queued change of move.

## Rigged player and Player Lab — 11 November 2026

[Open the Player Lab](https://courtiq-spx101.netlify.app/player-lab.html) for an orbitable close-up with a live jersey name, two team colours, four skin/hair colour variants, and dribble/run/defend/dunk/block/swipe demos. The rigged player also appears in normal solo and student-versus-student matches. Both players keep their own skeleton, appearance, number and jersey name.

The 65-bone Quaternius CC0 humanoid has original CourtIQ clothing, trainers, hair and jersey artwork. Keyframed locomotion from Quaternius's CC0 animation library is retargeted onto the player, with basketball accents and two-bone IK for planted stances and dunk hand contact. The original procedural rig remains playable during loading or a failed asset download. See [asset provenance and rebuilding](assets/source/README.md).

`npm run build:player` regenerates and optimises the GLB with pinned glTF Transform tools. The checked-in asset is used by normal `npm run build`; rebuilding it is optional. Preserve the jersey UV attribute during optimisation because names and numbers are mapped at runtime.

## Simple controls and learning streaks — 12 November 2026

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move / Turbo | WASD or arrows / Shift | Joystick / SPRINT |
| Shoot / automatic dunk on offence; jump block on defence | Space | SHOOT / DUNK / BLOCK |
| Trick on offence; immediate steal swipe on defence | C | TRICK / STEAL |
| Answer | 1–4 | Tap an option |
| Fullscreen | F (Esc exits) | Browser fullscreen controls |

Tap the trick key in a fixed **500 ms window**: **1 crossover, 2 spin, 3 eurostep, 4+ stepback**. Holding does not add taps. A primary action during the window commits the selected trick and buffers the finish. Moves cost stamina and recharge; repeating a trick into a close defender can expose the ball.

The primary action attempts a dunk when the player is **inside the visible blue paint and actually moving towards the hoop**. Standing, moving away or shooting outside the paint gives a jumper. Tomahawk, windmill, 360 and reverse finishes are chosen by the authoritative simulation, without immediate repeats. No style selection is needed.

On defence, press or hold **Space** during the dunk take-off. The jump faces the attacker automatically, with a **2.6 m** reach and a wider reaction window. Distance, court position, recovery and timing still matter. Both physical swats and question-based blocks override shooting boosts, while correct answers still earn learning credit.

**C** immediately swipes for a steal on defence. A missed swipe roots the defender for **1 full second**. Swipes retain their reach, stamina and cooldown requirements. A steal changes possession at the live location and does not count as an incorrect or unanswered question.

In **student-versus-student rooms**, both students receive the same question, choices, reading period and answer deadline. Choice order can differ. Public online payloads omit answer keys and explanations until resolution. Each student gets their own correct/incorrect/unanswered verdict and selected-option feedback. Neither can dismiss the other student's explanation: both confirm Continue before play resumes.

Each student's HUD tracks **three consecutive correct answers** towards **“HE’S ON FIRE!”**. Fire gives **20% faster movement** and **+20 percentage points** to shooting, up to 95%. The third correct answer boosts that shot too. Wrong or unanswered questions reset the streak; a basketball miss or block does not. Learning results remain separate from basketball scores.

All **255 wrong choices across 85 bundled questions** have a specific explanation, derived from the existing course questions and reasoning. These new rationales are **draft additions for instructor review**; original stems, choices, answer keys, explanations and source references are unchanged. Custom packs can supply `optionFeedback` keyed by stable option ID; packs without it retain their existing explanation.

Solo settings pause the match. Controls can be remapped; old movement/shot bindings are preserved and an old crossover binding migrates to the single trick key. Mobile has two game actions plus Sprint and the joystick. Question and feedback controls clear the hosting badge.

## Quick Start

### Prerequisites
- **Node.js** 18+ and **npm**

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Run the automated test suite (93 tests across 15 suites)
npm test

# 3. Start the Vite development server (Solo mode vs. AI & Content Validator)
npm run dev

# 4. Build production bundle and run the authoritative server (HTTP + WebSocket on port 8787)
npm run build
npm run server
```

---

## Controls & Accessibility

| Action | Desktop Keyboard (Default, Remappable) | Touch / Tablet |
| :--- | :--- | :--- |
| **Move** | `WASD` or Arrow Keys | Left Virtual Joystick |
| **Sprint** | `Shift` | `SPRINT` Button |
| **Shoot** | `Space` | `SHOOT` Button |
| **Select Answer (A–D)** | `1`, `2`, `3`, `4` | Four Large Option Buttons (`≥ 44px` targets) |
| **Settings / Pause** | `Escape` | Top-Right `Settings & Controls` Button |

### Built-In Input Safeguards
- Movement and shooting keys are ignored while a question duel is active.
- Holding `Space` to shoot **cannot** accidentally trigger an answer option.
- Keyboard `event.repeat` is ignored so held keys never submit multiple answers.
- During the protected reading period ($2.0\text{ s}$ default), answer buttons are visibly locked (`Reading Period…`) before unlocking simultaneously for both players.
- Each player receives **exactly one** locked submission per shot duel.

### Accessibility Features
- **High-Contrast UI**: High-contrast text badges (`2PT`, `3PT`, `BLOCK READY`, `LOCKED`) never rely on colour alone.
- **Reduced Motion Mode**: Toggleable in Settings; dampens camera zoom/sway and particle flashes during slow-motion duels.
- **Graphics Quality Selector**: Switch between `High` and `Low / Classroom` rendering profiles for older laptops and tablets.
- **Remappable Keys**: Rebind movement, sprint, shoot, and answer keys (`1–4`) directly in the Settings modal.

---

## Game Modes & Presets

### Modes
1. **Solo vs. CourtBot AI**: Play offline or online against an AI opponent (`Beginner / Rookie`, `Intermediate / Varsity`, or `Advanced / Pro`) whose answer correctness and response time are committed at duel start using seeded probability distributions.
2. **Full Possession Preview**: Drives through a crossover and windmill into the normal question duel in one click. Movement immediately takes over; the match continues after the finish.
3. **2-Player Online Private Room**: Create a 6-character room code and join from a second device. Supports both persistent WebSockets (`/ws` via `npm run server`) and serverless HTTP room synchronization (`/api/room` via Netlify Functions).
4. **Teacher Question-Pack Validator**: Paste or load custom JSON question packs in the browser to validate schema compliance, option uniqueness, reading windows, and explanations, then playtest immediately.

### Timing Presets
| Preset | Question Window ($T$) | Protected Reading ($R$) | Speed Bonus Weight |
| :--- | :---: | :---: | :---: |
| **Arcade** | $9\text{ s}$ | $1.5\text{ s}$ | $0.45$ |
| **Standard** | $12\text{ s}$ | $2.0\text{ s}$ | $0.35$ |
| **Extended Reading (Learning)** | $16\text{ s}$ | $3.5\text{ s}$ | $0.20$ |
| **Untimed Practice** | Untimed ($60\text{ s}$) | $2.0\text{ s}$ | $0.00$ (Fixed $+0.55$ accuracy bonus) |

### Session Length Presets
- **Quick Match**: First to $7$ points, maximum $6$ possessions each.
- **Standard Match**: First to $11$ points, maximum $10$ possessions each.
- **Extended Match**: First to $15$ points, maximum $14$ possessions each.
- **Equal-Possession Fairness**: Both players always receive an equal number of attacking possessions before a winner is declared, with paired sudden-death overtime possessions if tied.

---

## Bundled SPX101 Question Packs

| Pack ID | Title | Approved Questions | Topics Covered |
| :--- | :--- | :---: | :--- |
| `spx101-w09-performance-analysis` | **SPX101 Week 9: Performance Analysis & Testing** | **45** | Needs Analysis, Test Selection & Sequence, Typical Error & SWC,Force–Time & Jump Analysis, Normative Benchmarking & Z-Scores, Feedback & Re-Testing |
| `spx101-w05-measurement-quality` | **SPX101 Week 5: Measurement Quality, Validity & Reliability** | **40** | Validity Types, Reliability & ICC, Typical Error & CV%, Systematic vs Random Error, Standardisation & Calibration |

---

## Deploying to Netlify

This repository includes [`netlify.toml`](./netlify.toml) and serverless functions in [`netlify/functions/`](./netlify/functions):
- `netlify/functions/room.ts` (`/api/room`): Authoritative 2-player room synchronization for serverless Netlify deployments.
- `netlify/functions/health.ts` (`/api/health` & `/api/packs`): Health and question-pack metadata endpoint.

### Deploy via Netlify CLI
```bash
npm run build
npx netlify-cli deploy --prod
```

---

## Documentation

- **[`HANDOFF.md`](./HANDOFF.md)**: Complete technical, mathematical, architectural, and operational handoff guide.
- **[`project-profile.md`](./project-profile.md)**: Build & Verify safeguard profile.
- **[`verification-ledger.json`](./verification-ledger.json)**: Machine-readable verification evidence ledger.

## CourtBot positioning fix — 31 October 2026

CourtBot now commits to a driving lane, routes around a planted defender, slows down near its destination and finishes close-range opportunities instead of waiting for an open shot until the movement clock is almost gone. It can use separation moves, recover from the baseline/backboard area and return to a wing defender position. Steal attempts check exposed-ball reach, facing, stamina and recovery/cooldown availability. Difficulty-specific reaction delays and pre-committed course-question answers are retained.

Regression evidence: the original crowded-rim scenario delayed its shot until 12.4s; the same seeded case now finishes promptly. A comparison of 240 seeded first-possession scenarios across all three difficulties (crowded rim, lane defender, behind basket and open floor) reduced late-clock fallback shots from 62 to 0. This is deterministic simulation evidence; subjective game balance still requires playtesting.
