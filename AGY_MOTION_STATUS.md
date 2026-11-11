# AGY Motion Implementation Status

## Session & Included-Plan-Only Gate
- **Model & Effort**: `gemini-4-carbon-high`, effort high (`useG1Credits: false`).
- **Cost & Service Compliance**: Included plan only; zero extra-credit fallback, purchases, plan upgrades, paid APIs, external LLM calls, paid assets, generation services, hosting overages, or new cloud services. Global account/billing settings untouched.
- **Editable Worktree**: `/Users/ross_mac/Documents/Codex/2026-10-31/courtiq-agy-motion-20261112`
- **Branch**: `feat/carbon-high-basketball-motion`
- **Author**: `Ross Clark <22501916+mathang@users.noreply.github.com>`

## Freshness Gate & Startup Baseline (`2026-11-12T08:34+10:00`)
- `pwd`: `/Users/ross_mac/Documents/Codex/2026-10-31/courtiq-agy-motion-20261112`
- `git rev-parse HEAD`: `22a46b0f3ab6cae809ce307f1d61e84d9498f440`
- `git rev-parse origin/main`: `22a46b0f3ab6cae809ce307f1d61e84d9498f440`
- `git status --short` at startup: clean (empty)
- **Baseline `npm test`**: **PASS** — 19 test files, 141 tests (`vitest run`, 3.25s)
- **Baseline `npm run build`**: **PASS** — `tsc --noEmit && vite build` (638ms)

## Parallel-Work Contract & Scope
- **Edited files**:
  - `shared/rules/dribble.ts`
  - `shared/rules/matchStateMachine.ts`
  - `client/game/characters/basketballAnimator.ts`
  - `client/game/characters/streetballRig.ts`
  - `client/game/characters/playerCharacter.ts` (6-line motion-only turn-delta adjustment inside `update()`; constructor, appearance presets, GLB loading, and fitted jersey/socks untouched)
- **Added files**:
  - `tests/rules/basketballMotorAndDribble.test.ts` (6 before/after motor & ball-continuity regression tests)
  - `tests/render/motionContinuity.test.ts` (4 before/after 3D rig footwork, sole-clearance, gather-palm, elbow-pole & spin-cancel regression tests)
  - `AGY_MOTION_STATUS.md`
- **Untouched**: sibling canonical checkout, lobby/main UI/player lab UI, appearance protocol fields, character asset builder, generated GLBs/audio, question packs, global docs/verification ledger, dependencies, hosting config, ports `8787`, `5173`, `4173`, `8788`. Coordination file `AGY_MOTION_INTEGRATION_NOTES.md` left uncommitted as requested. `PlayerCharacter3D(slot, presetId)`, `StreetballRig`, and `tests/render/playerAsset.test.ts` remain compatible with both 65-bone athletes.

## Implemented Changes
1. **Responsive Basketball Motor (`shared/rules/dribble.ts`, `shared/rules/matchStateMachine.ts`, `client/game/characters/playerCharacter.ts`)**:
   - Added `computeBasketballFacingAngle` and bounded `stepAngleTowards` after `stepPlayerMotion` so defenders stay squared/angled to the ball-handler through retreats and lateral slides (preserving live block eligibility), ball-handlers keep chest/eyes open toward the rim during non-sprint retreats/size-ups, and hard stops settle without `135°` single-frame facing snaps.
   - Added sharp reversal cut detection (`velDotDir < 0.2` at `speed > 1.8 m/s`) with extra plant braking (`1.42x`) and `plantSec` impulse for rig hip compression and push-off, while preserving fluid bump/slide contact (`contact.ts`), directional steering through off-balance reactions and block jumps, and the exact `1.0s` deliberate missed-swipe root.
   - Aligned `animState` with actual world speed (`> 0.52 m/s`) rather than raw key intent alone.
   - Used `Math.max(presentationDeltaSec, realDeltaSec)` for yaw alignment during `finishKind` and `defenseAction === 'jump'` in `PlayerCharacter3D.update` so shooters and blockers square cleanly during `0.14x` slow-motion `QuestionReady` while remaining frozen when paused (`realDeltaSec = 0`).

