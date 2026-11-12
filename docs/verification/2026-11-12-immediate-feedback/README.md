# Immediate, concise answer feedback: release verification

Baseline: `58a207834ae69a86bc19d3d7c41f31c4f2b71e5c`. Implementation is on `feat/immediate-learning-feedback`.

## Gates

- 189 tests across 26 files pass, including nine new authoritative immediate-feedback regressions.
- Strict `npm run build` passes TypeScript and Vite. The existing vendor chunk-size advisory remains; no failed build gate is being waived.
- Both original approved question packs are byte-identical to the baseline.
- `build.json` fingerprints the changed runtime files and all 29 production files.
- Actual keyboard/tap matches exercise right/wrong answers while CourtBot is pending, answers after CourtBot, protected reading, timeouts, a three-correct Fire cycle and a wrong-answer reset, persistent optional details, learner-paced Continue, completed match results and missed-question retry.
- Portrait 390x844, landscape 844x390 and desktop 1440x900 are inspected as rendered browser captures. The separate existing lobby review also covers 768x1024, custom import, nickname privacy, native keyboard Start, character retention and disabled multiplayer, with no room/identity requests.
- Both River and Sky complete ordinary-input trick, paint drive, random dunk, question, landing and CourtBot next possession in the compiled game; 21 captures per sequence, no page errors.
- The installed develop-web-game client was run on the final build and its screenshot opened. Representative new feedback/default/detail/results and actual dunk screenshots were also opened.

## Reproduction

From `/Users/ross_mac/Documents/Codex/2026-10-31/courtiq`:

```sh
npm test
npm run build
npm run preview -- --host 127.0.0.1
COURTIQ_URL=http://127.0.0.1:4173 REVIEW_OUT=output/pedagogy/recheck node docs/verification/2026-11-12-immediate-feedback/playtest.mjs
```

The browser harness uses the existing Playwright installation in Ross's develop-web-game skill. It uses normal inputs and the game's deterministic time hook, without modifying match state or submitting answers for CourtBot. Known course answers are read from the local content solely to make the automated checks reproducible. Match draws remain random, so exact questions, scores and match length vary.

Hosted tests use `COURTIQ_URL` and `REVIEW_OUT` to select the deployed build. `CHECK_HOST_BADGE=1` additionally requires the real ready Netlify badge and checks the Continue button's bounds and 44px minimum height. Use this for production; draft deploys may not inject the badge.

## Corrected QA setup issues

The first strict build rejected a new test call missing two required timing arguments; those were supplied and the strict build passed before hosted verification. The first draft-deploy probe required a production hosting badge that was absent on that preview, so it timed out. The preview was then tested without that inapplicable requirement; production retains the real-badge check. The match harness now uses a practice-length match to guarantee enough possessions to exercise Fire before the results screen. None of these corrections changes or relaxes game authority, answer secrecy or learning rules.

## Limits

Browser viewport emulation is not a physical phone test, and focus/DOM checks do not substitute for a screen-reader user study. Tests do not establish educational efficacy, subjective gameplay balance or human auditory quality. The prior draft distractor rationales still need instructor review. Evidence-informed teaching choices and recommended next work are in `docs/PEDAGOGY.md`. No paid service, API, asset, credit purchase, database or billing/overage change was introduced.

Final deploy identifiers, exact live asset verification and the production match report are recorded alongside this file when release checks complete.
