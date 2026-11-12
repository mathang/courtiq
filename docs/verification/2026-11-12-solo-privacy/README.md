# Solo-only and nickname privacy release — 12 November 2026

The user cancelled the networking/database phase and requested that multiplayer be removed for now, with its implementation kept for later. The Carbon High task started from fresh47ec617, explicit useG1Credits:false, passed the178-test baseline and was stopped before code changes. No database/project, paid service or billing/plan change was made (`scope-change.json`).

## Changes

- Public game offers CourtBot matches only; classmate/room UI is hidden and inert, with guarded entry methods. The public room handler/default standalone HTTP and WebSocket server reject multiplayer. Health still advertises solo readiness.
- Multiplayer rules, transports, markup and tests remain for future work. Existing server/HTTP tests explicitly opt in to the retained feature. A client request cannot override the disabled release flag. The roadmap records the durability, latency, privacy, fairness and cost gates required before re-enabling.
- Lobby label is Nickname, followed by: “Use a nickname. Don't use your full name, email, student number or other personal details.” Player Lab also shows nickname guidance and replaces the personal surname default with HOOPSTER. The reminder is guidance, not automatic PII detection.

## Verification

180/180 tests across25suites and strict TypeScript/Vite build pass (`tests.txt`, `build.txt`). The two new integration checks reject hosted requests before parsing identity/client overrides and verify disabled standalone HTTP/WebSocket routes plus healthy solo metadata. All earlier multiplayer logic tests remain, enabled explicitly only in their isolated fixtures.

`lobby-local.json` checks1440×900,768×1024,390×844 and844×390: privacy/start visible without scrolling, no horizontal overflow, native keyboard Start, teacher sample import, character/palette/nickname preservation and no multiplayer after return. Synthetic events on parked controls also start no room/WebSocket calls. Zero nickname POSTs or page errors were observed. Player Lab nickname guidance/default/name artwork was checked. Desktop, portrait, landscape and lab screenshots were opened and inspected.

`matches-compiled.json` records actual ordinary-input River/Sky trick→paint drive→random dunk→question→resolution/landing→CourtBot next attack sequences,21captures each and0page errors. The installed game-skill finite input client was run and its screenshot opened (`skill-local.png`).

`build-manifest.json` records runtime source and29built files. Hosted preview/production IDs, exact asset/function correspondence and actual live checks are added on completion. Historical verification folders describe earlier multiplayer-enabled releases and do not imply that it remains offered now.

## Limits

No networking improvement or durable backend is claimed; that work is deferred. Physical phone/campus-network testing, human-ear listening and instructor review of prior draft distractor rationales remain separate. Nicknames can appear in reports the student explicitly exports. No new identity or analytics collection was added.

Hosted preview `6af510c40d07815faf1377ac` passes all29built-file hashes, four viewport/lab/privacy/keyboard/import checks with0 room/WebSocket/identity calls and0page errors, plus health200/multiplayerfalse and room503/MULTIPLAYER_DISABLED even with a client override. The backend exclusion is intentional for this solo-only release. Source push/production promotion follow.
