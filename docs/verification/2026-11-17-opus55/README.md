# Opus 5.5 High: critical appraisal and improvement pass, 17 Nov 2026

* **Baseline:** GitHub main `a4c837be4bb47214163e2f1833704a1c20ba507b`. The live deploy `6af6b7046336772e72d92fcd` was built from this commit.
* **Branch:** `feat/opus55-critical-improvements-20261117`. It is a single commit on top of the baseline; see `release.json` for the commit hash.
* **Appraisal:** [`docs/OPUS55_CRITICAL_APPRAISAL.md`](../../OPUS55_CRITICAL_APPRAISAL.md).

## What changed

1. **CourtBot's steal success now depends on difficulty** (`shared/config/balance.ts`, `shared/rules/matchStateMachine.ts#stealConnects`).
   * Chance a swipe connects: Beginner 0.30, Intermediate 0.55, Advanced 0.80.
   * The roll uses a separate seeded RNG stream, so question selection is not affected.
   * An over-exposed handle (spamming tricks into a defender) is always stolen.
   * Human swipes are unchanged.
2. **Better framing on phones held sideways** (`client/game/camera/courtCamera.ts`, `client/styles/main.css`, `index.html`).
   * In short, wide viewports the camera moves in until both players, the rim and the ball fill the safe band. The thumb-control columns stay clear.
   * The HUD is a single 52 px row: icon-only utility buttons with aria-labels and 44 px targets.
3. **The game now explains defensive outcomes** (`shared/rules/defensiveReads.ts`, `shared/rules/block.ts`, `client/main.ts`, tutorial).
   * The question card gives a short, role-specific reason why a block is or isn't available.
   * The live block pill is also role-specific.
   * On touch devices, hints name the on-screen buttons, not keyboard keys.
   * A "DEFENDER SET • STEER AROUND OR TAP TRICK" cue appears when the player dribbles straight into a ready defender.
   * After a steal, the message suggests steering around next time.
4. **Ankle-breakers depend on spacing** (`shared/rules/defense.ts`, `shared/rules/matchStateMachine.ts`).
   * The wrong-foot freeze is graded: full within the 1.45 m steal reach, none from 2.55 m.
   * After a freeze ends, the defender has a 0.45 s settle window before the next trick can re-freeze them.

The following are unchanged: question packs and answer keys, controls, the countdown, Fire, timing, privacy, solo-only play, and badge-clearance CSS.

## Commands and results (final build of this branch)

```sh
npm test                 # 29 files / 231 tests passed (baseline 28 / 219; +1 file, +12 tests)
npm run build            # tsc --noEmit && vite build: PASS (only the existing >500 kB chunk-size advisory)
npx vite preview --port 4185 --strictPort --host 127.0.0.1
U=http://127.0.0.1:4185
COURTIQ_URL=$U REVIEW_OUT=output/opus55-verify/final/possession-ready BADGE_FIXTURE=1 CHECK_HOST_BADGE=1 node docs/verification/2026-11-13-possession-ready/playtest.mjs   # PASS: 6 handovers / 3 viewports, 64px FIXTURE clearance, 0 errors / 0 room requests
COURTIQ_URL=$U REVIEW_OUT=output/opus55-verify/final/adaptive-timing node docs/verification/2026-11-12-adaptive-timing/playtest.mjs        # PASS: 16-possession match + phone/landscape/fixed/practice, JSON+CSV timing
COURTIQ_URL=$U REVIEW_OUT=output/opus55-verify/final/immediate-feedback node docs/verification/2026-11-12-immediate-feedback/playtest.mjs  # PASS: 19 flows, 16 rounds, retry 3 missed
COURTIQ_URL=$U REVIEW_OUT=output/opus55-verify/final/motion-sequence node output/opus55-baseline-tools/motion-sequence.mjs                # PASS: River crossover / Sky spin, trick→drive→dunk, CourtBot drive/dunk
COURTIQ_URL=$U REVIEW_OUT=output/opus55-verify/final/lobby-review node output/opus55-baseline-tools/lobby-review.mjs                      # PASS: 4 sizes, privacy, import, multiplayer inert, 0 identity/room traffic
REVIEW_OUT=output/opus55-verify/final/framing node docs/verification/2026-11-17-opus55/probes/framing.mjs                                 # athlete px per viewport
REVIEW_OUT=output/opus55-verify/final/explore node docs/verification/2026-11-17-opus55/probes/explore-after.mjs                           # 4 possessions × 3 viewports, cue/badge capture
npx tsx docs/verification/2026-11-17-opus55/probes/sim-idle.ts      # idle-steal table
```

