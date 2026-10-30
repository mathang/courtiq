Original prompt: Improve CourtIQ (https://github.com/mathang/courtiq and https://courtiq-spx101.netlify.app/) with smoother, faster players, NBA Street inspired separation moves (spins, eurosteps and tricks), airborne dunks and more exciting gameplay.

2026-10-31: Inspected live game and fresh main checkout. Implement in isolated branch. Preserve course questions, answer protection and authoritative shot/score rules. Baseline production deploy: 6ae519d98d41701a4da607f5.

Implemented faster acceleration/braking, stamina tuning, four cooldown-gated authoritative moves, brief nearby defensive wrong-footing, delayed AI observations, rounded jointed rigs, dunk takeoff/hang/finish/landing, keyboard/touch controls, pause/input reset and deterministic browser hooks. Existing 21 tests plus 10 movement/finish regressions pass.
User follow-up: add player names to jersey backs. Added dynamic CanvasTexture nameplates above each back number, updated from pseudonym for both slots.

User follow-up: both students must receive the same question in student-versus-student mode. Existing authoritative engine selects one question per duel and only shuffles option order per slot. Added explicit same-ID/stem/options/timing/reveal-time checks through both WebSocket and Netlify HTTP adapters.

Final local checks: npm test 31/31; npm run build PASS; skill Playwright client PASS. Supplemental browser playtest exercised C/Q/E/X, cooldown, Turbo drive to dunk, airborne ball y=3.17m, reading lock, answer/feedback, pause/resume and touch at 844x390/390x844. Inspected all move/dunk/name/touch screenshots; fixed mobile HUD overflow (now false). No page errors. Netlify linked to existing site (already gitignored .netlify/); preview 6ae51de741cd3d62ead86e4a. Two synthetic students on deployed preview got identical question/choices/reveal time with answer keys hidden. Physical devices/campus Wi-Fi remain NOT_TESTED.

Published: GitHub main source 5f2ccf8d565b1e35ad582cca0485f1743ba8233d; Netlify production deploy 6ae51e61fcaf0370e6a793ef. All live JS/CSS hashes match tested dist. Production browser gameplay screenshot inspected; live production same-question two-student HTTP smoke PASS. Existing browser tab reloaded and left at updated lobby. No outstanding implementation TODOs. Remaining human validation: physical touch ergonomics, campus Wi-Fi and subjective game balance.
