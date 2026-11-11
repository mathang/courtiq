# CourtIQ: Antigravity AAA gameplay and teaching brief

Date: 11 November 2026. This is an implementation handoff from Ross, not a request for a proposal alone.

## User instruction

“Pass this onto antigravity agy via terminal on this computer and instruct it to examine it and transform it into a AAA quality game. The goal is for it to be comparable to NBA Street game in terms of gameplay and mechanics, but with the learning aspect making it suitable for teaching.”

Prior instructions also authorise updating the GitHub repository and live game. Ross wants professional quality software and expects the actual source, rendered gameplay and published build to be inspected. Work autonomously on the authorised task; use reasonable implementation choices and continue useful work rather than stopping for routine confirmations.

## Correct project, baseline and access

- Authorised working repository: `/Users/ross_mac/Documents/Codex/2026-10-31/courtiq`.
- Git remote: `https://github.com/mathang/courtiq.git`; live game: `https://courtiq-spx101.netlify.app/`.
- Work on the prepared branch `feat/aaa-teaching-basketball`, based on `6495948382145088be1cf69d1348c9e4b4276587`. Do not discard unrelated edits or rewrite published history. Check current status before changes.
- IMPORTANT: `project-profile.md` contains an obsolete greenfield path under `Documents/antigravity/dazzling-goodall`. That is not this task's working checkout. Correct the local profile for the actual repo and expanded goal; preserve valid teaching/rule contracts. Do not edit other projects.
- Last verified production deploy: `6af425c3b8df11e6c2dbcf0a`; Netlify site ID `0163a0e9-643d-4a4e-b835-b789dcee1204`. Recheck live state before assuming it is unchanged. The linked Netlify CLI and GitHub push worked on this Mac; use existing authenticated access without printing credentials. No new services, credentials, charges or asset purchases are authorised.
- Current CLI account exposes `gemini-4-carbon-high`; launch uses that model. Record any actual model/quota/access change instead of silently claiming the requested route ran.
- Read `HANDOFF.md`, `README.md`, `progress.md`, `verification-ledger.json`, package/build configuration and actual source. Do not read private assistant transcripts, browser profiles, credentials or unrelated documents for context.
- Ross Build & Verify is installed and enabled. Explicitly read and apply `/Users/ross_mac/.gemini/config/plugins/ross-build-verify/skills/ross-build-verify/SKILL.md` within the user's authority. Existing authorisation includes code, commits, GitHub and verified game publishing; the skill does not require another routine approval for those actions.

## What already exists

TypeScript, Three.js, Vite, shared authoritative rules, Node WebSocket rooms, Netlify HTTP-room fallback, solo CourtBot, approved SPX101 question packs, remappable keyboard/touch inputs, accessible question overlays, reduced motion, mute, quality fallback, and a Player Lab.

Recent work shipped a 65-bone, 22,174-triangle, 1.29 MB skinned player with integrated singlet/shorts/socks, dynamic jersey names/numbers, 17 retargeted keyframed clips, separate pose-buffer blending, foot planting and hand/ball IK. There are crossovers, spins, eurosteps, stepbacks, four arcade dunks, manual jump blocks, steals with a one-second missed-swipe freeze, an interruptible full-possession preview, a possession camera, floor shadows, and synchronised court audio. Sources/licences and rebuild instructions are in `assets/source/README.md`.

Last verified checks: 82 tests across 14 files, strict TypeScript/Vite build, GLB validation without errors/warnings, local actual solo and two-browser contested matches, live desktop/portrait possession flows, identical multiplayer questions/choices/reveal, hidden online answer keys, and matching deployed assets. Treat this as baseline evidence to recheck, not proof that the game is already AAA quality. Physical-device performance and a human speaker/headphone listening pass remain unverified. The public Netlify badge needs its reserved footer so it cannot cover answers. Player Lab pause now freezes root interpolation and gather-hand settling exactly.

Useful existing local evidence: `output/possession-polish/`, especially `showcase-production-final/report.json`, `contested/browser-report.json`, `production-final-assets.json`, `audio-report.json`, and `court-audio-review.wav`. Earlier visual-defect captures are under `output/match-review/` and `output/player-v2/`. Output artefacts are ignored; do not commit huge traces accidentally.

