# CourtIQ — Technical, Educational & Operational Handoff Document

**Version**: `1.0.0`  
**Target Course**: `SPX101 — Introduction to Sports and Exercise Science`  
**Stack**: TypeScript, Three.js, Vite, Node.js (`ws` + HTTP), Netlify Functions, Vitest  
**Live Production URL**: `https://courtiq-spx101.netlify.app`  
**GitHub Repository**: `https://github.com/mathang/courtiq`  

---

## 1. Executive Summary

**CourtIQ** combines a responsive 3D half-court 1v1 arcade basketball game with an authoritative multiple-choice question duel triggered on every shot release.

Key design invariants enforced across the codebase:
1. **Shared Pure Rules (`shared/rules/`)**: All shooting probabilities, speed scores, block eligibility checks, question-duel resolution matrices, possession transitions, and AI decision models are pure, deterministic TypeScript functions shared between the client (`client/`), standalone WebSocket server (`server/`), and Netlify serverless functions (`netlify/functions/`).
2. **Separated Clocks**: Question countdowns, reading locks, and answer timestamps always run on `realClock` (wall-clock milliseconds), completely independent of the slow-motion `simulationClock` and `presentationClock` ($0.14\times$ time scale during a shot duel).
3. **Zero Pre-Resolution Answer Leakage**: In online multiplayer, `toPublicDuelQuestion` strips `correctOptionId` and `explanation` before transmitting `DUEL_PRELOAD` or `MATCH_SNAPSHOT`. Answer keys are revealed only after the duel transitions to `Resolution` / `Feedback`.
4. **Separated Basketball vs. Learning Reporting**: End-of-match reports clearly separate basketball outcomes (score, FG%, 3PT%, blocks) from curriculum mastery (overall learning accuracy, average response time, per-topic breakdown, missed-question review cards, and interactive retry mode), including credit for out-of-range defensive answers (`correct-out-of-range`).

---

## 2. Repository Directory Structure

```text
courtiq/
├── index.html                          # Accessible HUD, Lobby, Question Duel, Feedback & Results UI
├── package.json                        # Scripts (dev, build, server, test) & dependencies
├── tsconfig.json                       # Strict TypeScript configuration across client, shared, server, netlify, tests
├── vite.config.ts                      # Vite bundler & Vitest runner configuration
├── netlify.toml                        # Netlify build, publish ("dist"), functions ("netlify/functions") & redirects
├── project-profile.md                  # Build & Verify safeguard profile
├── verification-ledger.json            # Machine-readable verification evidence ledger
├── content/
│   ├── packRegistry.ts                 # Exports bundled validated SPX101 question packs
│   └── approved-packs/
│       ├── spx101-w09-performance-analysis.json  # 45 approved Week 9 questions
│       └── spx101-w05-measurement-quality.json   # 40 approved Week 5 questions
├── shared/
│   ├── config/
│   │   └── balance.ts                  # Central tunable parameters (probabilities, cones, presets, AI tiers)
│   ├── content/
│   │   └── question-schema.ts          # Pack validator, seeded RNG, per-player option shuffler, answer key stripper
│   ├── protocol/
│   │   └── messages.ts                 # Client <-> Server protocol message definitions
│   └── rules/
│       ├── block.ts                    # Frozen release-time block eligibility geometry
│       ├── timing.ts                   # Speed score S, bounded latency adjustment, 9-outcome duel evaluator
│       ├── shot.ts                     # Base/final shot probability & 4-stage C0/C1 Hermite ball flight spline
│       ├── possession.ts               # Alternating possessions, equal-possession rule, overtime & learning summary
│       ├── aiOpponent.ts               # Pre-committed AI question plan & 1v1 court positioning AI
│       └── matchStateMachine.ts        # AuthoritativeMatchEngine (Lobby -> Possession -> QuestionReady -> Duel -> Resolution -> Feedback -> MatchEnd)
├── server/
│   ├── index.ts                        # Standalone Node HTTP + WebSocket (/ws) + HTTP sync (/api/room) server
│   ├── question-service/
│   │   └── packService.ts              # Server-side question pack loader & non-repeating match draw
│   ├── answer-validation/
│   │   └── duelValidator.ts            # Online submission validation & bounded RTT compensation
│   ├── match-events/
│   │   └── eventLogger.ts              # Sanitized per-slot state snapshot builder & structured event logger
│   ├── simulation/
│   │   └── authoritativeMatch.ts       # Room simulation stepper & broadcast coordinator
│   └── rooms/
│       └── roomManager.ts              # 6-char room lifecycle, reconnect tokens, WebSocket & HTTP sync handler
├── netlify/
│   └── functions/
│       ├── room.ts                     # Serverless POST /api/room endpoint for 2-player online rooms on Netlify
│       └── health.ts                   # Serverless GET /api/health & /api/packs endpoint
├── client/
│   ├── main.ts                         # Application entry point, DOM controller, Solo & Online dual-transport client
│   ├── styles/
│   │   └── main.css                    # High-contrast accessible UI styling & responsive court layout
│   └── game/
│       ├── engine.ts                   # Three.js WebGL renderer, clock separation & render loop
│       ├── court/arena.ts              # Original 3D half-court arena, markings, hoop, stanchion & scoreboard
│       ├── characters/playerCharacter.ts # Articulated 3D player meshes, 4 distinct kits & animation states
│       ├── animation/ballTrajectory.ts # 3D basketball mesh, dynamic arc ribbon & rim lighting effects
│       ├── camera/courtCamera.ts       # Dynamic broadcast & slow-motion framing camera controller
│       ├── input/controls.ts           # Keyboard/touch state machine & accidental-answer prevention guards
│       └── audio/soundEngine.ts        # Contact-timed recorded Foley and designed Web Audio layers
└── tests/
    ├── rules/
    │   ├── shot.test.ts                # Base/final shot probabilities & continuous 4-stage ball trajectory tests
    │   ├── block.test.ts               # Frozen block distance, facing cone, contest lane & bounds tests
    │   ├── timing.test.ts              # Speed score S, tie window, reading lock & all 9 duel outcomes
    │   ├── possession.test.ts          # Alternating possessions, equal-possession win & sudden-death overtime
    │   ├── content.test.ts             # Schema validation, duplicate rejection & option shuffling tests
    │   └── aiOpponent.test.ts          # Pre-committed AI duel plan & difficulty scaling tests
    ├── multiplayer/
    │   └── roomAuthoritative.test.ts   # End-to-end 2-player WebSocket AND Netlify Function (/api/room) tests
    └── accessibility/
        └── uiAndInput.test.ts          # Input guards (held shoot key, key repeat, reading lock) & separated reports
```

