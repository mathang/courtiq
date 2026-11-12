# Multiplayer: reserved for a later version

On 12 November 2026 Ross asked to remove multiplayer for now and retain it for a future version. The public release supports playing CourtBot only. The previous room UI, shared rules, transports and multiplayer regression tests remain in the repository.

`shared/config/features.ts` sets `MULTIPLAYER_ENABLED = false`. The lobby mode/room controls are hidden and inert; frontend entry methods also refuse to start a connection. The shipped Netlify room handler and the default standalone HTTP/WebSocket server reject room access. A request parameter cannot enable the feature. Existing multiplayer tests explicitly enable their isolated handler/server to keep exercising future teaching and reconnect contracts.

Do not re-enable classmate play merely by flipping the flag. It needs a verified release covering:

- Durable, authenticated room state across independent workers and restarts, with atomic updates, persistent RNG/question/deadline state and idempotent inputs/answers/learning credit.
- Input sequencing, monotonic snapshots, responsive movement prediction and bounded reconciliation/interpolation, while the server retains authority over basketball outcomes, reading/deadlines and learning results.
- Same question/choice set and timing for both students; no public answer keys or reasoning before resolution; personal explanations and both-student Continue.
- Nickname-only guidance, minimal session data, short retention, private server credentials and no public access to private checkpoints.
- Actual two-browser tests for joins, restart/reconnect, concurrency, loss/reordering, latency, questions, both Continue, steals/blocks and movement into dunks; usable desktop/mobile question controls and candid limits.
- A backend verified to fit the authorised free/included allowance. No paid fallback, plan change, overages or credit purchases.

The current Netlify legacy Free account has no native database entitlement. No database or Supabase project was created. A prospective backend organisation choice was cancelled when the scope changed; it is not continuing authorisation for a future project. The Carbon High networking task was stopped before implementation changes, retaining its clean baseline and local brief. Its startup checks passed 178 tests and the strict build; that is not a completed networking implementation.
