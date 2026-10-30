# CourtIQ — Slow-Motion Basketball Question-Duel Learning Game

**CourtIQ** is an original browser-based 3D half-court basketball learning game built for **SPX101 (Introduction to Sports and Exercise Science)**. Every shot attempt triggers a slow-motion multiple-choice question duel:

1. **Positioning creates the opportunity**: Create space inside or outside the 3-point arc on offense, or stay within contesting range ($\le 1.8\text{ m}$, forward-facing cone) on defense.
2. **Knowledge determines the advantage**: As the ball rises in slow motion, both players receive the same curriculum question.
3. **Speed and accuracy resolve the shot**:
   - A correct attacking answer significantly boosts basket probability, with a higher bonus for answering sooner after the reading period.
   - An in-range defender who answers correctly before the attacker (outside the $200\text{ ms}$ tie tolerance) **blocks the shot**.
   - An out-of-range defender who answers correctly still earns full credit in their learning record (`correct-out-of-range`) without producing a physical block.
4. **Immediate explanatory feedback**: After the ball completes its flight, both students see the correct answer, concise explanation, and course source reference before possession alternates.

---

## Quick Start

### Prerequisites
- **Node.js** 18+ and **npm**

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Run the automated test suite (21 tests across 8 suites)
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
| **Select Answer (A–D)** | `1`, `2`, `3`, `4` | Four Large Option Buttons (`≥ 48px` targets) |
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
2. **1-Click Shot Duel Preview**: Launches directly into a live slow-motion shot and question duel from the wing so instructors or students can preview the core mechanic in one click.
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