---

## 3. Exact Mathematical & Rule Specifications

### 3.1 Shooting Probability Formula (`shared/rules/shot.ts`)

Court geometry and normal shooting probability are recorded at release. At question resolution, the current learning Fire streak adds or removes its bonus while that geometry stays frozen:

| Shot Zone / Condition | Distance to Hoop ($r$) | Value |
| :--- | :--- | :---: |
| **Close & Open** | $r \le 2.8\text{ m}$ | $0.20$ ($20\%$) |
| **Mid-Range & Open** | $2.8\text{ m} < r < 6.75\text{ m}$ | $0.12$ ($12\%$) |
| **Three-Pointer & Open** | $r \ge 6.75\text{ m}$ | $0.07$ ($7\%$) |
| **Heavily Contested Penalty** | Defender $\le 2.6\text{ m}$ and contesting | $-0.05$ ($-5\text{ pp}$) |
| **Released While Sprinting Penalty** | Sprinting or settle timer $> 0\text{ ms}$ | $-0.05$ ($-5\text{ pp}$) |
| **Trick Chain Setup Bonus** | 1x / 2x / 3x clean chain | `+0.02` / `+0.04` / `+0.05` |
| **Learning Fire Bonus** | 3+ consecutive correct answers, until wrong or unanswered; applied after the current answer resolves | `+0.20` (+20 percentage points) |

When the question duel resolves (and is not blocked), the final basket probability is:

$$P(\text{basket}) = \operatorname{clamp}\left(B + C(0.35 + 0.35S),\, 0.03,\, 0.95\right)$$

where:
- $C = 1$ if the attacker submitted the correct option before the deadline, else $0$.
- $S \in [0, 1]$ is the normalized speed score:
  $$S = \operatorname{clamp}\left(1 - \frac{t - R}{T - R},\, 0,\, 1\right)$$
  with $t$ = accepted response time, $R$ = protected reading period ($2.0\text{ s}$ default), and $T$ = question window ($12.0\text{ s}$ default).
- In **Untimed Practice** mode, $C(0.35 + 0.35S)$ is replaced by a flat $+0.55$ accuracy bonus so students are never penalized for reading carefully.

### 3.2 Frozen Block Eligibility (`shared/rules/block.ts`)

At the exact frame the ball leaves the shooter's hands, `evaluateBlockEligibilityAtRelease` freezes four conditions:
1. **Distance**: Euclidean distance on the court plane between shooter and defender $\le 2.6\text{ m}$.
2. **Forward-Facing Cone**: Angle between defender's facing vector and the vector from defender to shooter $\le 100^\circ$.
3. **Contesting Position**: Angle between shooter-to-hoop vector and shooter-to-defender vector $\le 143^\circ$.
4. **In Bounds**: Defender is inside the playable half-court boundaries ($x \in [-7.2, 7.2]\text{ m}$, $z \in [-6.2, 7.2]\text{ m}$).

### 3.3 Nine-Outcome Question-Duel Resolution Matrix (`shared/rules/timing.ts`)

