# CourtIQ — Opus 5.5 High critical appraisal (17 Nov 2026)

Reviewer: Claude Opus 5.5 (High) via Antigravity CLI, solo, no subagents.
Baseline: GitHub main `a4c837be4bb47214163e2f1833704a1c20ba507b` (= live deploy `6af6b7046336772e72d92fcd` per its release record).
Branch: `feat/opus55-critical-improvements-20261117`. Evidence: [`docs/verification/2026-11-17-opus55/`](verification/2026-11-17-opus55/README.md).

## How this was assessed

* **Rendered play first.** I played compiled builds (`vite preview` on :4185) with ordinary keyboard/pointer input via the installed develop-web-game Playwright client and `window.advanceTime`. That meant four possessions each at 1440×900, 390×844 and 844×390, plus 667×375 for framing. I opened the screenshots and did not rely on DOM checks alone. No game state was patched in browser runs.
* **Measurement with the real engine.** Headless scripts drive `AuthoritativeMatchEngine` with simple human-like policies over 60–100 seeds per cell. They measure steals, release block-eligibility reasons and outcomes. Scripts and raw outputs are in the verification folder. These are policy simulations, not human play data.
* **Labels used below.** *Observed* = seen in rendered play. *Measured* = reproduced numerically. *Source* = visible in code but not measured. *Subjective* = tuning judgement.

## Summary verdict

The learning loop is the strongest part of CourtIQ. The immediate personal verdict, one teaching point, optional detail, learner-paced Continue, the 2→1 ready countdown and adaptive timing all work in compiled play. Their existing probes still pass, and I did not change them.

The basketball layer was weaker than its presentation suggests, in three ways:

1. **CourtBot's hands ignored its difficulty setting.** A reachable swipe always succeeded, and Beginner stole as reliably as Advanced.
2. **Phone landscape shrank the game.** Athletes were about a quarter of their desktop height.
3. **The defensive rules gave no explanation.** A learner could not tell why a block was impossible or why the ball was stolen.

This pass fixes or substantially reduces all three, without touching question content, controls, the countdown contract or networking. It is still a browser prototype with arcade inspiration, not an NBA Street/Jam-class game. The deferred list below is candid about what remains.

## Findings

| # | Finding | Kind | Severity | Status |
|---|---|---|---|---|
| F1 | CourtBot steals were 100% on every difficulty | Observed + measured | **High** | Implemented |
| F2 | Phone-landscape athletes were 39–48 px tall | Observed + measured | **High** | Implemented |
| F3 | Defensive rules were not explained, and phone hints named keyboard keys | Observed + source | Medium | Implemented |
| F4 | Chained tricks could keep a defender permanently wrong-footed | Measured (depends on policy) | Medium | Implemented |
| D1 | A steal creates an instant live-ball turnover with no question | Observed + measured | Medium-High | **Deferred: needs a design decision** |
| D2 | Offence against CourtBot is binary | Measured | Medium | Deferred |
| D3 | The dribble shield has no effect on steals | Source | Low-Medium | Deferred |
| D4 | Head-on bump pushes a set defender back at sprint speed | Measured (trace) | Low | Deferred |
| D5 | The fixed 500 ms tap window delays tricks | Source; part of the contract | Low | Not changed (approved contract) |
| D6 | Unused "too far away to block" banner text in `timing.ts` | Source | Low | Deferred |
| D7 | Feedback-phase camera sometimes frames the stanchion with athletes cut off (desktop) | Observed once | Low | Deferred |

### F1 — CourtBot stole a reachable ball 100% of the time, whatever the difficulty