2. **Planted Footwork & Animator Continuity (`client/game/characters/basketballAnimator.ts`, `client/game/characters/streetballRig.ts`)**:
   - Updated `BasketballAnimator` so non-cyclic action clips (`court_block`, `court_swipe`, `court_crossover`, `court_spin`, `court_dunk_*`, etc.) hold their final phase while blending out instead of rewinding to `phase = 0` at `74%` blend weight; filtered crouch/airborne `footHeights >= 0.35m` while keeping locomotion clips (`court_jog` `0.247m`, `court_sprint`, etc.).
   - Unified world-space support-foot planting and deliberate swing release in `StreetballRig` across idle, walk/jog/sprint (with duty-factor flight scaling above `4.6 m/s`), lateral defensive shuffles (enforcing uncrossed stance separation), reversal cuts (`plantPulse` hip sink), gather/take-off, and landing.
   - Enforced geometric toe/heel sole clearance (`target.y >= 0.092 + max(0, 0.255*sin(toe), -0.09*sin(toe))`) so pitched toes and heels stay above `y = 0` on court, and preserved exact paused-pose invariance (`step = 0` holds `state.current` and `spinYaw` to `< 1e-7`).

3. **Ball & Hand Continuity (`shared/rules/dribble.ts`, `shared/rules/matchStateMachine.ts`, `client/game/characters/streetballRig.ts`)**:
   - Added persistent `stepDribbleState` (`dribbleHand`, `dribbleSide`, `moveStartSide`, `dribbleBlend`, `handSwitchCooldownSec`): crossovers and eurosteps flip and retain the new carrying hand (aligning neutral-stick crossover burst with the new hand), close defender shade (`< 2.25m`) triggers body-shield protection on the away hand, and open wing drives use the outside lead hand.
   - Replaced floor-chasing hand targets with a `C1`-smooth waist/hip dribble pocket (`worldPocketY = (streetMove ? 0.76 : 0.82) + smoothMotion(bouncePhase) * 0.16`), smooth midline crossover handoff (`smoothstep(point.x, -0.09, 0.09)`), protective off-hand guard bar, and two-hand triple-threat cradle at rest.
   - Added `jumpShotGatherBallPosition` (quadratic Bézier gather from `dunkBallStart` through set pocket onto `ballFlight`, with `0..0.18s` pre-release hold in `stepQuestionReadyPhase`) and matching two-hand jump-shot / dunk gather grips so palms meet the actual ball before release/flush.
   - Added continuous `spinYaw` tracking/unwind across spin-cancels (`spin -> dunk`, `spin -> crossover`), smooth `jumpArc` block-contest arms, and an elevation-adaptive arm pole vector (`smoothstep(handPos.y, 1.3, 1.9)`) with collinearity guard to eliminate overhead elbow flips.

## Before -> After Measurements

| Metric | Baseline (`22a46b0f`) | After Implementation |
| --- | --- | --- |
| Retreating defender facing error & live block status | `179.8°` (`not-facing-shooter`, ineligible) | `0.0°` (`eligible`; `5.8°–17.3°` during live diagonal slide+retreat) |
| Lateral defensive slide foot separation & grounded slip | `-0.032m` (legs crossed), `0.297m/frame` slip | `+0.169m` min separation (`0` crossed frames), `0.000m` grounded slip |
| Hard-stop single-frame snap (`16.7ms`) | `135.3°` facing snap, `0.782m` ball snap | `4.2°` max facing step, `0.091m` max ball step |
| Crossover ball continuity (`moveX = ±1`) | `0.502m–0.648m` 1-frame snap, reverted to `+1` | `0.105m–0.238m` smooth cross, keeps new carrying hand |
| Sprint -> reversal cut -> crossover -> stop footwork | `0.983m` max foot step, `0.258m` slip, `-0.0461m` sole clip | `0.255m` max foot step, `0.000m` grounded slip, `+0.0054m` min sole `y` |
| Jump-shot initiation ball step & gather palm-to-ball gap | `1.945m` frame-0 teleport, `1.253m` palm gap | `< 0.01m` frame-0 step, `< 0.09m–0.18m` palm-to-ball gather contact |
| Overhead block-jump elbow pole step (`16.7ms`) | `0.422m` 1-frame elbow flip | `0.091m` max elbow step |
| Spin -> Dunk / Crossover cancel body yaw step & hand height | `86.0°` (`1.50 rad`) 1-frame snap | `<= 16.0°–20.1°` (`0.28–0.35 rad`) smooth unwind, `minHandY: 0.79m` |
| Paused-pose drift (`dt = 0` mid-spin / mid-stride) | Non-zero clip phase rewind on transitions | `< 1e-7` rad/m exact freeze |