| # | Attacker Submission | Defender Submission | Frozen Block Eligible? | Timing Comparison | Duel Resolution Outcome |
| :-: | :--- | :--- | :---: | :--- | :--- |
| **1** | Correct | Wrong / None | Any | — | `attacker-bonus` (Shot boosted by $0.35 + 0.35S$) |
| **2** | Correct | Correct | Any | $t_{\text{att}} < t_{\text{def}} - 200\text{ ms}$ | `attacker-first-bonus` (Defender cannot block) |
| **3** | Correct | Correct | **Yes** | $t_{\text{def}} < t_{\text{att}} - 200\text{ ms}$ | `defender-block` (Shot is blocked; $0\text{ pts}$) |
| **4** | Correct | Correct | **No** | $t_{\text{def}} < t_{\text{att}} - 200\text{ ms}$ | `defender-correct-out-of-range` (Defender credited in learning log; attacker still gets shot bonus) |
| **5** | Correct | Correct | Any | $|t_{\text{def}} - t_{\text{att}}| \le 200\text{ ms}$ | `tie-attacker-bonus` (Tie within $200\text{ ms}$ favours attacker) |
| **6** | Wrong | Wrong / Ineligible | Any | — | `attacker-wrong-no-bonus` (Base shot $B$ resolves) |
| **7** | Wrong | Wrong | Any | — | `both-wrong-base-shot` (Base shot $B$ resolves) |
| **8** | None (Timeout) | None (Timeout) | Any | $t > T$ | `neither-answered-low-prob` (Base shot $B$ resolves) |
| **9** | Wrong / None | Correct | **Yes** | $t_{\text{def}} \le T$ | `defender-block-after-attacker-miss` (Defender blocks before deadline) |

### 3.4 Continuous 4-Stage Slow-Motion Ball Trajectory (`shared/rules/shot.ts`)

To guarantee that the ball **never teleports** and **never reaches the rim before the question duel resolves**:
1. **`release` ($u \in [0, 0.25]$)**: Ball rises from the shooter's release hand toward the high slow-motion apex.
2. **`question` ($u \in [0.25, 0.72]$)**: Ball glides smoothly in slow motion along the upper arc, asymptotically approaching $u_{\max} = 0.72$ if the duel takes the full window.
3. **`resolution`**: At the exact frame the duel resolves, `transitionBallToResolution` captures the ball's instantaneous 3D position $\mathbf{p}_0$ and velocity $\mathbf{v}_0$ and constructs a $C^0/C^1$-continuous cubic Hermite spline to the resolved target (`make` through the net, `miss` off the rim flange, or `block` swatted by the defender).
4. **`recovery`**: Ball settles to the court floor during the post-shot explanation banner.

---

## 4. Question Pack Authoring & Content Pipeline

Question packs live in `content/approved-packs/*.json` and are validated by `validateQuestionPack` (`shared/content/question-schema.ts`).

### Required Schema Fields
```json
{
  "packId": "spx101-w09-performance-analysis",
  "packVersion": 1,
  "title": "SPX101 Week 9: Performance Analysis & Testing",
  "course": "SPX101",
  "description": "45 teacher-approved questions on performance analysis.",
  "approvedBy": "SPX101 Teaching Team",
  "approvedAtIso": "2026-10-30T00:00:00.000Z",
  "questions": [
    {
      "id": "w09-q01",
      "version": 1,
      "status": "approved",
      "course": "SPX101",
      "week": 9,
      "topic": "Needs Analysis",
      "subtopic": "Physiological & Biomechanical Demands",
      "difficulty": 1,
      "stem": "Before selecting fitness tests for an athlete, what is the primary purpose of conducting a sport-specific needs analysis?",
      "options": [
        { "id": "a", "text": "To identify the key physiological, biomechanical, and injury-risk demands of the sport" },
        { "id": "b", "text": "To guarantee that the athlete achieves a personal best on their first testing session" },
        { "id": "c", "text": "To replace valid field tests with questionnaires" },
        { "id": "d", "text": "To eliminate typical error from all timing gates" }
      ],
      "correctOptionId": "a",
      "explanation": "A needs analysis establishes the sport's specific demands so that selected tests are relevant and valid.",
      "sourceRef": "SPX101 Week 9 — Needs Analysis & Test Selection"
    }
  ]
}
```

### Content Validation Rules (`validateQuestionPack`)
- Only items with `"status": "approved"` are eligible for match draw.
- Every question must have a concise stem ($\le 240$ characters), **exactly 4 options** with unique IDs and unique non-empty text ($\le 140$ characters each), a valid `correctOptionId` matching one of the 4 options, and a non-empty `explanation` ($\le 300$ characters).
- Option order is independently shuffled per player slot on every duel (`shuffleQuestionOptionsForPlayer`) so two students sitting side-by-side cannot copy button positions (`1–4`), while the authoritative server validates submissions by `optionId`.

---

## 5. Multiplayer Architecture (WebSocket + Netlify Functions)

CourtIQ supports two interchangeable authoritative transports:

