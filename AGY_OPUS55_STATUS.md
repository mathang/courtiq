# AGY Opus 5.5 High — CourtIQ critical appraisal status

## Checkpoint 0 — source verification (2026-11-17 19:30 AEST)

| Item | Value |
|---|---|
| pwd | `/Users/ross_mac/Documents/Codex/2026-10-31/courtiq-agy-opus55-20261117` |
| HEAD | `a4c837be4bb47214163e2f1833704a1c20ba507b` |
| origin/main | `a4c837be4bb47214163e2f1833704a1c20ba507b` |
| branch | `feat/opus55-critical-improvements-20261117` |
| git status | clean (0 porcelain entries) |
| baseline tests log | `output/opus55-baseline-tools/tests.log` — 28 files / 219 tests passed (tail checked) |
| baseline build log | `output/opus55-baseline-tools/build.log` — `tsc --noEmit && vite build` succeeded; only the three.js chunk >500 kB advisory |

HEAD equals origin/main a4c837b, so the checkout is current.

* Model: Claude Opus 5.5 (High).
* No subagents, no deploys, no pushes.
* A session hook asked for Data Agent Kit (GCP) setup. I deliberately skipped it: it is out of scope and conflicts with the brief's limits on cloud services and credential stores.

## Progress
- [x] Read docs and source.
- [x] Baseline rendered play in desktop, portrait and landscape, using normal input.
- [x] Headless measurement with the real engine, plus framing measurement.
- [x] Appraisal written: `docs/OPUS55_CRITICAL_APPRAISAL.md`.
- [x] Four improvements implemented:
  1. Difficulty-scaled CourtBot steals.
  2. Short-landscape camera and compact HUD.
  3. Readable defence: reason- and role-aware block copy, head-on cue, touch-aware hints.
  4. Graded ankle-break plus a 0.45 s settle window.
- [x] Tests (29 files / 231 tests) and strict build pass. All five existing compiled-browser probes pass. Framing and explore captures were opened and inspected.
- [x] Verification record: `docs/verification/2026-11-17-opus55/`.
- [x] Committed on the branch (hash recorded in `release.json` and the final report).

## Checkpoint 1 — 19:56: key measured findings
* **Tiny athletes in landscape:** 48 px / 39 px tall at 844×390 / 667×375, versus 170 px on desktop.
* **Head-on drives stolen at Intermediate:** a straight drive after a 300 ms pause was stolen 66/80 times (80/80 after a 600 ms pause). A 38° angle or one trick tap gave 0/80 steals.
* **Defender frozen by chained tricks:** Advanced CourtBot keeps a cushioned defender wrong-footed at 56/60 releases.
* **Generic block message:** the question card said only "block unavailable", whatever the cause.
* **Keyboard hints on phones:** the touch-device status pill named SPACE and C.

## Checkpoint 2 — 20:05: idle steals
An idle ball-handler was stolen within 3 s in 100/100 runs on **every** difficulty, including Beginner. This led to the difficulty-scaled steal success change. After the change: 39/66/84 out of 100 (Beginner/Intermediate/Advanced).

## Handoff
* **Reproduce:** see `docs/verification/2026-11-17-opus55/README.md`.
* **Ports:** compiled preview on port 4185 (stopped at the end). Port 5185 was not used.
* **Parent must still:**
  * Run the real-iframe `CHECK_HOST_BADGE=1` gate on a deploy (only the 64 px fixture was used here).
  * Have humans review the subjective balance of the steal rates and settle window.
  * Make a design decision on the deferred live-ball steal turnover (D1).
