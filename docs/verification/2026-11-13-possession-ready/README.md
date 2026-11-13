# Two-second possession preparation

Baseline: `dc61c55c136e0f1f8235e349a7951454046ebbfc`.

Normal solo matches now give two seconds after Continue closes the review, before the next possession can move. The role prompt shows 2 then 1. Positions, ball, AI decision time and the movement clock stay still; input keeps held joystick/keyboard movement ready but discards early actions. A fresh block, steal, trick or shot is required once the countdown ends. Settings pauses preparation. Opening play is immediate; final feedback goes straight to results. Demo and future online defaults retain their prior flow.

- 219 tests / 28 files and strict TypeScript/Vite production build pass. Twelve new regressions cover full duration at several frame rates, direct-shot rejection, frozen positions/ball/clock, stale Continue, zero-step pause, both roles, completed matches, disabled modes and keyboard/touch input semantics.
- The normal-input browser test covers two handovers in each of 390x844, 844x390 and 1440x900: answer panel hidden before countdown, numbers 2/1, no movement through 1999ms, no consumed gameplay on the final countdown frame, pause preservation, held joystick movement after zero, fresh native touch block/swipe and a fresh attacking shot. It never mutates match state or answers for CourtBot.
- Existing adaptive/feedback browser probes wait for the public preparation timer before the next live possession. The compiled adaptive match, exports, mobile/fixed/practice flows and both-character trick/dunk/landing/CourtBot sequences pass. Question content is unchanged.
- Screenshots from the new handovers, live defence and installed develop-web-game client were opened. Phone controls remain visible; hosting-badge clearance is additionally required for production.

Reproduce from `/Users/ross_mac/Documents/Codex/2026-10-31/courtiq`:

```sh
npm test
npm run build
npm run preview -- --host 127.0.0.1
COURTIQ_URL=http://127.0.0.1:4173 REVIEW_OUT=output/possession-ready/recheck node docs/verification/2026-11-13-possession-ready/playtest.mjs
```

The test uses the existing Playwright installation from Ross's web-game skill and the game's deterministic clock hook with ordinary pointer/keyboard inputs. `CHECK_HOST_BADGE=1` requires the real ready Netlify badge and verifies joystick/action target size and clearance. Draft deploys may omit the badge.

The first production gate found a pre-existing 6px overlap: the real iframe is 64px high (including transparent hit area), while touch controls reserved 58px. The corrected CSS reserves at least 72px when that iframe is present. `BADGE_FIXTURE=1 CHECK_HOST_BADGE=1` uses a clearly labelled 64px iframe fixture for a draft without a badge; the final production check always uses the actual hosting iframe. The hit-area check runs while live controls are visible, before the new shot hides them.

Viewport emulation is not a physical-device ergonomics study; subjective defensive difficulty remains for Ross to assess. There are no new assets, services, paid API calls, databases or billing/plan changes. Public play remains solo-only. Final build fingerprints, hosted reports and release identifiers are stored alongside this file.