1. **WebSocket Transport (`/ws` via `npm run server`)**:
   - Persistent full-duplex WebSocket connection running a $20\text{ Hz}$ room simulation loop (`server/index.ts`).
2. **Serverless HTTP Room Sync Transport (`/api/room` via `netlify/functions/room.ts`)**:
   - Designed specifically so 2-player online rooms work out-of-the-box on **Netlify** without requiring a separate persistent Node host.
   - `client/main.ts` automatically falls back to `/api/room` whenever `/ws` is unavailable (such as on Netlify CDN).
   - `RoomManager.handleHttpSync` steps active room simulations by the wall-clock delta between requests, coalesces `MATCH_SNAPSHOT` and `LOBBY_UPDATE` in per-player outboxes, and enforces the exact same answer-key stripping, reading period protection, and bounded RTT fairness rules.

---

## 6. Verification Status & Remaining Risks

### Automated Verification (`PASS`)
- **`npm run build`**: TypeScript strict typecheck (`tsc --noEmit`) across `client`, `shared`, `server`, `netlify`, `tests`, and `content`, followed by Vite production bundle build (`dist/`).
- **`npm test`**: **93/93 passing tests** across 15 test files, including buffered trick chains, Street Flow / On-Fire bounds, counter-steals, AI 2-move chains, both room transports, input guards, shipped player geometry/animation, two-hand triple-threat pocket contact, and possession presentation.

### Remaining Items Requiring Live Classroom Hardware (`NOT_TESTED`)
1. **Multi-Device Campus Wi-Fi Jitter & Cold-Start Evaluation (`NOT_TESTED`)**:
   - While both WebSocket (`/ws`) and Netlify Function (`/api/room`) two-player room flows are verified in automated integration tests, live testing across two physical laptops/tablets on university Wi-Fi is recommended before high-stakes tournament use.
   - Note that serverless Netlify Function instances keep room state in warm container memory (expiring after 15 minutes of inactivity); for large-scale concurrent classroom tournaments (e.g., 50+ simultaneous rooms across multiple geographic regions), running `npm run server` on a single persistent Node container or backing `RoomManager` with Redis/Netlify Blobs is recommended.
2. **Physical iOS / Android Touch Ergonomics (`NOT_TESTED`)**:
   - Virtual joystick and $\ge 44\text{ px}$ touch answer buttons are verified in DOM tests, but should be playtested on physical iPads and Android tablets.
3. **Educational Balance Calibration (`NOT_TESTED`)**:
   - All numeric constants in `shared/config/balance.ts` ($12\text{ s}$ window, $2\text{ s}$ reading period, $200\text{ ms}$ tie tolerance, $0.35 + 0.35S$ answer bonus) are initial playtest values ready for empirical tuning with SPX101 cohorts.


## Street gameplay revision — 31 October 2026

- `shared/rules/streetMoves.ts`: typed move catalogue, runtime validation, shared airborne pose for ball and player rendering.
- `matchStateMachine.ts`: authoritative velocity blending, stamina/cooldowns, move paths, brief defensive wrong-footing and dunk selection. Court bounds, collision separation, shot probability, frozen block eligibility and question rules are retained.
- `aiOpponent.ts`: actually applies the configured reaction delay using a short observation history.
- Character rigs use rounded geometry, articulated elbows/knees, and nameplates drawn from each player's pseudonym. Name textures update only when the name changes.
- Both WebSocket and HTTP room intents carry one-shot trick inputs. HTTP queue coalescing preserves pending tricks and shots. Authoritative simulation consumes each trick intent once.
- Browser hooks: `render_game_to_text()` returns public playing state without answer keys. Calling `advanceTime(ms)` enables deterministic manual stepping until reload (for browser automation).
- Validation: 31 automated tests across nine files; production build; keyboard playtests for all four moves, cooldowns, a drive-to-dunk sequence, protected reading, answer submission, pause/resume and touch controls at 844×390 and 390×844. Visual screenshots inspected; no browser page errors. Actual physical touch devices and campus Wi-Fi remain untested.
- The same-question contract is explicitly tested for question ID, stem, choice IDs/text, reading/answer timing and reveal timestamp through both room transports, as well as exercised on the deployed preview.
- Source checkout for this revision: `/Users/ross_mac/Documents/Codex/2026-10-31/courtiq`.


## Arcade dunk and defense revision — 31 October 2026