* **Trigger.** On your possession, stand still for about a second, or pause briefly and then hold forward into CourtBot.
* **Source.**
  * [`defense.ts` `canStealBall`](../shared/rules/defense.ts#L29-L68) is a pure geometry test (1.45 m reach, facing, ball height).
  * [`matchStateMachine.ts` swipe contact](../shared/rules/matchStateMachine.ts#L881-L889) turned any reachable swipe into a steal.
  * [`aiOpponent.ts`](../shared/rules/aiOpponent.ts#L357-L360) swipes as soon as its timer allows. Difficulty changed CourtBot's approach speed, but not its hands.
* **Reproduction (seeded engine, 100 seeds).** An idle ball-handler was stolen within 3 s in **100/100** runs on Beginner, Intermediate and Advanced alike (median 1.32 s). Pausing 300 ms and then driving straight at default Intermediate: **66/80** stolen. Pausing 600 ms: **80/80**.
* **Rendered play.** The opening possession was stolen at desktop and phone-landscape sizes ([before screenshot](verification/2026-11-17-opus55/screenshots/before/desktop-opening-steal.png)). CourtBot then attacks a live ball and shoots about 0.9–1.1 s later (median).
* **Learner impact.** A student who pauses to look at the screen loses the possession, and the steal produces **no question**, so there is one fewer learning item. "Beginner" was not beginner-friendly in this respect.
* **Fix.**
  * CourtBot's swipe now connects with a seeded, difficulty-specific chance: Beginner 0.30, Intermediate 0.55, Advanced 0.80 (`AI_DIFFICULTY_PRESETS.stealSuccess`).
  * The roll uses its own RNG stream, so question and option selection is never shifted.
  * A deliberately over-exposed handle (trick spam into a set defender) is still always stolen.
  * Human swipes are unchanged.
  * A CourtBot miss uses the existing 1 s missed-swipe root, which gives the learner a readable "it reached and missed, now go" moment.
* **After.**
  * Idle within 3 s: Beginner 39, Intermediate 66, Advanced 84 (out of 100).
  * Pause 300 ms, then straight drive at Intermediate: 31/80. Pause 600 ms: Beginner 7/80, Intermediate 41/80, Advanced 66/80.
  * Angled drives and single-tap tricks: still 0/80 steals.
* **Status.** Implemented, with regression tests for rate ordering, determinism, the over-exposed punish and the miss root. Whether these rates feel right to students is **NOT_TESTED**.

### F2 — Phone landscape rendered the athletes far too small

* **Trigger.** Any match at 844×390 or 667×375.
* **Source.**
  * [`courtCamera.ts`](../client/game/camera/courtCamera.ts#L203-L212): the fit loop only ever moved the camera *further away*. A short, wide screen kept the broadcast distance and showed mostly stands.
  * The `max-height:500px` HUD rules let the HUD wrap to two rows (67–107 px; 93 px at 667×375).
* **Measured.** Projected athlete height at possession start ([before](verification/2026-11-17-opus55/data/framing-before.json)): desktop 170 px, portrait 131 px, **landscape 48 px, 667×375 39 px**. See the [before screenshot](verification/2026-11-17-opus55/screenshots/before/landscape-defence-tiny-athletes.png).
* **Player impact.** On a phone held sideways, spacing, the 2.6 m block range and defensive positioning are hard to read. The user had already identified phone defence as a pain point.
* **Fix.**
  * Short-landscape viewports (height ≤560, aspect ≥1.3) now move the camera *in* until every subject still fits the safe band. Subjects are both athletes, the rim and the airborne ball. The camera never comes closer than 0.55× the default distance.
  * Athletes are kept inside x ∈ [0.17, 0.83], clear of the thumb clusters.
  * The landscape HUD is a single 52 px row:
    * Utility buttons are icon-only, with aria-labels and 44 px targets.
    * The streak bar is hidden; the ✓n/3 pill still shows the streak.
    * The block pill moves under the HUD's right edge.
    * Below 720 px wide, the HUD also tightens further.
  * Desktop and portrait camera behaviour is unchanged.
* **After.** Landscape 48→78 px; 667×375 39→80 px at start; 69–76 px while driving. Desktop 169–170 px and portrait 123–131 px, the same as before. See the [after screenshot](verification/2026-11-17-opus55/screenshots/after/landscape-844x390-start.png).
* **Status.** Implemented. Tests check the ≥65 px target and that all subjects stay inside the safe band and thumb margins at 844×390 and 667×375. The possession-ready probe's 64 px badge-fixture clearance check still passes. **Physical phones and notch safe areas: NOT_TESTED.**

### F3 — The basketball layer did not explain itself, and phone hints named keyboard keys

* **Observed.**
  * The question card always said "📏 Question block unavailable at release", whatever the cause ([before](verification/2026-11-17-opus55/screenshots/before/landscape-generic-block-badge.png)).
  * The live pill "Block Available (≤2.6m)" was shown to the **attacker** ([before](verification/2026-11-17-opus55/screenshots/before/portrait-keyboard-hint-attacker-block-pill.png)).
  * On touch devices, the status pill said "SPACE: SHOOT • C: TAP FOR A TRICK" ([before](verification/2026-11-17-opus55/screenshots/before/landscape-live-keyboard-hint.png)).
  * Nothing warned a player before a head-on steal.
* **Source.** [`main.ts` question badge](../client/main.ts#L1314-L1324) used a single boolean. The release snapshot's `reason` was never shown, and `rule-disabled` merged the "swiping" and "wrong-footed" cases.
* **Fix.**
  * `BlockEligibilitySnapshot.disabledBy` now records `'off-balance'` or `'reaching'`. This field is for explanation only; eligibility is unchanged.
  * [`defensiveReads.ts`](../shared/rules/defensiveReads.ts) produces one short, role-aware line: too far (with the distance), off balance from the trick, reached for a steal, beaten behind the shooter, or swat connected.
  * The live pill now says "You can block ≤2.6m" to the defender and "Contested ≤2.6m" to the attacker.
  * Touch devices name the on-screen buttons instead of keyboard keys.
  * A **"DEFENDER SET • STEER AROUND OR TAP TRICK"** cue appears only while an unprotected live dribble is driven into a ready defender, inside steal reach. In final-build play it was visible for 0.35–0.8 s before any steal.
  * Two tutorial sentences were added. No new controls, panels or compulsory clicks.
* **Status.** Implemented and tested. Screenshots: [cue](verification/2026-11-17-opus55/screenshots/after/portrait-defender-set-cue.png), [reason badge](verification/2026-11-17-opus55/screenshots/after/landscape-reason-block-badge.png), [swat badge](verification/2026-11-17-opus55/screenshots/after/portrait-swat-reason-badge.png). Whether students actually learn from these cues is **NOT_TESTED**.

### F4 — Chained tricks could keep a defender permanently wrong-footed

* **Source.**
  * The trick wrong-foot applied to any defender within 2.55 m ([`matchStateMachine.ts`](../shared/rules/matchStateMachine.ts#L729-L736)), which is effectively the block range (2.6 m).
  * A new freeze could start the instant the previous one ended.
  * Advanced CourtBot chains a move every 0.25–0.4 s.
* **Measured.**
  * Against a defender holding a ~2 m goal-side cushion, **56/60** Advanced releases happened while the defender was wrong-footed. A block was then impossible, even with a correct and faster answer.
  * The result depends strongly on the defender's policy. A 1 m mirror defender saw this in only 2–4/60 Intermediate/Advanced releases.
* **Fix.**
  * The freeze is now graded by spacing: full within the 1.45 m steal reach, falling linearly to zero at 2.55 m. The "ANKLE BREAKER" callout appears only on a ≥60% freeze.
  * After a wrong-foot ends, a 0.45 s settle window prevents an immediate re-freeze.
  * Crowding the ball-handler therefore buys steal chances at the risk of being broken. A cushion keeps balance but concedes space.
* **After.** Advanced/cushion: **19/60** wrong-footed releases, 37/60 block-eligible. Being honest about cause: grading alone changed nothing measurable; the settle window produced the effect. The human's trick→drive→dunk against CourtBot was unchanged (80/80 dunks at every difficulty; identical contestability before and after).
* **Status.** Implemented and tested. Subjective defensive balance is **NOT_TESTED** with humans.

### Deferred findings

* **D1 — Steals create an instant live-ball turnover.** [`completeSteal`](../shared/rules/matchStateMachine.ts#L1454-L1474) flips possession in place, with no reset or countdown and no question. F1 makes this much rarer for the learner, but when it happens the learner defends a live ball at once. A streetball "clear it past the arc" rule or a brief reset would help, but either touches the approved "no new full movement locks" and countdown contracts. **Ross's call.**
* **D2 — Offence against CourtBot is binary.** A 38° angled drive or one trick tap reached a dunk in 80/80 runs at every difficulty. CourtBot's on-ball defence never stops a drive that isn't head-on; the outcome is then decided by the question and the shot probability. That may be intended for a learning game, but it limits arcade depth.
* **D3 — The dribble shield is cosmetic.** [`stepDribbleState`](../shared/rules/dribble.ts#L149) moves the ball to the hand away from the defender, but `canStealBall` uses only the reach from the defender's centre. Making the shield count would make human defence harder, so I left it alone.
* **D4 — The head-on bump bulldozes.** In the trace, a sprinting attacker pushed a set defender backwards at about 6.6 m/s with no lateral slide. This is subjective, and "fluid bump" is a contract.
* **D5 — Trick latency.** The fixed 500 ms tap window means a single crossover fires 0.5 s after the tap. It is an approved contract, so unchanged; it is the main reason a trick tapped *in* contact fails.
* **D6 — Latent misleading text.** `timing.ts` banner text says "too far away to block" for every reason the block was unavailable. It is not rendered in solo play today. If it is surfaced later, it should use `describeQuestionBlock`.
* **D7 — Feedback-phase camera framing (desktop).** Seen once; cosmetic.

## What I verified and did not change

The 2→1 handover countdown, Settings pause, held-movement resume and fresh actions all pass the possession-ready probe in portrait, landscape and desktop.

These also pass:
* Immediate feedback and the end-of-match retry: 19 flows.
* Adaptive timing, including a full 16-possession match, JSON/CSV exports and fixed/practice/mobile timing.
* The River/Sky trick→drive→dunk and CourtBot motion probe.
* The lobby privacy, import and multiplayer-inert checks at four sizes.

The following are unchanged:
* Question packs, keys, explanations and sources.
* The control scheme.
* Fire rules.
* Learning authority.
* Debug hooks.
* Public solo-only mode.
* Badge clearance rules.

## Not tested — claims I am not making

* No physical phones, tablets or touch ergonomics were tested; viewport emulation only.
* Device performance and frame rate were not measured.
* No human listening or audio quality assessment was done.
* Classroom learning effects, and whether the new cues improve learning, were not tested.
* Subjective play-balance and "fun" were not assessed with real players. The steal rates and settle window are reasoned defaults backed by policy simulations.
* The real Netlify badge iframe was not tested; that needs the parent's production gate. Local runs used the labelled 64 px fixture.
* No AAA or NBA-licensed parity is claimed.
