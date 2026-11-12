# Adaptive question timing verification

Baseline: `93c0780a78448ce9b124d6e287c6ad586d4d4192`.

- 207 tests across 27 files pass, including 18 new policy/integration regressions. The strict production build passes TypeScript and Vite; the existing vendor chunk-size advisory remains.
- New checks cover wrong/slow-correct/unanswered support, three-quick-correct hysteresis, bounds and a six-second answer floor, unchanged reading, immutable current deadlines/AI commitments, exactly-once resolution, actual-window speed scoring, export metadata, fresh-match reset, turnover exclusion, proportional precommitted bot timing and disabled fixed/practice/online/two-human modes.
- Actual browser matches use normal keyboard/tap inputs and the existing deterministic clock hook. The harness reads known course answers from the repository for reproducibility; it does not mutate the simulation, inspect unsubmitted private runtime keys or answer for CourtBot.
- A full adaptive match exercises wrong, unanswered, slow-correct, quick-correct, quicker-next-question and neutral-correct paths. Portrait/landscape, fixed and practice paths also run. Actual JSON/CSV downloads are checked for effective timing. A fresh match must reset the pace.
- Existing immediate-feedback/Fire/results/retry regression and both-character trick→paint drive→random dunk→landing→CourtBot attack sequences pass. The original approved packs remain byte-identical.
- Screenshots are opened and inspected. A short landscape question initially exceeded the viewport; the final style bounds the panel, compacts layout and allows scrolling while preserving 44px answer targets. Both current reading and answer controls remain reachable. The installed develop-web-game client was rerun on the final build and its capture opened.

From `/Users/ross_mac/Documents/Codex/2026-10-31/courtiq`:

```sh
npm test
npm run build
npm run preview -- --host 127.0.0.1
COURTIQ_URL=http://127.0.0.1:4173 REVIEW_OUT=output/adaptive-timing/recheck node docs/verification/2026-11-12-adaptive-timing/playtest.mjs
```

The harness uses the existing Playwright installed with Ross's web-game skill. For production, `CHECK_HOST_BADGE=1` requires the actual ready badge and checks all answer controls and Continue against it. Draft deploys may omit the badge. Match seeds vary, so question IDs, reading lengths and basketball results differ; assertions use each actual question's protected reading and effective budget.

Adaptive thresholds are design defaults, not a validated learner model. Classroom retention/transfer, physical devices and screen-reader usability still need human evaluation. Prior draft distractor rationales still require instructor review. The feature stores no cross-session student profile and needs no new service, paid API, credits or database. Current public play stays solo-only.

Build/source fingerprints, hosted reports and final release IDs are saved alongside this file. Design details and exact thresholds are in `docs/PEDAGOGY.md`.