- Original user direction: NBA Jam / NBA Street inspired high-flying dunks, manual dunk blocks, and steal swipes with a one-second missed-swipe freeze.
- `dunks.ts` defines four distinct articulated poses and a shared hand/ball trajectory. A dribble-to-hand gather preserves ball continuity. Launch radius 3.4m; take-off 840ms, before the shared question card appears. Body rotation and arm path distinguish tomahawk, windmill, 360 and reverse. Contact sound plays at the visible resolution contact rather than late feedback.
- Controls: R dedicated dunk, V change style (styles auto cycle after shots), B/Space defensive jump, Z swipe. Touch buttons show the current attacking/defending role. New bindings inherit defaults when loading saved configurations.
- Timed physical blocks: defender must satisfy the frozen contest geometry, successfully start a jump outside recovery/cooldown, and have an active jump during the take-off window. The authoritative engine records `physicalBlock` and overrides only the basketball result after the shared question duel; curriculum records remain independent. Late/out-of-range jumps cannot retroactively block.
- Swipes: contact check after 120ms, exposed ball within 1.45m and forward cone, no steal through protected spin/eurostep. A missed swipe roots the defender for 1s, including collision handling. Cooldown 1.35s and stamina cost 0.12 prevent spam. Success transfers live possession, resets the movement clock, advances completed possessions once, and creates `steal-turnover` with no question ID; these events are excluded from learning denominators.
- Both transports latch one-shot intents until a simulation tick consumes them. Neutral frames cannot erase a fast keypress between server updates. Client HTTP queue coalescing preserves all pending actions.
- CourtBot seeks rim attacks on most offensive possessions and sometimes risks swipes/jumps under the same recovery rules.
- Automated coverage: 44 tests across ten files. New tests cover each dunk rig/gather, launch bounds, timed and late blocks, missed-swipe exact root and drive-by, clean live turnover, protected ball/facing, input phase protection, and HTTP one-shot latching/consumption.


## CourtBot positioning and decision fix — 31 October 2026

- Reproduced two failures before editing: a contested rim opportunity waited 12.4 seconds, and the chosen dunk lane changed sign when x crossed zero. Both are protected by new regressions.
- Offensive plans now commit to a lane. Short, stable waypoints route around a defender; lack of positional progress triggers a recovery route. Directional input slows near a destination instead of overshooting. Close, front-of-rim opportunities can finish under pressure; a short decision deadline avoids waiting until the late-clock fallback. AI separation moves use existing authoritative stamina/cooldown rules.
- Defensive positioning adapts its guard gap near the rim and keeps targets on the court side of the backboard. Observations retain the difficulty-specific delay. Swipes require the actual exposed ball to be reachable and forward-facing, with sufficient stamina and no active recovery/cooldown.
- The engine passes public player/ball state into the pure decision function; no human intentions, answers or future positions are inspected. The AI question-plan code is unchanged.
- Verification: 55 tests across eleven files; strict TypeScript and production build; 240 seeded first-possession comparisons, with late-clock fallback shots reduced from 62 to 0. Dedicated local renderer fixture demonstrates the crowded-rim recovery and dunk; normal app browser movement smoke also run. These are software/simulation checks, not a human game-balance assessment.


## Rigged streetball player — 11 November 2026

- `public/assets/player/streetball-player.glb` replaces the procedural model after one shared load. The base humanoid and 65-bone skeleton are Quaternius CC0; source, original licence and mirror provenance are retained. `scripts/build-player.mjs` builds the original kit, shorts, compression sleeve, socks, trainers, hair and skinned jersey surfaces. No Blender installation, paid assets or external animation downloads were used.
- `StreetballRig` is presentation only. Analytic two-bone IK keeps stance feet grounded and follows the shared dunk hand targets. Locomotion, defensive stance/swipe/jump, shot, trick and all four dunk poses use existing public simulation state. Server movement, AI, shot outcomes and question selection are unchanged.
- Each player clones its skeleton and materials. Skin/hair variants, slot-specific gold/cyan kit, 9/5 numbers and dynamic back names remain independent. The original procedural rig is displayed while loading or after an asset failure. Disposed appearances cannot attach after a delayed load; instance materials/textures and fallback geometry are released.
- `player-lab.html` is a separately built page with orbit/zoom, front/back/close-up views, live names and colours, six motion demos, four dunk choices, pause and reduced-motion handling. The lobby links to it. Both the page and GLB are included in the Vite build.
- The model has ten material groups and stays below the 2 MB / 40,000 triangle asset budget. glTF Transform 4.5.1 validation reports no errors or warnings. Preserve unused UVs with `--keep-attributes true`: the jersey material receives a canvas map at runtime, so a general prune would otherwise remove required UVs.
- Verification: 59 tests across 12 suites, including independent skeletons, finite normalised skinning, the UV contract, planted feet and all four dunk contacts at five time points. Browser screenshots inspected for desktop/mobile preview, names/colours, running, dunking, blocking and swiping. Actual two-client WebSocket playtest passed all four dunk styles, timed swats, missed-swipe root, clean steals, shared questions and role-specific touch controls without page errors or horizontal overflow. A simulated failed GLB request retains a playable match. Physical mobile performance and subjective animation/game balance still require human playtesting.

- Release: source commit `5794b4f` on GitHub main; Netlify production deploy `6af3a288d23b4ae44ce6032a`. Live application JS/CSS/model/licence bytes match the build. HTML is verified after the observed Netlify comment/HUD/Pretty URL transformations. Production preview, actual solo match and two-student HTTP regression checks pass. The validator's ten informational unused-UV notices are expected; no errors or warnings were reported.


