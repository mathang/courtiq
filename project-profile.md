# Project verification profile: CourtIQ
- **Project and authorized root**: `/Users/ross_mac/Documents/antigravity/dazzling-goodall/courtiq` (isolated subdirectory to preserve existing UniSC 3D campus and scientific review artifacts in `/Users/ross_mac/Documents/antigravity/dazzling-goodall`).
- **User outcome and authorized changes**: Build **CourtIQ**, an original browser-based 3D half-court basketball learning game in TypeScript, Three.js, Vite, HTML/CSS, and a Node.js WebSocket authoritative multiplayer backend, implementing the complete 7-stage delivery specification.
- **Revision / working-tree state and source currency**: New greenfield implementation in `courtiq/` on current working tree (`Node v25.6.1`, `npm 11.9.0`). Course content grounded in static SPX101 snapshot (`2026-10-12` Canvas capture / `2026-09-07` synthesis).
- **Authoritative behavior contracts versus proposed assumptions**:
  - **Authoritative contracts (from user spec)**:
    - Shot probability: $P(\text{basket}) = \operatorname{clamp}(B + C(0.35 + 0.35S), 0.03, 0.95)$ where $S = \operatorname{clamp}(1 - (t - R)/(T - R), 0, 1)$, open bases `0.20` (close), `0.12` (mid-range), `0.07` (three-pointer), `-0.05` heavy pressure penalty, `-0.05` sprinting penalty.
    - Block eligibility frozen at release: within `1.8m`, forward-facing contesting cone, inside playable court.
    - Question duel rules: 1 valid submission per player per duel; wrong answers lock; protected reading period $R$ (default `2000ms`); answer window $T$ (default `12000ms`); tie tolerance `200ms`; eligible defender answering correctly strictly before attacker outside tie window blocks shot; attacker answering correctly first prevents block; ties award no block and preserve attacker bonus; out-of-range defender cannot block but records learning accuracy.
    - Separate clocks: `realClock` (deadlines/networking), `simulationClock` (movement/possessions), `presentationClock` (slow-motion visual flight).
    - Match structure: 1v1 half-court, alternating possessions, 2 pts inside arc / 3 pts outside, first to 11 (max 10 possessions per player), equal possessions before deciding a winner, paired overtime possessions, 15s movement clock.
    - Online security: Authoritative WebSocket room server owns positions, score, question keys, deadlines, block eligibility, and RNG outcomes; pre-resolution question payloads never include `correctOptionId` or `explanation`.
  - **Proposed starting balance parameters**: Numerical constants in `shared/config/balance.ts` are starting values for classroom playtesting rather than empirically validated educational parameters.
- **Architecture and data/side-effect boundaries**:
  - `shared/`: Framework-independent pure TypeScript rules (`shot.ts`, `block.ts`, `timing.ts`, `possession.ts`, `matchStateMachine.ts`, `aiOpponent.ts`), schema validation (`question-schema.ts`), and wire protocol (`messages.ts`).
  - `server/`: Long-running Node.js WebSocket room server (`ws`) running authoritative simulation and duel validation.
  - `client/`: Three.js 3D arena/characters/slow-motion spline trajectories + accessible HTML/CSS UI overlays + WebAudio procedural sound + 2D Canvas fallback if WebGL is unavailable.
  - `content/approved-packs/`: Versioned, teacher-approved JSON packs grounded in SPX101 Week 9 and Week 5 sources.
- **Existing toolchain and test commands**:
  - Build: `npm run build` (`tsc --noEmit && vite build`)
  - Unit & integration tests: `npm test` (`vitest run`)
  - Dev / Server: `npm run dev` / `npm run server`
- **Observable acceptance criteria**:
  1. Stage 1 (Rules prototype): Pure shot probability, speed score, block eligibility, duel resolution, and possession state machine pass all unit tests.
  2. Stage 2 (Solo playable slice): Human vs AI match completes from tip-off to match end with movement clock, alternating possessions, equal-possession win check, and overtime pairs.
  3. Stage 3 (Signature shot sequence): Slow-motion flight uses separate clocks (`realClock`, `simulationClock`, `presentationClock`) and $C^1$-continuous spline transitions without teleportation.
  4. Stage 4 (Content pipeline): JSON question pack validator rejects duplicate IDs, non-4 options, missing explanations, unapproved status, or invalid `correctOptionId`; loads 40+ approved SPX101 questions per pack without repeats in a match.
  5. Stage 5 (Online rooms): Two clients join a private room via code on the authoritative WebSocket server, complete duels without receiving `correctOptionId` before resolution, handle late/stale/duplicate messages, reconnect cleanly, and agree on all scores and outcomes.
  6. Stage 6 & 7 (Classroom usability, accessibility & visual polish): Remappable controls, fresh-press & no-autorepeat input protection, touch controls, reduced motion, mute, quality mode toggle, and browser verification.
- **Safeguards**:
  - Architecture: Renderer never decides shot outcomes; server strips answer keys before `DUEL_RESOLUTION`.
  - Types & validation: Strict TypeScript + runtime schema validator in `shared/content/question-schema.ts`.
  - Automated tests: Unit tests for rules/timing/trajectory continuity/input locks + integration tests spinning up the real WebSocket server with two simulated clients.
- **Required environments/devices/providers**: Local Node.js + headless/local Chromium browser verification. Multi-device physical university Wi-Fi and iOS/Android physical touch hardware remain `NOT_TESTED` until classroom pilot.
- **Sensitive data, cost and access boundaries**: Temporary pseudonyms only; no student PII, external paid APIs, or external LLM calls.
- **Explicitly out of scope**: 2v2 / full-court basketball, public matchmaking, text/voice chat, live LLM question generation, automatic email reporting.