## Required approach: examine, then materially transform

1. Run the current checks, launch the actual game, and play complete attacking and defending possessions against CourtBot and a second client. Examine screenshots and motion sequences yourself. Audit the feel, input, animation, ball contact, collisions, camera, sound, AI, multiplayer and teaching flow. Identify the largest observed quality gaps with concrete examples and a ranked implementation plan in the repo.
2. Then implement the plan. Do not end after an audit, roadmap, cosmetic reskin or a handful of numeric tweaks. Deliver a substantially better playable game. Use an integrated, repeatable possession as the first quality bar, then extend the improvements across solo and student-versus-student matches and full-match flow.
3. Use NBA Street/NBA Jam as references for responsiveness, expressive trick chains, explosive dunks, defensive counterplay, readability and excitement. Make original CourtIQ art, audio and UI; do not copy proprietary characters, names, music, logos, animations, code or extracted game assets.
4. Keep changes reviewable with coherent commits, working checkpoints, before/after captures and a living implementation/status file. After each significant stage, play the result and fix what is actually visible or audible. A build passing is not visual or gameplay approval.

## Gameplay and presentation target

- Responsive acceleration, braking and turning; good input buffering and predictable move selection. Preserve clear readable commitment/recovery windows. Design coherent transitions and legitimate move chains between dribble, crossover, spin, eurostep, stepback, gather, take-off, dunk, block, landing and recovery.
- Real separation and defender counterplay. Reliable contested/clean finishes, timed block attempts, exposed-ball steals, and the required full one-second vulnerability/root after a missed swipe. Avoid unavoidable steals, automatic scores and animation-driven teleports. Keep simulation outcomes authoritative and consistent across transports.
- A deeper original arcade skill/reward layer where appropriate (for example flow/combo style and momentum), with visible costs, counters and feedback. It must support meaningful decisions and teaching rather than rewarding button spam or bypassing knowledge.
- Spectacular distinct dunk performances and believable body/ball mechanics: anticipation, gather, lift, hand attachment/release, air control, rim contact, follow-through, landing and recovery. Smooth blends, planted feet, correct soles, convincing defensive reaches and no obvious intersections with limbs, clothes, hoop, stanchion or other players. Keep names on the back of each player's jersey.
- Intelligent CourtBot: committed driving lanes, changing pace, attack/retreat decisions, moves to create space, sensible steal/jump selection, recovery from congestion, no prolonged stalls beneath the hoop. Difficulty must change believable basketball behaviour without reading hidden human intent or answer keys.
- Cohesive professional athlete/court presentation, stronger material/lighting/shadow quality where the browser budget supports it, clear ball visibility, original effects and readable team identities. Replace weak placeholder assets when a suitable original/licensed asset or real authoring workflow is available. Retain provenance and editable/rebuildable sources. Report asset/tool limits candidly.
- Camera direction that increases excitement while preserving playable spatial awareness, opponent/ball/rim visibility, controls and questions. Smooth transitions; no stanchion occlusion, motion sickness or HUD obstruction. Reduced Motion must remain useful.
- Sound must follow visible contacts and action with convincing court Foley, impacts, crowd response and mix dynamics. Perform a listening pass if your environment truly supports it; otherwise record technical checks and label listening NOT_TESTED. Mute/pause must silence active tails. Do not describe generated audio as auditioned without hearing it.
- Reliable keyboard and touch play, responsive portrait/landscape layouts, legible questions, usable targets, low/classroom graphics and graceful asset/WebGL failures. Profile real frame time, memory, load size and pacing on a documented environment. Prefer a stable 60 fps target on representative desktop hardware and graceful constrained-device quality; emulated mobile viewport is not physical-phone performance.

## Teaching contracts that must survive