## Integrated surfaces and continuous motion correction — 11 November 2026

- Replaced separate singlet/shorts/sleeve/sock surfaces with material partitions of the same anatomical mesh and original armature. Clothing boundaries share positions and weights; a regression deforms those seams in bent dunk poses with a1.5mm tolerance. The opaque jersey map includes all artwork on the body surface. Shoes have closed soles, integrated panel colours and laces fitted to their upper surface. Asset:1,005,856 bytes,22,174 triangles,12 mesh groups,65 bones.
- `StreetballRig` now uses cadence based on speed, planted support feet and authored swing/toe-off, shoulder counter-rotation, damped stance/hand targets, active dribbling hands and pose-preserving transitions. Persistent targets remain in local space (a mutation caught by the pause test was fixed). Player Lab requests in-place locomotion explicitly; game locomotion uses world foot contact.
- Shared presentation helpers own the slower dribble and protected spin path, smooth gather/ascent/apex/hold and landing curves, one windmill arc, tomahawk cock and forward finishing hand. The final body offset keeps the head/torso outside the rim; starts directly under the basket step clear during the gather. Visual heading blends through the gather. These shared paths feed solo, WebSocket and HTTP rendering. Question selection, reading/answer clocks, shot probabilities, defensive windows/recovery and AI decisions remain unchanged.
- Player Lab has a full-sequence demonstration, queued motion changes while airborne and a genuinely frozen paused pose. Its basket is placed in the same coordinate frame as the finish; the camera avoids hiding the player behind it.
- Checks:68 tests/13 suites, build and asset validation. Original defects and20 full-sequence frames examined, plus front/back/colour/mobile views, an8-second recording and real-game close inspection. Real two-browser WebSocket test covers all4 dunks, timed block, swipe recovery/steal, same question and portrait role controls. Subjective animation quality and physical phone performance still require human playtesting.

- Correction released: source `317c5e5`, production deploy `6af3af78b608bbe4ee5d8486`. Compiled production motion review passes20 frames/four styles/paused pose/mobile; asset hashes match the build. Normal solo AI dunk within1750ms and deployed student-duel invariants verified. The earlier stale scratch preview was rejected before production and rebuilt after fixing the test fixture type error.


## Actual match review and correction — 11 November 2026

- User requested actual gameplay inspection, especially running and dribbling into dunks. Normal-input solo captures cover tomahawk, windmill, 360 and reverse, both approach lanes, spin/eurostep entries, a nearer-rim finish and CourtBot offence. Enlarged frames and contact sheets were inspected.
- Fixed four reproduced defects: feet snapping at gather; shoes dipping during the crouch; missed/blocked rebound paths brushing the descending head; defender body overlap during blocks. Running foot contacts now carry into the gather, toe point follows push-off, rebounds lead away from the finisher, and the defender keeps body clearance while the nearer hand reaches for the ball. Contest timing, scoring, questions and AI decisions are unchanged.
- Verification: 71 tests across 13 suites and strict production build pass. Actual skinned soles are checked across six launch stride phases to 3 mm court tolerance; miss/swat paths are checked against the deformed head for four styles/four headings. Two real browser clients pass all four styles, timed block, swipe miss recovery/drive-by, clean steal, shared questions and portrait touch controls without page errors or overflow.
- Source `ad3de29` is on GitHub main. Preview `6af3ef94e58e433cb9d01450` passed compiled actual-match and deployed HTTP checks. Production `6af3f085866e9dee1db0cba9` is ready; all 10 application assets match the tested build. Its 58-frame actual match capture and shared-question HTTP check pass. Production AI chose a jump shot; local AI windmill footage is retained separately.
- Evidence: `output/match-review/production-review.jpg`, the four `fixed-*` scenario directories, `contested/browser-report.json`, `hosted-preview/report.json`, `production/report.json`, `production-assets.json`, `remote-release.json`, `tests.txt`, `floor-check.txt`, `build.txt`. One immediate-after-resize headless screenshot cleared the canvas; stable portrait rendering was separately inspected in the two-client test. Physical-phone performance remains untested. No required work is outstanding.


## Polished possession presentation — 11 November 2026

