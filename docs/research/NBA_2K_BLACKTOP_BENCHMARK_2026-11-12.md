# CourtIQ: the path to a professional 1-on-1 basketball game

**NBA 2K Blacktop benchmark and implementation plan · 12 November 2026**

## Recommendation

Build one excellent, original, browser-friendly 1-on-1 possession before adding more modes or replacing the engine. The strongest next investment is a coordinated **player motor, basketball animation system and contact model**. Higher-resolution characters will help, but they will still look wrong if their feet slide, the ball leaves their hand, or defensive inputs stop working.

CourtIQ can aim for the immediacy, readability and finish of a strong commercial streetball experience while retaining its two action buttons and learning loop. Full visual and content parity with NBA 2K27 is a substantially larger production: the official release describes more than 7,000 new animations alone. A focused vertical slice gives us a useful, testable quality target. [2K27 gameplay announcement](https://newsroom-uk.2k.com/news/nbar-2k27-gameplay-unleashes-complete-on-court-control-in-a-balanced-two-way-era)

The current update addresses two immediate problems: defenders can keep steering through jumps and off-balance reactions, and the lobby now leads with playing rather than configuration. The longer-term work below is a proposed roadmap, not functionality already delivered.

## 1. What was examined

### Edition and mode boundaries

| Reference | Verified scope | How it informs CourtIQ |
| --- | --- | --- |
| NBA 2K27, console/PC generation | Current mainline edition, released worldwide on 4 September 2026 | Primary commercial benchmark. |
| NBA 2K26 Gen 9 | Previous edition, with documented movement and collision changes | Useful comparison for animation continuity and earlier Blacktop presentation. |
| NBA 2K27 Arcade Edition | Separate Apple Arcade release announced on 5 November 2026 | Relevant portable-device reference; its capabilities should be evaluated separately from the mainline game. |
| Blacktop-labelled creator footage | Actual visible 1-on-1 court play | Direct evidence of spacing, movement, framing and visual treatment in the sampled possessions. |
| The City / Crew HQ / Street Kings | Related modes with different structures | Useful references, without assuming their rules are Blacktop rules. |

The release dates are supported by [Take-Two’s 2K27 launch announcement](https://ir.take2games.com/node/32491/pdf) and [2K’s Arcade Edition announcement](https://newsroom-nl.2k.com/news/nbar-2k27-arcade-edition-now-available-on-apple-arcade). Crew HQ explicitly includes 1v1 half courts; Street Kings is described as a 3v3 mode. These are distinct references. [Official City overview](https://newsroom.2k.com/news/nbar-2k27-introduces-the-first-co-ed-city-in-franchise-history-rotating-rec-environments-and-rucker-park)

### Direct visual inspection

The following publicly accessible material was opened and inspected:

- **2K27 Blacktop, approximately 2:30–3:02:** inspected successive captures through right-wing dribbling, baseline separation, a rim attempt, renewed perimeter play and another drive. [Jianko’s footage, timestamped](https://www.youtube.com/watch?v=8isj2ugTwFI&t=150s)
- **2K26 Blacktop, approximately 1:00–1:32:** inspected close sideline pressure, a contested release, a perimeter shot, post/contact positioning and a further baseline approach. [NBA 2K Simulation’s footage, timestamped](https://www.youtube.com/watch?v=-GgG90xEUSc&t=60s)
- **2K27 official gameplay presentation, 2:10:** inspected the displayed layup/coverage frame. Streaming was intermittent, so this is a frame observation rather than evidence of uninterrupted motion. [Official video](https://www.youtube.com/watch?v=ukgQhX1m34g&t=130s)
- **Official 2K27 Rucker Park artwork:** inspected the court, surrounding environment, spectators, lighting and surface detail. [Original press image page](https://newsroom.2k.com/resources/nba-2k27-the-city-rucker-no-players-2)
- **Official collision close-up:** inspected ball protection, torso/arm proximity, materials and character detail. This is promotional artwork, not a collision accuracy test. [Original press image page](https://newsroom-uk.2k.com/resources/nba-2k27-gameplay-collision-system)
- **CourtIQ:** inspected current source, reproduced its defensive movement locks, ran automated rule tests, and played two browser clients using normal controls. Desktop, tablet-sized, portrait and landscape layouts were examined.

This was a source and sampled-footage review, not hands-on play of an installed NBA 2K retail build. Controller response, exact hitboxes, hidden attributes, animation counts visible in a particular mode, current patch tuning and commercial-game performance were not measured. Creator footage identifies its edition, but its exact installed patch and settings are unverified. Captured 2K material remains local research evidence; this report links to the originals rather than redistributing their assets.

### Patch context

2K’s official Steam announcement feed includes version 2.0 adjustments to contest detection, shooting, dunks and steals. It specifically addresses contests that were affecting shots without a genuine challenge. This matters because the benchmark is also an evolving game with balance defects and fixes. [Official publisher announcements on Steam](https://steamcommunity.com/app/4356430/allnews/)

The main 2K patch page returned an access error during this review. A third-party claim about a November update was not treated as verified patch evidence. The benchmark therefore identifies the current edition and the documented changes it actually examined, rather than claiming an exact latest-patch certification.

## 2. What gives the sampled 1-on-1 play its quality

In the 2K27 sequence, attacker and defender remain readable as a pair: a lateral change creates a visible gap, and the defender redirects while the ball-handler advances. The camera maintains enough court context to understand that gap. CourtIQ needs that same continuous relationship between input, body position and advantage. [Observed 2K27 sequence](https://www.youtube.com/watch?v=8isj2ugTwFI&t=150s)

The 2K26 sample shows close defence transitioning into a release and recovery without a separate interface interruption. It also shows a useful caution: spectators in the foreground can obstruct lower-body visibility. Our camera should protect the learning and control task even where a reference uses a more cinematic angle. [Observed 2K26 sequence](https://www.youtube.com/watch?v=-GgG90xEUSc&t=60s)

| Sampled event | What is visibly readable | Application to CourtIQ |
| --- | --- | --- |
| 2K27, about 2:32–2:38 | Low dribble stance, defender orientation, a baseline gap and a rim approach | Align ball hand, torso protection and movement; let a gap lead continuously into a finish |
| 2K27, about 2:45–2:54 | A new perimeter exchange, a change of direction and renewed separation | Vary move entries/exits, with a defender who redirects rather than losing all control |
| 2K26, about 1:10–1:18 | Close spacing becomes a more separated jump-shot release and follow-through | Give planting, release and recovery their own coherent poses; show why a shot was open or contested |
| 2K26, about 1:23–1:31 | Torso-to-torso pressure and a baseline approach | Support shielding, pivots and contact responses without treating every bump as a steal or an immovable wall |

These observations do not identify the hidden controller gestures or collision calculations. They establish visible relationships that we can reproduce with our own assets and simpler controls. The samples also show varied crowd poses, clothing, court wear and strong depth cues; a court can feel inhabited without filling the interface with extra text. [2K27 sample](https://www.youtube.com/watch?v=8isj2ugTwFI&t=165s), [2K26 sample](https://www.youtube.com/watch?v=-GgG90xEUSc&t=70s)

The broader documented benchmark includes defensive cutoffs, richer dribble composition, context-sensitive finishing and more informative contest feedback. Those are useful design goals; marketing descriptions do not establish that every interaction works perfectly in every mode. [2K27 gameplay overview](https://newsroom-uk.2k.com/news/nbar-2k27-gameplay-unleashes-complete-on-court-control-in-a-balanced-two-way-era)

For CourtIQ, the important qualities are:

1. A movement input consistently produces visible movement unless the game clearly explains a deliberate penalty or question pause.
2. Body contact produces pressure, yielding, sliding or a recognisable reaction.
3. The ball, hands, planted foot and centre of mass agree about what is happening.
4. A trick creates a legible advantage with understandable defensive counterplay.
5. The basket attempt has an approach, gather, take-off, release/contact, landing and recovery that belong to the same action.
6. Camera and sound communicate those events without hiding the decision the player must make.

These are our evaluation criteria, not a claim that a browser game already matches the commercial reference.

## 3. Current CourtIQ: strengths and material gaps

| Area | Current implementation | Main gap | Priority |
| --- | --- | --- | --- |
| Movement | Acceleration, braking, sprint stamina, direction changes | Needs a richer directional basketball motor and animation agreement | P0 |
| Defensive contact | This update adds yielding contact, sliding and small motion steps | Still needs authored body-up reactions and wider human playtesting | P0 |
| Dribbling | Four separation moves, chains, ball protection, one tap-count button | Limited move vocabulary and a deliberate 500 ms selection delay | P0 |
| Finishing | Automatic paint-drive dunks; four random styles; jumps and swats | Context filtering, approach variety, layups and contact-specific outcomes | P1 |
| Characters | Rigged GLB, 65 bones, 17 clips, 22,174 triangles, integrated kit | Basketball-specific motion, silhouette variety, material and hand detail | P1 |
| Camera | Approach, take-off, hang and reduced-motion framing | More reliable pair framing and closer attention to contact | P1 |
| Audio | Contact cues, recorded Foley, designed impacts and Fire cue | Human mixing/listening review and a more expressive event vocabulary | P1 |
| Computer opponent | Delayed observation, lanes, recovery, shot choices and trick chains | More deliberate 1-on-1 tactics and visible defensive intent | P1 |
| Multiplayer | Authoritative shared rules, WebSocket server and HTTP fallback | Prediction, interpolation and durable room/tick architecture | P0–P1 |
| Learning | Shared question, personal feedback, explanations, Fire streak, learner-paced Continue | Instructor review, misconception tracking and retention evaluation | P0–P1 |
| Lobby | Two play modes, name/topic and primary Start; Options disclosure | Classroom join links/presets can improve it further | P2 |
| Release confidence | Deterministic tests, rendered browser checks and asset verification | Real devices, campus network, human play balance and audio review | P0 |

The character figures come from the checked-in asset and [asset provenance](../../assets/source/README.md). They describe the asset, not its perceived quality. Increasing triangle count or bone count by itself is not an acceptance criterion.

## 4. Immediate defence and lobby changes

### Defence

The old simulation set movement targets to zero during both off-balance reactions and defensive recovery. A block jump could therefore immobilise a defender for most of a second. Contact also treated every recovering player as immovable.

The reproduced 300 ms test returned **0 m** of defensive travel in both an off-balance and a jumping scenario. With the revised motor, it returns approximately **1.45 m off balance** and **1.05 m during a steering jump**. These are deterministic software measurements, not human response-time results.

The revision now:

- Keeps directional movement available while wrong-footed; the reaction still affects defensive action availability.
- Allows steering during block jumps, at 72% of normal movement speed.
- Uses yielding body contact with a 0.82 m preferred separation and 0.70 m torso safety limit.
- Transfers approach pressure while preserving sideways motion around the opponent.
- Integrates motion/contact in steps no larger than 1/120 second, including at low outer frame rates.
- Retains the deliberately requested one-second missed-steal root, and avoids draining sprint stamina while rooted.
- Preserves the shared-question pause, frozen release geometry and answer timing.

Relevant implementation: [contact solver](../../shared/rules/contact.ts), [defence rules](../../shared/rules/defense.ts), [match simulation](../../shared/rules/matchStateMachine.ts) and [regression tests](../../tests/rules/fluidDefense.test.ts).

### Lobby

The earlier mobile lobby put a long explanation, three modes and five visible dropdowns above a Start action that could sit below the visible area. The new first screen contains **Play computer / Play a classmate**, name, question topic and the primary action. It hides the match HUD while in the lobby.

Options contains difficulty, appearance, timing, match length, preview, settings and teacher tools. Keyboard tabs support arrow keys, and native Space/Enter activation works for buttons and disclosures. Before a match, leaving a room releases the slot and resets readiness, so a new classmate can join without a ghost ready state. Custom imported question packs remain a computer-match feature; online topics are limited to server-available packs.

This is a meaningful usability improvement, but it does not replace testing with actual students discovering the game for the first time.

Current test, rendered-browser and deployment evidence is kept in the [release record](https://github.com/mathang/courtiq/blob/main/docs/verification/2026-11-12-fluid-lobby/README.md). The rest of this report describes proposed production work.

## 5. The next player motor

Keep gameplay control authoritative and drive animation from the same movement state. Add explicit grounded states for idle, dribble walk/jog, sprint, defensive shuffle, retreat, close-out, pivot, gather and recovery. Each state needs entry, exit and interruption rules.

Direction should matter. A defender shuffling laterally should not use the same stride as a forward sprint. A fast reversal needs a visible plant and a brief change of weight, while still accepting the next input immediately. Separate facing, travel direction and the ball-protection side instead of assuming they always point together.

Add controlled momentum rather than long lockouts. A planted defender can resist a drive; an arriving defender can yield or be displaced. Glancing contact should preserve the tangential movement that lets either player slide around the other. Contact should not silently cancel the whole control vector.

The current soft solver is a useful foundation. A subsequent body-up layer should classify front, hip, shoulder and rear contact; scale the reaction by approach velocity; and produce a short matching animation. Use torso/capsule collision for locomotion and separate ball/hand queries for a steal. A full-body ragdoll is unnecessary for normal basketball control.

Acceptance should include head-on pressure, diagonal slides, both players moving, corners, court boundaries and coincident positions. Test the same scenarios at 60, 30, 20 and 10 outer updates per second, with high-speed crossing tests as well.

### CourtBot needs a readable 1-on-1 plan

Extend the current delayed-observation AI into a small set of basketball intentions: size up, attack a side, protect/pivot, counter a cutoff, gather, and recover. On defence, use contain, shade the lane, close out, contest and recover. Each intention should have an explicit success condition and a short timeout, so the bot cannot oscillate under the basket indefinitely.

Use the same movement, contact, stamina and action rules as the student. A defender should respond to the observed direction/ball exposure, with difficulty changing delay and decision quality. It should not inspect unsubmitted inputs or future question answers. An attacker can favour a driving hand, switch to a counter after containment, or take an open jumper rather than repeating a blocked route.

Measure a seeded suite of possessions for time without progress, repeated lane reversals, late-clock bailouts, shot locations and stolen-ball recovery. Inspect the failures as rendered plays. This is a proposed CourtIQ design; the footage does not establish NBA 2K's internal AI implementation.

## 6. Tricks: richer basketball with the same two buttons

Preserve the simple Space and C scheme. Add context to the move chosen by the existing tap count: carrying hand, travel direction, defender side, court space, current speed and the preceding move should influence the variant.

A crossover needs a hand change and a lateral weight transfer. A spin needs a planted pivot, torso shielding and a controlled exit. A eurostep needs two distinguishable lateral steps before the gather. A stepback needs deceleration, an actual rearward plant and a balanced shot transition. Each can have left/right and moving/standing variants without adding buttons.

The 500 ms tap-count window is a conscious trade-off: it makes selection simple but can delay the committed trick. We should preserve the requested behaviour in the release, then test an immediate visual anticipation response on the first press. An optional shorter selection window or contextual single-press system would be a separate design decision, evaluated with students rather than changed silently.

Counterplay should depend on positions and decisions. A defender who stays balanced and protects the driving lane should remain useful. Repeating a move into contact can expose the ball or consume more stamina. A successful trick should create advantage through displacement, protection or timing, while the defender keeps directional agency.

An initial content target is **12 useful variants**: four move families, both directions, plus selected moving/standing or exit variants. That is a proposed production target, not an existing animation inventory.

## 7. Dunks, layups and shot outcomes

Random style selection is fun, but it should operate inside a set of contextually valid finishes. Filter by launch distance, approach angle, available space, ball hand, defender position and current animation state; then randomise within the valid set and avoid immediate repeats.

Add a normal layup and a protected layup so every close attempt does not need the same spectacular flight. Keep exaggerated arcade finishes as the identity of CourtIQ, particularly during Fire, with readable take-off and landing rules.

Treat the possession as one connected sequence:

| Phase | Required behaviour |
| --- | --- |
| Approach | Stride and dribble reflect actual ground velocity |
| Gather | Ball moves into a stable hand grip; feet choose a valid launch |
| Take-off | Momentum carries into the jump; defender can challenge visibly |
| Question hang | Body and ball hold a coherent pose; question timing remains shared |
| Resolution | Make, miss or swat follows the actual authoritative result |
| Landing | Feet clear rim/stanchion and absorb impact |
| Recovery | Control and locomotion return without a pose snap |

A defender should challenge the ball’s reachable space and timing, not an invisible all-purpose radius alone. Preserve generous beginner windows, with clear feedback for a connected swat, late attempt, poor angle or insufficient reach. Avoid using a visual animation that suggests contact when the result was decided elsewhere.

### Shot skill and 1-on-1 rules

The published 2K27 design includes stick-based shooting timing/tempo and a timing requirement for its rhythm mechanic. CourtIQ should keep knowledge as the main accuracy advantage, with basketball positioning and the capped Fire bonus making it feel rewarding. Adding a demanding second timing test to every question would raise motor-skill demands and could obscure what the student knows. [Official shooting overview](https://newsroom-uk.2k.com/news/nbar-2k27-gameplay-unleashes-complete-on-court-control-in-a-balanced-two-way-era)

Offer deeper basketball actions only as optional, contextual extensions: a convincing pivot, a protected dribble, a pump fake or a change of finishing hand. Preserve the immediate primary action and teach any advanced gesture on a practice court. Keep the front lobby simple.

The sampled Blacktop interface displays score and a possession countdown. Exact scoring, clear-the-ball, foul, rebound and winner-keeps-possession settings were not established by those samples. Before adopting a rule, test it in an installed, identified build. In CourtIQ, equal question opportunities and alternating attempts take priority over importing another mode's rules wholesale.

For rebounds, start with a polished visual continuation into the next possession. Interactive loose-ball rebounds could later become an optional basketball mode, provided they do not undermine equal learning opportunities. The teaching game’s alternating possessions are a deliberate fairness rule, so standard Blacktop possession rules should not be copied automatically.

## 8. Animation and character production

2K26’s published movement work emphasises lower-body pose matching and more coherent player collisions. That supports prioritising feet, transitions and contact before surface detail. [2K26 movement overview](https://newsroom.2k.com/news/nbar-2k26-debuts-new-gen-9-gameplay-improvements-including-an-all-new-dynamic-motion-engine-powered-by-proplay)

CourtIQ should build a small basketball-specific animation library around a consistent rig and scale. The next set should include lateral shuffles, backwards dribbles, hard stops, pivots, both crossover directions, protected spins, gathers from both lead feet, at least two layups, dunk entries, vertical blocks, swipe recoveries and body-up reactions.

Use authored movement as the base, then add limited runtime correction:

- Match stride phase and speed to actual travel.
- Lock the support foot while it is planted, then release it for the next step.
- Blend the pelvis and torso through changes of direction.
- Use hand IK only during meaningful contact/grip phases; a dribbling hand should not chase the ball to the floor.
- During a secure gather, the ball should follow the grip. At release, it should transition to the shared ball trajectory continuously.
- Test each combination of carrying hand, direction, appearance and finish outcome.

For the character itself, prioritise recognisable athletic proportions, shoulder/hip deformation, hands, footwear and hair silhouettes. Improve fabric roughness, skin response and normal detail within an atlas. Keep the integrated singlet/socks approach that already removed clothing intersections; add garment folds through careful modelling and materials before introducing expensive simulated cloth.

Define at least three quality levels. The close-up/player lab can use the richest model, the match camera a lighter version, and distant spectators a substantially simpler one. Validate jersey names and numbers through every optimisation step.

## 9. Art direction, camera and sound

### Art

The official Rucker image has environmental depth, varied spectators, foliage, fencing and a court surface with visible material character. The contact close-up shows layered skin, hair and fabric detail. These are visual observations from the press images, not measurements of their runtime cost. [Rucker artwork](https://newsroom.2k.com/resources/nba-2k27-the-city-rucker-no-players-2), [collision close-up](https://newsroom-uk.2k.com/resources/nba-2k27-gameplay-collision-system)

Choose one coherent original campus/street court. Give the space a believable surface, a restrained background, intentional light direction and recognisable local character. The current court’s branding can remain, while oversized repeated labels and visual clutter are reduced. Improve contact shadows, skin/jersey material separation and the ball before adding more scenery.

A stylised premium look is a practical browser target. Photorealistic scanned NBA likenesses and a large city are not prerequisites for a convincing two-player game. Art direction should be assessed from the actual match camera as well as the attractive player close-up.

### Camera

Use a stable gameplay view that fits attacker, defender, ball and hoop. Change framing modestly for a committed drive; reserve stronger emphasis for the resolved impact. Smoothly return before the next movement decision.

The question card must have a reserved region, with the meaningful airborne action framed above it. Test extreme launch positions, both approach directions, all four dunk styles, a jumping defender and long question text. Reduced Motion should preserve spatial readability with steady framing. Celebratory cuts and replays belong after an outcome, with a skip option, rather than during timed answering.

### Sound

Layer ball bounce, hand reception, foot plants, shoe friction, body contact, rim/net impact and a restrained crowd response. Trigger them from visible events, with bounded simultaneous voices and sensible variation. A Fire ignition cue should be recognisable without overwhelming instruction or making mistakes punitive.

The existing audio system is a starting point. A human headphone/speaker review is required for balance, harshness, repetition and classroom suitability. Measured mute and event counts do not establish a good mix. Use original or appropriately licensed assets; no purchase or generation service has been commissioned for this report.

## 10. Engine and tools decision

**Keep Three.js for the next vertical slice.** This is an engineering recommendation based on the working code, existing DOM teaching interface, small distribution and testable shared TypeScript rules. The current defects were in our state/motion logic; changing renderer would not automatically correct them.

| Path | Appropriate use | Decision gate |
| --- | --- | --- |
| Existing Three.js + focused motor/animation work | Fastest way to improve the deployed teaching game | Preferred next phase; retain shared authority and accessible DOM questions |
| Three.js + a tested physics library | More elaborate loose-ball/rim/world collision needs | Prototype one possession and prove it improves control, determinism and payload |
| Godot web prototype | A future need for a scene/animation authoring workflow | Compare a representative browser build on actual classroom devices before migration |
| Separate native-engine evaluation | A future decision to target installed desktop/console applications | A separate product/distribution/budget decision, with a measured prototype |

Rapier documents character movement and sliding support, while cautioning that a general controller needs game-specific adaptation. It is a candidate for a prototype, not a substitute for basketball design. [Rapier controller documentation](https://rapier.rs/docs/user_guides/javascript/character_controller/)

Godot’s current web-export documentation lists WebAssembly/WebGL requirements and mobile/export constraints. Its native capabilities should not be assumed to carry over unchanged into a classroom browser build. [Godot web-export documentation](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)

Use a DCC workflow such as Blender for the original player, retargeting cleanup, authored contact poses and export validation. Keep reproducible GLB builds and retain the current licence/provenance records. A renderer upgrade, new animation system or DCC purchase should have its own small proof of concept; none is required to deliver the current defence/lobby fixes.

## 11. Multiplayer is part of game feel

The standalone server currently advances on a 50 ms interval. The hosted fallback polls HTTP, and rooms live in process memory. Small contact substeps improve collision stability, but they do not make the outer networking loop a 120 Hz multiplayer service.

For professional play, define one authoritative simulation clock, timestamp input intentions, and add presentation interpolation. Predict local movement and reconcile it gently, while keeping answers, question timing, Fire, scores, steals and blocks authoritative. Prediction must never grant learning credit or reveal answers.

The hosted architecture also needs room ownership/persistence that survives process changes and concurrent instances. Test reconnects, both students loading at different speeds, 100–250 ms network latency, jitter, dropped updates and multiple simultaneous rooms. These are implementation and validation tasks, not reasons to enable a new paid service during this work.

There is also an assessment boundary: online pre-resolution payloads omit answer keys, but the client currently bundles static question packs for solo practice. It should therefore be treated as a formative learning game. A secure-assessment product would require a separate server-only question/key delivery design and a clearer threat model.

## 12. Improve the learning system alongside the basketball

Preserve the useful existing contracts: the same question and choice set for both students, shared reveal/reading timing, stable option IDs, one locked answer, personal feedback, learning credit independent of the basket, and both students confirming Continue.

One rendered feedback detail still needs clearer wording: a shared basketball-outcome headline can begin with “Correct” above an individual student's incorrect-answer verdict. Label that shared outcome explicitly as the basketball result, and keep the student's own answer verdict visually primary. Separating the data is necessary; the wording must make the distinction equally clear.

The 255 new wrong-choice rationales need instructor review before they are described as approved feedback. Check that each addresses the actual misconception, uses course terminology and does not introduce unsupported detail.

Next, record misconception categories rather than only right/wrong totals. A practice session can revisit an explanation after a few possessions and later ask a related transfer question. Keep this scheduling fair in competitive matches; personalised revision can occur between matches or in solo practice.

Retain the three-correct Fire mechanic, with a clearly displayed learning streak and the current capped basketball advantage. Offer a low-pressure practice setting where careful reading receives full learning credit without response speed being presented as mastery.

Evaluate learning separately from enjoyment. Use a short baseline quiz, a delayed concept check and a transfer item, alongside usability and engagement questions. Check whether students understand the explanation after a mistake, whether novices can control defence, and whether skilled gamers dominate the basketball without understanding the content. These are proposed evaluation methods; improved learning outcomes have not been established by software tests.

## 13. Prioritised production backlog

The following effort labels are rough planning estimates, not quotes or commitments: **S** roughly 1–2 focused developer days; **M** roughly 3–7; **L** roughly 8–15 or more. Character/animation authoring and classroom evaluation need separate time. Estimates should be refined after a measured prototype.

| Order | Work package | Concrete deliverable | Effort | Exit gate |
| --- | --- | --- | --- | --- |
| 1 | Defensive agency and contact | Steering through reactions, soft bump/slide and low-FPS safety | Implemented in this update | Rule and real-browser contact tests pass |
| 2 | Student-first entry | Simple lobby, accessible controls, clear room readiness/leave | Implemented in this update | Start visible on phone/landscape; two students can join and play |
| 3 | Basketball motor | Directional shuffle/retreat/plant/close-out states and interruption rules | M–L | A defender can contain, turn and recover without unexplained lockouts |
| 4 | Animation continuity | Foot phase, hand/ball grip, stride matching and gather/landing transitions | L + animation work | Representative possessions meet contact and sliding tolerances |
| 5 | Contextual finishing | Valid random finish selection, two layups and contact-aware results | M–L | No implausible finish selection or result/animation contradiction |
| 6 | Network authority and smoothing | Stable room lifecycle, tick ownership, interpolation/reconciliation | L | Latency/reconnect/concurrency tests pass on the target deployment |
| 7 | Character and material pass | One polished original athlete family with quality levels | L + artist work | Match-camera and close-up review; all kit/jersey variants pass |
| 8 | Court/camera/audio pass | One coherent venue, readable pair framing and reviewed mix | M–L | Desktop/mobile and reduced-motion review; human listening sign-off |
| 9 | Content review and revision loop | Approved misconception feedback and measured practice scheduling | M + teaching time | Instructor sign-off and learner comprehension check |
| 10 | Classroom trial | Real devices, real network and representative student abilities | Planned trial | Documented defects, retention evidence and a clear release decision |

Work packages 3–6 are the most important next engineering phase. Commissioning an elaborate city or many extra characters before those gates would dilute effort from the possession that students actually control.

## 14. A measurable definition of professional quality

These are proposed acceptance targets. They are not measured NBA 2K specifications and should not be reported as achieved until tested on named devices.

| Dimension | Proposed target / evidence |
| --- | --- |
| Ordinary control response | 95th-percentile visible movement/primary-action response within 100 ms locally; report the separate 500 ms trick-selection window |
| Movement reliability | No unexplained movement lock in a 10-minute scripted duel; deliberate swipe/question states are clearly indicated |
| Contact | No body tunnelling, non-finite state or court escape under the supported update-rate/latency matrix |
| Foot planting | Support-foot drift under 3 cm during a declared planted phase in representative clips |
| Hand/ball contact | During a declared secure grip, palm-to-ball-surface error under 2 cm; continuous release transition |
| Clipping | No material body/kit/rim/stanchion penetration in an agreed matrix of moves, styles, sides and outcomes |
| Camera | Ball, hoop and relevant body actions remain readable; no question/hosting UI covers an answer or primary action |
| Performance | Target 60 FPS desktop / stable 30 FPS lower-power devices, with percentile frame times and thermal tests recorded |
| Delivery | Initial playable download target at most 10 MB compressed; measure cold-load time on classroom connectivity |
| Accessibility | Keyboard/touch/reduced-motion/zoom checks, 44 px touch targets, contrast review and assistive-technology testing |
| Multiplayer | Same question/reveal/timing, protected keys, consistent outcomes, stable reconnect and several concurrent rooms |
| Learning | Every rationale reviewed; student can explain the misconception; retention and transfer assessed separately from score |
| Release | Strict build, meaningful rules/integration tests, inspected rendered build and exact deployed-asset verification |

The target matrix should include actual school/classroom hardware, not only resized desktop browser windows. Quality settings need to preserve input and question readability before preserving decorative effects.

## 15. The next vertical slice to build

Use one court, two original athletes and the current two-button scheme. Demonstrate a defender shuffling into body contact; an attacker crossing over, changing direction and either creating space or being contained; a protected gather; a contextual random dunk or layup; a visible defensive challenge; the shared learning question; personal corrective feedback; and a smooth return to the next possession.

Repeat that slice with the opposite carrying hand, the other approach side, a miss, a swat, low stamina, Fire, a novice player and a lower-power device. Add a simulated network delay and a reconnect. A polished possession should remain convincing across those variations, rather than relying on one carefully staged highlight.

That is the most credible path towards the quality Ross is asking for: a controllable basketball game with a distinctive teaching purpose, supported by an asset and release pipeline that can keep improving it.

## Source and validation notes

Research accessed on 12 November 2026. Official publisher material establishes announced features and release context; it is not independent proof of performance. The sampled creator footage supports the specific visual observations above, without establishing its controller inputs or exact build. CourtIQ findings come from inspected code and direct software/browser checks. Illustrative timings, tolerances, content counts and effort estimates in the roadmap are proposed targets unless explicitly identified as current measurements.

The extended 2K patch page and some media streams were inaccessible or intermittent; accessible official news/Steam material and visible footage were used. No game was purchased, no assets were bought or copied into CourtIQ, and no paid API or generation service was used. Hands-on retail benchmarking, physical-device performance, human audio listening and classroom learning outcomes remain follow-up validation work.