- Teaching remains a central, satisfying part of the gameplay loop, with the shot/question/finish connection understandable to students and teachers.
- In student-versus-student mode BOTH students receive the SAME question ID, stem and answer choices for every duel, with the same protected reading period, reveal time and answer deadline. Choice order may differ by student. One answer per student; held/repeated movement or shoot inputs must not submit accidental answers.
- Do not leak correct option IDs or explanations in online public payloads before resolution. Preserve server authority for movement, score, question selection/keys, RNG and timestamps. Maintain separate real, simulation and presentation clocks.
- Keep established accuracy/timing-based question resolution, correct out-of-range defensive learning credit, independent learning records, alternating/equal possessions and approved question packs. Physical steals/blocks affect basketball outcomes without inventing wrong/unanswered learning records. Preserve explanations, source references and missed-question review.
- Do not silently rewrite teaching content, make learning cosmetic, let arcade bonuses guarantee scoring regardless of knowledge, add student PII, add live LLM questions, public chat or advertising flows. Preserve current course branding and teacher controls. Any necessary balance changes must be explicit, tested and documented.

## Architecture and shipping

Inspect the actual bottlenecks before choosing tools. The goal is the game quality, not an engine name. Stay browser-playable on the existing live URL; retain working classroom access. Refactor animation/state/physics/AI architecture as needed. Do not begin an expensive engine migration merely for perceived prestige; if a migration is necessary, document concrete benefits, costs and a working parity prototype before replacing the stable implementation.

Review the known production room-state limitation: Netlify HTTP rooms currently rely on warm container memory. Do not claim robust classroom concurrency/reconnects merely because local WebSockets pass. Improve what is possible within existing authorised infrastructure, or record the actual persistence/load gap and a concrete solution without creating new paid services or credentials.

Use the prepared feature branch for checkpoints. Push useful reviewed source changes to GitHub, deploy a hosted preview and verify it, then update main/live with complete tested increments. Preserve a recoverable stable baseline and do not replace production with a broken or incomplete rewrite. Updating GitHub and the live game is already authorised. Do not silently switch Netlify projects or publish this repo over another website. Do not delete unrelated work or operate on the unrelated service that was already using port 8787; choose free ports for your test servers.

Browser control in Codex Work settings was disabled; do not change permissions or attempt to attach to the user's browser profile. Use authorised isolated test browsers/available tools instead. Headless Playwright is available at `/Users/ross_mac/.codex/skills/develop-web-game/node_modules/playwright/index.mjs`; the existing browser harnesses are useful starting points, not a reason to skip hands-on or visual inspection. You may consult the local Three.js/game asset workflows if useful. Blender was not installed at the last check; verify tools before claiming to use them.

## Verification and completion

- Keep existing tests and make meaningful regressions for new observed failures. Test both WebSocket and Netlify HTTP adapters, low-frame-rate behaviour, buffered inputs, collision/steal/block rules, AI stalls, question parity/timing, reading locks and answer-key privacy.
- Record real match captures for running/dribbling/trick chains into every dunk, both attacking sides, contested makes, misses, swats, steals, landings and successive possessions. Examine frames for clipping, sliding, snapping, ball detachment, occlusion and UI overlap. Test a complete match and recovery from pauses/reconnects/errors.
- Browser-test keyboard and touch layouts, protected reading, all answer targets, badge clearance, reduced motion, mute and fallback. Keep actual device, browser-emulated, synthetic, listening and human learning-efficacy results separate.
- Before release run typecheck/build/tests, validate shipping assets, review the diff, verify hosted preview, publish correct site/source, compare live delivered assets against the tested build and exercise the live shared-question flow. Never deploy stale dist after a failed build.
- Keep `HANDOFF.md`, `progress.md`, `project-profile.md`, asset credits and the verification ledger current. Use PASS, FAIL or NOT_TESTED accurately. Report source commits, deploy IDs, evidence and unresolved gaps.
- AAA comparability is a quality ambition that demands critical visual/gameplay assessment, not a claim established by green tests. Do not declare the whole goal achieved if major gaps remain. Continue implementation across meaningful stages and be honest about what still needs specialist asset work or human/device validation.

Start now: acknowledge the correct repo/branch/baseline, read the installed verification workflow and project context, create a project-local status file, reproduce the current experience, and then carry out the transformation. Routine planning is the beginning of this task, not its deliverable.
