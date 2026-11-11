# Fluid defence, simpler lobby and Blacktop benchmark

12 November 2026. Baseline: `dffb1ded34442a4803c072da019b51fdbf5d2ee7`. Implementation branch: `feat/fluid-defense-simple-lobby`.

## Behaviour

- Off-balance defenders retain directional movement. Block jumps retain 72% steering.
- Both bodies share yielding pressure and sliding contact, with a 0.70 m torso minimum and motion/contact substeps of at most 1/120 s. These substeps do not change the networking tick rate.
- A missed steal still roots the defender for one second. Shared-question positions and clocks remain frozen as before.
- The lobby starts with two modes, name, topic and Start. Options contains configuration, preview and teacher tools. Leaving a pre-match room releases the slot and resets readiness; mode switching is hidden until departure. Imported custom topics remain solo-only.

## Evidence

`npm test`: **141 tests across 19 files PASS**. `npm run build`: strict TypeScript and production bundle **PASS**, with the existing Three.js chunk-size advisory. See `tests.txt`, `build.txt` and `build-manifest.json`.

The before/after deterministic probes measure about **0 → 1.45 m** off-balance travel and **0 → 1.05 m** jumping travel in 300 ms. New rules tests cover 60/30/10 Hz steering, opposing contact down to 4 Hz, court corners, bump/slide, missed-swipe recovery and frozen teaching positions. Three authenticated room tests cover departure/replacement, stranger rejection and active-match protection.

Compiled browser matches verify jumping steering, bumping a stationary handler, sliding and movement during an active off-balance reaction. The latter records authoritative snapshots rather than equating a fixed wall-clock wait with a network update. One earlier wall-time assertion failed; the revised observation and deterministic regressions pass. A parallel headless teaching run missed a short swipe state; the subsequent isolated compiled run passed. An initial hosted movement script also overshot its alignment during network round trips; independent fresh possessions now test each scenario against authoritative snapshots, avoiding an expired movement clock. These are retained as harness limitations, not silently counted as successes.

Lobby checks cover 1440×900, 768×1024, 390×844 and 844×390, native keyboard activation, imported topics, return-to-lobby state and reduced motion. The browser check also verifies custom packs are disabled online and restored on returning to computer mode.

Two-client teaching checks cover identical questions/choice sets, protected online keys/explanations, individual feedback, both-party Continue, the deliberate missed-swipe freeze and a same-key paint dunk/manual swat. Current browser reports and inspected own-game screenshots accompany this file. Physical devices, campus concurrency, human play balance and audio listening are not established by resized Chromium checks.

## Research

The [NBA 2K Blacktop benchmark](../../research/NBA_2K_BLACKTOP_BENCHMARK_2026-11-12.md) distinguishes official feature announcements, sampled rendered footage, CourtIQ source findings and proposed targets. `footage-sampling-metadata.json` records the observed public-player timestamps. Proprietary screenshots remain local research material; this repository links to original sources. The standalone report uses only CourtIQ screenshots.

The HTML report was inspected at 1440 px and 390 px; its images load and tables scroll within the report. Hands-on retail-controller testing, exact latest-patch certification and NBA 2K performance measurements were not performed.

## Hosted release

Final preview `6af4e6e6f82f7e6222bbdd88` is ready. The earlier preview preceded a waiting-room mode-switch guard and is not the release candidate. All 20 deployed files match the tested build; HTML comparison normalises only the observed Netlify hosting comment/public HUD and the specific Player Lab Pretty URL serialisation. Other application assets are byte-exact. The final hosted preview passes bump/slide, block steering, active off-balance movement and Leave/rejoin. Its active reaction is verified from authoritative HTTP response snapshots: the polling client can skip a short reaction between rendered frames. Isolated Chromium uses the local Apple M4 Pro Metal renderer; earlier software-rendered runs and wall-time assertions are kept in local logs. The final preview teaching check passes identical question/choices, 33 pre-resolution secrecy checks, personal right/wrong reasoning, both-party Continue, rooted missed swipe and primary-action paint dunk/manual swat; zero page errors. Production results are added after verification.

No assets, paid services, APIs, account upgrades, billing changes or extra-credit fallback were used. Existing question-rationale instructor review and warm-memory serverless room limitations remain documented in the main handoff and research report.