- The shipping player contains 17 keyframed clips. Quaternius CC0 locomotion and jumps are retargeted in `scripts/player-animations.mjs`, with basketball torso accents for cuts, defence and four dunks. `BasketballAnimator` blends speed states in a separate pose buffer; `StreetballRig` adds live ball-hand IK, world foot planting, gather continuity and landing clearance. The independent buffer prevents paused-pose drift. Actual floor-contact edges trigger footsteps, with per-foot cooldowns and no repeated crossover cues. GLB: 1,286,024 bytes, 65 bones, 22,174 triangles, 12 mesh groups. Source and licences are retained. No bespoke motion capture or Blender authoring is claimed.
- `CourtCameraController` directs broadcast, drive, take-off/hold, finish and recovery views. It fits airborne player/ball/hoop bounds above the measured question card, chooses a side that exposes the finisher, eases transitions and adds a restrained impact pulse. Reduced Motion uses steady framing. The renderer adds soft floor shadows and ACES-tonemapped lighting. Portrait questions are capped at 57dvh with internal scrolling and 44px minimum answer targets.
- `PossessionCueTracker` deduplicates visible bounce, move, gather, take-off, rim and landing events across solo and online snapshots. `SoundEngine` mixes seven edited CC0 BigSoundBank recordings with original deterministic DSP, stereo placement, short room reflections, compression, a 28-voice limit and master mute/pause. Seven recordings total 265,260 bytes. `npm run build:audio` uses ffmpeg; normal builds use checked-in WAVs. See `assets/source/README.md` for authors, hashes and licences.
- The lobby's **Preview a full possession** uses ordinary authoritative movement inputs for a drive, crossover and windmill. Any player movement/action interrupts it; the normal curriculum question and match follow. It uses seed 42 and beginner CourtBot only for the preview. Standard matches retain their selected settings. No answer/scoring bypass was introduced.
- Verification: 82 tests across 14 files, strict typecheck and production build; GLB validator reports zero errors/warnings. Actual browser captures cover solo drive-to-dunk, all four contested styles, timed block, swipe freeze/drive-by, clean steal and shared questions. Desktop and portrait full-preview flows each contain 17 captured frames with no page errors/overflow; camera subject bounds, mute and Reduced Motion pass. Final contact fix reduces the first-possession sound count from 39 to 18 step-layer cues (including squeaks/landing), with exactly one gather/take-off/impact.
- Audio was rendered through the actual engine into an OfflineAudioContext: all seven samples decode, mix peak 0.496, RMS 0.0333, and a master mute removes an already-playing effect tail. These are objective software checks; auditory listening and physical-device performance are not claimed.
- Evidence: `output/possession-polish/tests.txt`, `build.txt`, `asset-validation.txt`, `contested/browser-report.json`, `showcase-local/report.json`, `audio-report.json`, `court-audio-review.wav`, and `skill-showcase/`. Current screenshots were opened and examined. Player Lab root interpolation and gather-hand settling also freeze exactly on pause, including mid-gather. Hosted release verification follows below.

- Corrected hosted preview `6af422a3948f91715f6c2cd7` passes all 20-file asset comparisons, compiled desktop/portrait full possession flows, Player Lab pause/name/mode smoke and deployed two-student question/choices/reveal/hidden-key/recovery checks. The earlier preview was not promoted after its pause defect was found.

- Final release: gameplay source `56c18c3` plus hosting-badge layout correction `79d19d9` are on GitHub main. Netlify production `6af425c3b8df11e6c2dbcf0a` is confirmed ready. All 20 deployed files match the tested build; JS/CSS/GLB/WAV/licence comparisons are byte-exact, with only observed Netlify HTML transforms normalised. Both live desktop/portrait full-possession flows pass (18 captures each), including all four answer bounds, native keyboard focus, real hosting-badge clearance, camera subject bounds, mute and Reduced Motion. Current production frames and skill-client capture were opened and inspected. Player Lab names/modes/paused drift0 passed on the same compiled JS; live two-student HTTP parity, hidden keys and swipe recovery pass. The public badge remains visible in a reserved blank question footer.
- Final evidence: `output/possession-polish/showcase-production-final/report.json`, `production-final-assets.json`, `production-final-remote.json`, `production-lab/report.json`, `skill-production-final/`, `netlify-production-final.json`, `tests.txt`, `build.txt`. Physical-phone performance, campus-network load and final speaker/headphone mix still require hands-on review. Audio rendering/timing/mute tests do not substitute for a listening pass. Temporary local Vite servers were stopped.


## AAA Streetball Gameplay, Arena & Teaching Synergy — 11 November 2026

