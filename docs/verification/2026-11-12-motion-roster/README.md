# Movement and selectable-athlete release — 12 November 2026

This phase integrates Carbon High's focused basketball motor/footwork/contact implementation with the River/Sky roster. It improves the existing browser game; it does not establish NBA 2K or NBA Street production parity.

## Source and cost provenance

- Freshly fetched GitHub main: `22a46b0f3ab6cae809ce307f1d61e84d9498f440`. Antigravity started a new conversation in a clean isolated worktree, verified both HEAD and origin/main, then ran the 141-test baseline and strict build.
- Requested route: installed `agy`, `gemini-4-carbon-high`, effort `high`. Launch and completion retained explicit session `useG1Credits:false`. Implementation `f4599d3`, status `3cbb5be`, exit 0. See `agy-provenance.json`.
- During implementation, two task-owned foreground server waits were stopped to unblock CLI tools. The same Carbon task resumed and completed; no weaker cost control, duplicate agent or paid provider was used.
- Final included Gemini quota: 97% weekly, 95% five-hour remaining. Quota is a time-specific CLI observation, not a promise about other account activity. Existing Netlify team verified Free; no billing/account settings, overage fallback, paid assets or external generation/LLM APIs were enabled.

## What changed

- Defenders face the ball-handler while shuffling and retreating. Cuts/stops compress and push off, without reintroducing movement roots. Only the deliberate missed-swipe recovery remains a full 1 s root.
- World-space support-foot holds, deliberate swing release, geometric toe/heel clearance, coherent clip blend-outs and smoother spin-to-finish and overhead elbow transitions.
- Carrying-hand changes persist after crossovers; close defenders influence protected dribble side. Hands use a hip/waist reception pocket rather than following the ball to the floor. Jump shots gather continuously for 180 ms before flight advances.
- River/Sky are neutral catalogue names; Sky has a distinct CC0-derived adult body/hair with fitted kit. Both share the same 65-bone rest joints, 17 clips, height/reach and gameplay rules. Four palettes each, local portrait buttons, jersey names, online choice/reconnect and Player Lab controls. Original appearance IDs 0–3 preserve River; IDs 4–7 select Sky.

## Verified evidence

| Gate | Evidence | Result |
| --- | --- | --- |
| Unit/rules/multiplayer/asset/render | `tests.txt`; original 14 asset and 4 new motion checks run on each GLB |178/178 tests, 24 suites PASS |
| Strict TypeScript and Vite | `build.txt` |PASS; existing559.8kB Three.js chunk warning retained |
| Same rig/cosmetic balance | `characterRigCompatibility.test.ts`, `characterChoice.test.ts` |Same rest joints/clips and seeded gameplay across appearance choices; room/ready/reconnect normalisation PASS |
| Sky asset validation | `sky-glb-validation.txt` |0 errors / 0 warnings; expected unused UV informational notes |
| Actual gather before/after | `palm-before.json`, `palm-after.json` |Max sampled palm-marker→ball-centre1.796m River/1.836m Sky →0.084m both |
| Sprint, reversal and stop | `cuts-before.json`, `cuts-after.json`, `sky-cuts.jpg`, `river-cuts.jpg` |Actual normal-key60Hz browser matches; opened and inspected both athletes |
| Full compiled possessions | `sequence-compiled.json`, `sky-sequence.jpg`, `river-sequence.jpg` |Real C-tap crossover/spin→steered paint drive→Space random dunk→question hold→resolution/landing→CourtBot next attack;0 page errors |
| Local online teaching/defence | `teaching-local.json` |Both appearance choices,current backend fields,174 pre-resolution secrecy checks,personal verdict/reasons,both-party Continue,missed swipe,dunk/manual swat PASS |
| Lobby/portraits/fallback | `lobby-compiled.json`, `portrait-ui.json`, `fallback.json` |1440×900,768×1024,390×844,844×390;keyboard Start,import safety,palette portraits,playable asset failure and successful retry PASS |
| Installed game-skill loop | `skill-integrated.png` |Installed finite input client run after integration; actual screenshot opened |
| Controls and learning Fire | `controls-fire-preview.json` | All four tap counts, three correct → Fire, next wrong → reset, personal rationale, portrait/landscape touch actions PASS |
| Hosted two-student game | `teaching-preview.json` | Both character choices,current backend,31 pre-resolution secrecy checks,1 injected missing-room response recovered,same question/choices,personal feedback,both Continue,rooted missed swipe,both dunks and manual swat PASS |
| Hosted preview | `preview-assets.json`, `initial-preview-assets.json`, `sequence-preview.json` |All29 delivered files match built application; full River/Sky sequences and CourtBot next offence pass on accessible hosted build |

Palm measurements are world-space presentation markers to ball centre in a sampled ordinary jumper, not skinned-surface contact validation. Deterministic rig tests bound foot slip, sole clearance and limb transitions in defined scenarios; they do not establish perfect contact at every frame. Screenshot crops in the contact sheets derive from normalised camera subject coordinates; full captures are retained locally in `output/athlete-roster/`.

## Release verification

Corrected preview: https://6af5061d57ae3cbfb80f5dcb--courtiq-spx101.netlify.app (`6af5061d57ae3cbfb80f5dcb`). Initial preview `6af5000ea998a4a133285a6a` is retained separately. Final production verification is recorded below. `build-manifest.json` ties the runtime source hashes and all 29 built files to this release. No application source is changed between the strict build, hosted preview and production promotion.

## Boundaries

Physical phone hardware, campus Wi-Fi/classroom concurrency, subjective competitive balance and human-ear audio listening are NOT_TESTED. These are Metal Chromium browser checks, including touch emulation, not device certification. Motion remains authored clips plus procedural curves/analytical IK rather than a professional motion-capture/motion-matching library or full-body/finger physics. The dribble hand follows its reception pocket, not palm-ball impact simulation.