Outputs from these commands are copied into `data/`: `probe-*.txt`, `tests.txt`, `build.txt`, `framing-*.json`, `explore-*.json` and `sim-*.txt`. `data/dist-sha256.txt` fingerprints the final `dist/`.

`output/opus55-baseline-tools/*.mjs` were supplied by the parent agent. They are not tracked, so check they are present before you reproduce from a fresh clone.

The sim scripts in `probes/` have import paths adjusted to run in place from the repo root (for example `npx tsx docs/verification/2026-11-17-opus55/probes/sim.ts`).

## Before and after measurements

### Engine simulations

Seeded `AuthoritativeMatchEngine` runs with simple human-like input policies (simulated, not human play).

| Measure | Before | After |
|---|---|---|
| Idle ball-handler stolen within 3 s (B / I / A, of 100) | 100 / 100 / 100 | 39 / 66 / 84 |
| Pause 300 ms, then straight drive: stolen, Intermediate (of 80) | 66 | 31 |
| Pause 600 ms, then straight drive: stolen (B / I / A, of 80) | 18 / 80 / 80 | 7 / 41 / 66 |
| Angled drive, or a trick tap from the start: stolen (of 80) | 0 | 0 |
| Advanced vs ~2 m cushion: releases while the defender is wrong-footed (of 60) | 56 | 19 |
| Human trick→drive: dunk reached (every difficulty, of 80) | 80 | 80 |

`sim-novice-*.txt` lines run in this order:
1. Tap at 0 / 333 / 700 ms (no idle).
2. Idle 300 ms with no tap.
3. Idle 600 ms with no tap.
4. In the "after" file only: angled drive after a 300 ms idle.

The "before" file additionally has angle and idle-tap variants, which were recorded during exploration.

### Rendered athlete height

Measured from the projected 2.12 m subject column at possession start.

| Viewport | Before | After |
|---|---|---|
| 1440×900 | 170 px | 169 px |
| 390×844 | 131 px | 123–131 px |
| 844×390 | 48 px | 78 px |
| 667×375 | 39 px | 80 px |

| Landscape HUD | Before | After |
|---|---|---|
| Height | 67–107 px (two rows) | 52 px (one row) |

### Rendered play

* **Before:** the opening possession was stolen at 2 of 3 viewport sizes.
* **After the steal change:** in the final explore run (pause, then straight drive), 2 of 9 human possessions were stolen. The cue was shown for 21–49 frames (0.35–0.8 s) before each steal.

These are small illustrative samples, not statistics.

## Screenshots (opened and inspected)

`screenshots/before/`:
* `desktop-opening-steal.png`
* `landscape-defence-tiny-athletes.png`
* `landscape-667x375-start.png`
* `landscape-generic-block-badge.png`
* `landscape-live-keyboard-hint.png`
* `portrait-keyboard-hint-attacker-block-pill.png`

`screenshots/after/`:
* `landscape-844x390-start.png`
* `landscape-667x375-compact-hud.png`
* `landscape-defence.png`
* `landscape-defender-set-cue.png`
* `portrait-defender-set-cue.png`
* `desktop-defender-set-cue.png`
* `landscape-reason-block-badge.png`
* `portrait-swat-reason-badge.png`
* `landscape-countdown-badge-fixture.png` (labelled 64 px FIXTURE, not the real badge)
* `portrait-live-block.png`
* `desktop-start.png`

The desktop camera and HUD look the same as before.

Headless Chromium used `--use-angle=metal`. All captures rendered WebGL correctly; none were blank.

## Limitations and outstanding items

* **Not tested:**
  * Physical devices and notch safe areas.
  * Real-device performance.
  * Audio quality (human listening).
  * Classroom learning effects.
  * How fair the new steal rates and settle window feel to human players.
* **Real Netlify badge iframe:** only the 64 px fixture was used. The parent's production gate must rerun `CHECK_HOST_BADGE=1` against the real iframe.
* **Deferred, needs a design decision (see appraisal D1–D7):**
  * Steals still flip possession on a live ball with no question.
  * Offence against CourtBot is still binary.
  * The dribble shield is cosmetic.
* **Failures:** none outstanding. No test was weakened. Baseline probes ran unmodified.
* **No:** deploys, pushes, new services or assets, paid APIs, billing changes, databases or networking.