- **Authoritative Input Buffering, Trick Chains & Counter-Steals (`shared/rules/streetMoves.ts`, `shared/rules/defense.ts`, `shared/rules/matchStateMachine.ts`)**: Added `280 ms` authoritative input buffering (`bufferedTrick`, `bufferedFinish`, `bufferedDefense`), 2–3 move distinct trick chains (`>= 65%` cancel window or `360 ms` combo grace, blocking single-move spam), fair first-move crossover/stepback separation ball protection vs `trickOverexposedSec = 0.55 s` anti-spam steal window, smooth jump-shot/fadeaway suspension in `Duel`, and clean `Feedback` standing/celebrate pose reset (`animState !== 'shoot'`). Full `1.0 s` missed-swipe root and `60/30/20/10 Hz` multi-tick parity verified.
- **Learning Fire**: On Fire now comes only from three consecutive correct question answers. It boosts movement by 20% and shooting by 20 percentage points. Wrong or unanswered resets it; basketball outcomes do not. Style momentum remains separate. See the current controls and teaching rules in README.
- **Athlete Pocket IK, Signature Dunks & Floodlit Campus Streetball Arena (`shared/rules/dribble.ts`, `client/game/characters/streetballRig.ts`, `client/game/court/arena.ts`, `client/game/animation/ballTrajectory.ts`, `client/game/engine.ts`)**: Two-hand triple-threat pocket cradle (`hand_l` and `hand_r` `< 0.24 m` from ball), gooseneck jump-shot/fadeaway release, distinct airborne leg silhouettes for `tomahawk`, `windmill`, `360`, and `reverse`, pulsing On-Fire floor aura + ball ribbon trail, pro baseline-clear overhang stanchion (`z = -7.38`), spring-damped breakaway rim flex + backboard shudder + LED perimeter strip + woven-diamond cord net, `2048x2048` multi-plank rock-maple floor, `PCFSoftShadowMap` directional shadows in High quality (disabled in Low), stadium floodlights, Jumbotron/SPX101 banners framed cleanly below `#hud-top`, and articulated 4-part instanced spectators.
- **CourtBot 2-Move Chains, Audio Cutoff & Portrait Badge Clearance (`shared/rules/aiOpponent.ts`, `client/game/audio/soundEngine.ts`, `client/styles/main.css`)**: Intermediate and Advanced CourtBot execute legitimate 2-move chains and punish `1.0 s` missed-swipe freezes using delayed observations only. Added `"combo"` and `"fire"` cues (`peak <= 0.80`, DC `< 0.02`) and immediate active-voice disconnection (`voices === 0`) on mute/pause. Lifted `390x844` portrait `.question-overlay`, `.feedback-overlay`, and `.touch-controls` (`bottom: max(58px, calc(env(safe-area-inset-bottom) + 50px))`) so all 4 options and touch buttons clear the bottom-right Netlify badge at `scrollTop = 0`.
- **Verification & Remaining Human/Hardware Boundaries**: `93/93` tests across `15` suites and strict `npm run build` pass (`PASS`); Apple M4 Pro Metal WebGL measured `16.36–16.59 ms` avg frame time (`~60 FPS`, `p95 19.0 ms`, `20.69 MB` JS heap) while CPU SwiftShader software WebGL measured `65.2 ms` (`PASS`). Physical phone/tablet hardware ergonomics (`NOT_TESTED`), human speaker/headphone listening pass (`NOT_TESTED`), multi-device campus Wi-Fi load & Netlify serverless warm-memory HTTP room persistence across cold starts (`NOT_TESTED` / architectural limit documented), and SPX101 human classroom learning-efficacy (`NOT_TESTED`) remain clearly separated.

## Simplified controls and learning Fire — 12 November 2026

Current controls and pedagogy supersede the historical R/V/B/Z and Street Flow ignition descriptions above. Space shoots or automatically dunks when driving towards the hoop in the visible blue paint, and blocks on defence. C selects crossover/spin/eurostep/stepback with 1/2/3/4+ fresh taps in a fixed 500ms window, and immediately swipes on defence. Random server-selected dunk styles use a separate seeded RNG and avoid immediate repeats. Manual blocks auto-face and reach 2.6m with a 0.02–0.84s takeoff window; missed swipes still root for 1s.

Three consecutive correct questions ignite each student independently (+20% movement, +20pp shooting, final 95% cap). The third answer affects that shot; wrong/unanswered removes Fire before resolution. Geometry and block eligibility remain frozen. Correct learning credit survives basketball misses, blocks and steals. Style flow is separate.

Feedback shows each student their own verdict, selection and a specific wrong-choice rationale, plus correct reasoning/source. It stays until Continue; both online students must confirm using authenticated CONTINUE_FEEDBACK messages. Reconnect restores readiness. Pre-resolution online questions omit keys and all explanations. New rationales cover 255 distractors across the unchanged 85-question packs and require instructor review.

Validation: 124 tests in 17 files and strict production build pass. Actual keyboard/touch browser matches cover all tap counts, Fire ignition/extinction, paint dunk/manual block, steal recovery, shared online questions and per-student reading/Continue. Source/content and deployed-asset audits pass. Rendered evidence and limits are in docs/verification/2026-11-12-simple-controls. Physical-device/campus playtests and human audio listening remain unperformed.

Release: implementation `4affcb3` on GitHub main; production `6af4d6de8a44959c9894be9b` current/ready at https://courtiq-spx101.netlify.app. All 20 production files match the final tested build, with only known hosting HTML transformations; both deployed function hashes match the verified preview. Live browser matches verify every new control, the full Fire cycle, two-student explanations/Continue, primary-action dunk/block and genuine hosting badge clearance. See the release report and inspected production screenshots in `docs/verification/2026-11-12-simple-controls`.