## Checks Run & Evidence
- **Unit, Render & Authoritative Multiplayer Suite (`npm test`)**: **PASS** — 21 / 21 test files, 151 / 151 tests passed (all 141 baseline tests + 10 new regression tests).
- **Strict TypeScript & Production Build (`npm run build`)**: **PASS** — `tsc --noEmit && vite build` clean (`dist/` built locally in this worktree).
- **Live Normal-Input Browser Matches (Apple M4 Pro Metal Chromium, `--use-angle=metal`, isolated ports `5183` & `8793`)**: **PASS** (`0` console/page errors, `0` requests to forbidden ports `8787`/`5173`/`4173`/`8788`):
  - **Desktop (`1440x900`)**: Verified lobby 3D models (`["ready","ready"]`), controlled jog retreat (`5.95 m/s`, `17°` rim-open facing), sprint + sharp reversal cut (`plantSec = 0.143s`) + hard stop (`0 m/s`), live crossover carry-hand flip (`-1 -> +1`), spin into paint drive, primary-action (`Space`) random authoritative dunk (`tomahawk` and `360` observed across runs) through gather/take-off (`QuestionReady`), rim hang (`Duel`), answer unlock/submission (`Digit1`), flush/landing (`Resolution`), feedback + Continue, and defensive lateral retreat/slide (`17.3°` facing alignment to attacker).
  - **Live Defense & Two-Student Online Contract (`http://localhost:8793`)**: Verified exact `1.0s` missed-swipe root (`initialRecoverySec: 1.0`, `midRootSpeedMps: 0` at `+0.45s`, `postRootSpeedMps: 5.5` after `1.0s`), directional control during defensive block jump (`speedWhileJumpingMps: 3.96`, `court_block`), identical shared online question stem across both students, zero pre-resolution leakage (`hasCorrectOptionId: false`, `hasExplanation: false`, `hasOptionFeedback: false` across all 11 pre-resolution WS packets), and both-student Continue gate (`Feedback` after Student A alone -> `Possession` after Student B also clicks Continue).
  - **Mobile (`390x844`, touch enabled)**: Verified virtual joystick + sprint/trick/shoot touch controls, crossover ankle-breaker drive (`6.15 m/s`), jump shot into shared question duel, and all 4 mobile question buttons inside `390x844` (`344x46px`, `overlaps: 0`, `allInViewport: true`).
  - **Evidence directory** (inspected PNG captures + telemetry JSON):
    `/Users/ross_mac/.gemini/antigravity-cli/brain/f3a34191-a782-47c3-a352-7e55a078f959/captures/`
    (`01-desktop-lobby.png` through `15-mobile-390x844-feedback.png` and `live_match_verification_report.json`).
- **Physical Phone Hardware & Human-Ear Audio Listening**: **NOT_TESTED** (automated headless Apple M4 Pro Metal Chromium + `390x844` touch emulation only).

## Candid Limits
- Locomotion and ball-hand contact run via measured procedural curves, 17-clip pose blending, and analytical two-bone IK on the existing 65-bone streetball rig rather than AAA motion-matching mocap databases, full-body physics/cloth simulation, or finger-per-phalange contact solving.
- During live dribbling the carrying hand tracks a smooth waist/hip reception pocket above the bounce rather than physically simulating palm-ball contact impulses on every bounce frame.
- Temporary verification servers on ports `5183` and `8793` were stopped and verified free after capture.

## Commits on `feat/carbon-high-basketball-motion`
- **Baseline (`origin/main`)**: `22a46b0f3ab6cae809ce307f1d61e84d9498f440`
- **Implementation & Regression Tests**: `f4599d33500fa156438343a1c9dcabacc65057c1`
- **Remaining Work**: None in this worktree; ready for Codex sibling integration across both 65-bone athletes and final combined verification/release.