The 255 new wrong-choice rationales from the prior release still require instructor approval. Online rooms still rely on warm-process serverless memory, with no durable cross-instance store. Bundled static solo questions are formative material, not a secure assessment. Learning credit remains separate from basketball outcomes.

## Reproducing the browser checks on this Mac

The finite `.mjs` harnesses in this folder are copies of the actual verification scripts, run from the repository root. They use the installed `develop-web-game` Playwright module under `/Users/ross_mac/.codex/skills/` and the Apple Metal renderer. Set `COURTIQ_URL` and `REVIEW_OUT` to choose a build/output folder, e.g. `COURTIQ_URL=http://127.0.0.1:4173 REVIEW_OUT=output/recheck node docs/verification/2026-11-12-motion-roster/motion-sequence.mjs`. Local online checks target8788 explicitly; run `PORT=8788 npm run server` separately. Other machines need an equivalent installed Playwright path.

## Hosted instrumentation and limits

Preliminary hosted runs exposed HTTP polling delay: continuous held input continued after a stale position snapshot, and synchronous screenshot capture carried the actor outside the paint or beyond the hoop before the shot. Those attempts correctly became jumpers. A single readiness wait also timed out without enough evidence to assign a cause. These runs are recorded as failures in `preliminary-hosted-runs.json`, not counted as passes.

The final online scenario uses ordinary keys to approach and stop in the paint, then a deliberate forward power step plus primary input, holding direction through the acknowledgement. It tests the authoritative dunk/block and teaching contracts without pausing/repositioning the server or relying on a screenshot during a live timed approach. Continuous running/trick-to-dunk transitions are independently verified in the compiled and hosted solo matches and the local WebSocket match. No product rule or test tolerance was weakened. HTTP latency and warm-instance room persistence remain material limits; classroom performance is not validated.

Initial preview `6af5000ea998a4a133285a6a` passed its checks. Both serverless functions were available; `initial-preview-deploy.json` records their exact digests and the verified existing Free team. All29 delivered files match the tested dist after only the observed hosting HTML transforms. Actual hosted frames were opened and reviewed. The completed two-student run passes28 secrecy checks and both character/dunk/swat/feedback flows with0 page errors. This is a functional warm-room check, not a latency or classroom-concurrency pass.

## Live acknowledgement failure and correction

The initial production `6af503ee33b2d51b11d81783` served all29 correct assets and passed full solo/badge checks, but its two-student match received `Not currently in a room.` during Continue and remained in Feedback (`initial-production-room-failure.json`). This is an observed failure, not a pass. The server stores rooms only in process memory; a request handled by a worker without that room is a plausible explanation, but worker routing was not directly observed.

The client previously removed a confirmation from its queue before the request and lost it on that response. The correction retains only idempotent Ready/Continue confirmations, retries at most3 times, preserves a newer queued ready choice, scopes recovery to the original room/reconnect context, and resets retries on leaving. It never retries movement, shots, trick/steal/jump actions, answers, create/join or learning outcomes. This fixes lost confirmations on recoverable requests; it does not create durable rooms or eliminate polling latency.

The actual compiled two-browser HTTP test injects one missing-room response on Student B's Continue, then confirms the match resumes without another click and completes the next dunk/manual swat (`http-ack-recovery-local.json`:47secrecy checks,1 injected/recovered fault,0 page errors). Four new regressions cover exact-duel retention, non-replayed actions/answers, retry limits and newer ready choices. **178 tests/24 suites and strict build PASS.** A corrected hosted preview and production are verified separately below.

Corrected preview `6af5061d57ae3cbfb80f5dcb` is ready, with29/29 built files matched. The hosted two-student test injects the exact lost-Continue response and recovers automatically, then completes the next dunk and manual swat:31 pre-resolution secrecy observations,1 injected/recovered transient error,0 page errors (`teaching-preview.json`). Both function digests remain identical because the correction is client-side. The installed game-skill loop was rerun on the corrected compiled game and its screenshot opened (`skill-final.png`). Final production promotion follows.

## Final verified release

The corrected source `8375df4d84750a46904b27382f167e666e34f221` is on GitHub main. Production **`6af506c76ad792d17813d3b5`** is current/ready at **https://courtiq-spx101.netlify.app/**, promoted from corrected preview `6af5061d57ae3cbfb80f5dcb`. All29 delivered files match the178-test strict build, and both function digests match preview. See `release.json`, `production-deploy.json`, `production-assets.json` and `build-manifest.json`.

Actual final-production two-browser play passes both character selections, both paint-step dunks, manual swat, missed-swipe rooting, identical question/choices, hidden pre-resolution keys/reasons, personal verdicts/rationales and both-student Continue. The same missing-room response is deliberately injected once on Student B's Continue; the app recovers automatically and completes the next possession, with30 secrecy checks and0 page errors (`teaching-production.json`). Current live question/swat and personal-feedback screenshots were opened and inspected. The final check allows a recorded transient transport response only if the full match flow subsequently recovers; it does not count an unrecovered stall as a pass.

The initial failed production run and all known preliminary harness failures remain identified above. The new bounded retry correction is verified; polling latency, permanent instance loss, human balance and real classroom/device performance remain separate work.

The final corrected production also passes complete ordinary solo trick→paint drive→random dunk→question→resolution/landing→CourtBot attack sequences for both characters,22 captures each with0 page errors (`sequence-production.json`). Every answer clears the genuine hosting badge. The final portrait question and landing screenshots are from this corrected build, not the earlier deployment.
