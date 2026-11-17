# Independent review and published release — 17 November 2026

**Ready to test:** [CourtIQ live game](https://courtiq-spx101.netlify.app/).

Opus 5.5 High completed its critical appraisal and implementation through Antigravity. The parent independently reviewed the source, reproduced the strict build and tests, played the compiled and hosted builds through normal browser inputs, and opened representative rendered screenshots before publishing. No further model session was started for this verification.

## Source and build identity

* Baseline GitHub main: `a4c837be4bb47214163e2f1833704a1c20ba507b`.
* Implementation: `21ae81808d56567d00bf5f50dfeeb3f338c0e847`.
* Independently built source and initially published GitHub main: `c3d7329a3e026894ec908ea2c70e6ffcc479d383` (implementation plus agent evidence metadata).
* This parent evidence commit changes documentation and verification scripts only. Runtime source is unchanged. [Runtime input tree](parent-data/runtime-source-tree.txt) and [all 29 dist fingerprints](parent-data/dist-manifest.json) identify the tested source and build.
* Preview: `6afc2cfda4b52a4404b4a5fc`.
* Production: `6afc2e02bb38597d0424fa37`, published 17 November at 10:35:47 UTC.
* [Machine-readable parent release record](parent-release.json). The agent's original `release.json` is its earlier local-only handoff, not the final publication record.

All 29 delivered preview and production files were checked against the parent-built dist. JavaScript, CSS, both athlete models, audio, credits and licences match exactly. HTML comparison accounts only for the observed Netlify hosting comment, public HUD script and Player Lab Pretty URL serialisation. The production functions have the same digests as the tested preview. The site's current published deploy was independently checked through the Netlify connector.

## Improvements reviewed

1. **Fairer CourtBot steals:** reachable swipes connect with difficulty-dependent chances of 30% / 55% / 80%. A failed swipe pays the existing one-second recovery; human steals retain their geometry. A separate seeded steal stream protects question/shot randomness. Exposed trick spam remains punishable.
2. **Clearer landscape play:** athletes measured 78 px tall at 844×390 and 80 px at 667×375 on production, versus 48 / 39 px in the baseline measurements. The landscape HUD is one 52 px row. The rendered phone controls remain clear of the actual hosting iframe.
3. **Readable defensive outcomes:** role-specific block reasons, a short head-on defender cue, and touch hints naming the on-screen actions. The frozen release snapshot explains the outcome without changing learning credit or block eligibility.
4. **A chance to recover between ankle-breakers:** wrong-foot effects scale with spacing, and a 0.45-second settle window prevents immediate repeat effects. This adds no full movement lock. Human play-balance assessment is still needed.

The parent found no material code defect requiring a further runtime change in this pass. The [appraisal](../../OPUS55_CRITICAL_APPRAISAL.md) remains candid about later work: steals still flip possession immediately, angled or trick drives can dominate CourtBot, and ball-hand shielding does not yet change steal eligibility. These are future design work, not fixes claimed by this release.

## Independently reproduced checks

| Check | Result |
|---|---|
| `npm test` | **231 tests / 29 files PASS**, including 12 new regressions and retained future-multiplayer contracts |
| `npm run build` | **PASS**, strict TypeScript check and production build; existing vendor chunk advisory only |
| Approved question packs vs baseline | Byte-identical |
| Compiled adaptive timing | Full 16-possession match, phone and landscape, fixed and practice preferences, downloaded JSON/CSV actual budgets: **PASS** |
| Compiled possession preparation | Six handovers in three viewports, settings pause, held movement, discarded early actions and fresh native actions, labelled 64 px fixture: **PASS** |
| Compiled motion and lobby | Both athletes' trick→drive→dunk and landing; four-size nickname/privacy/import/keyboard/no-room checks: **PASS** |
| Installed develop-web-game client | **PASS**; screenshot and public text state opened and inspected |
| Hosted preview | All assets; six handovers; four exploratory possessions at each of desktop/portrait/landscape; new cue and block-reason captures: **PASS** |
| Production native gameplay | Six handovers at 390×844, 844×390 and 1440×900; native touch block/swipe/shoot, pause and countdown: **PASS**, no page errors or room requests |
| Production both-athlete possession | River crossover→360 and Sky spin→reverse, question hold, answer, landing, next CourtBot drive/dunk: **PASS**, no page errors |
| Production framing | Desktop, portrait, 844×390 and 667×375: **PASS**, screenshots opened |
| Production real hosting hit areas | Actual iframe **202×64 px** at all three phone viewports; action/joystick targets ≥44 px and **≥8 px clear** of its full rectangle: **PASS** |
| Public room service | Supported `POST /api/room`: **503 `MULTIPLAYER_DISABLED`** |

Raw parent logs, reports and hash checks are in [parent-data](parent-data/). Both compiled and hosted checks used the browser's normal controls, `advanceTime` and public text state. Browser state was not patched to create the outcomes. Browser verification used headless Chromium with `--use-angle=metal`, not a physical handset.

The agent had also run the unchanged immediate-feedback probe's 19 flows. The parent independently covered immediate answer feedback and Continue in the countdown/motion checks and the complete adaptive match; it did not independently repeat every one of those 19 dedicated feedback flows.

### Reproduction

```sh
npm ci
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

Then, from another terminal at the repo root:

```sh
U=http://127.0.0.1:4173
COURTIQ_URL=$U REVIEW_OUT=output/recheck-ready BADGE_FIXTURE=1 CHECK_HOST_BADGE=1 node docs/verification/2026-11-13-possession-ready/playtest.mjs
COURTIQ_URL=$U REVIEW_OUT=output/recheck-adaptive node docs/verification/2026-11-12-adaptive-timing/playtest.mjs
COURTIQ_URL=$U REVIEW_OUT=output/recheck-motion node docs/verification/2026-11-17-opus55/probes/motion-sequence.mjs
COURTIQ_URL=$U REVIEW_OUT=output/recheck-lobby node docs/verification/2026-11-17-opus55/probes/lobby-review.mjs
```

For the published build, omit `BADGE_FIXTURE` and use `COURTIQ_URL=https://courtiq-spx101.netlify.app CHECK_HOST_BADGE=1` with the ready and motion probes. The additional [hosted hit-area probe](probes/hosted-hit-areas.mjs) records all three phone rectangles and the disabled room response. Browser scripts import Ross's installed Playwright path; change that import for another machine.

### Probe notes

The strict real-iframe gate initially timed out on the deploy preview because that preview did not include the production hosting iframe. Preview gameplay passed without that requirement, and the strict unchanged gate then passed against the real iframe on production. The extra endpoint smoke first used GET, which correctly returned 405; using the supported POST method returned the required 503. Neither issue required a game change or weakened release assertion. No material failed release check remains.

## Representative production captures

* [Landscape handover and real badge](screenshots/parent-production/landscape-ready-real-badge.png).
* [Portrait block attempt](screenshots/parent-production/portrait-block-real-badge.png).
* [Sky dunk, question and four clear answers](screenshots/parent-production/sky-dunk-question-real-badge.png).
* [667×375 landscape drive](screenshots/parent-production/landscape-667-drive-real-badge.png).

These were opened and visually inspected. The approved concise feedback, adaptive timing, two-second handover, simple controls, learning Fire, equal River/Sky choices, nickname warning and public solo-only mode remain in place.

## Cost controls and limits

The completed Antigravity launch and completion record retain the explicit session setting **`useG1Credits:false`**, the requested **`claude-opus-5-5-high`** model and high effort; the job exited successfully. No model/provider switch, paid API or asset, new service/database, billing change or hosting overage was enabled. Existing included allowances were used.

Physical phones/notches, real-device frame rate, human audio listening, student learning outcomes and subjective balance have **not** been validated. No AAA or NBA Street parity is claimed. The next useful evaluation is a human playtest, particularly whether CourtBot's difficulty and the settle window feel fair.
