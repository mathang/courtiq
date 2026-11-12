# CourtIQ teaching design

12 November 2026. This is a formative practice game; basketball scores, response speed and Fire are game rewards, not measures of course mastery.

## Implemented in this release

- **Feedback immediately after a locked solo answer.** The learner sees their own result while CourtBot is still thinking. Reading protection and the one-answer rule remain. CourtBot commits its answer and answer time before the learner answers; revealing feedback does not change that plan or resolve the shot early.
- **One short teaching point.** Correct answers show the existing course explanation. Incorrect answers show the correct option and the explanation for that particular distractor, falling back to the course explanation for imported packs without distractor feedback. Unanswered questions show the correct option and course explanation rather than an extra admonition. The bundled explanations are 14–37 words, so they are preserved whole rather than mechanically cut off.
- **Progressive disclosure.** More detail contains the original question, chosen answer, any additional general explanation and source. The default view does not repeat the stem, selected answer, correct answer and explanation together. Opening a review survives the bot-answer and shot transitions.
- **Personal learning first.** Correctness is the heading; the court outcome is secondary. A shared headline about the attacker's correctness can no longer be mistaken for the learner's own result. Fire progress stays compact and is still awarded only by resolved learning answers.
- **Time to read.** The card remains until the learner continues. While CourtBot is deciding or the shot is resolving, Continue is disabled. Keyboard focus moves to the feedback heading once per question, not once per frame.
- **Retrieval before rereading.** End-of-match explanations are folded away, missed/unanswered items appear first, and the retry button states how many missed questions it will practise. The existing retry mode uses that learner's missed/unanswered items.

Original approved questions, options, answer keys, explanations, sources and timing are unchanged. No runtime AI or external service generates teaching feedback. The previously added option-specific rationales are draft instructional copy requiring instructor review.

## Evidence and limits

These are design decisions informed by research, not evidence that this particular game improves learning.

Explanatory feedback generally supports learning better than a correctness signal alone, although effects depend on the task and learner. That supports retaining a brief explanation even after correct answers rather than showing only a tick. [Van der Kleij, Feskens & Eggen (2015), meta-analysis](https://people.acer.org/en/publications/effects-of-feedback-in-a-computer-based-learning-environment-on-s/).

Feedback should address the task, be specific enough to guide correction, and avoid overwhelming the learner. This motivates selected-misconception feedback and optional detail. The timing literature is conditional; immediate feedback here meets the requested correction flow, and should not be presented as universally better for long-term retention. [Shute (2008), review](https://doi.org/10.3102/0034654307313795).

Retrieving an answer can improve delayed retention compared with rereading. This supports making a fresh retry prominent while keeping review answers folded. The original research used other learning tasks; it does not establish an effect size for CourtIQ. [Roediger & Karpicke (2006), experiments](https://doi.org/10.1111/j.1467-9280.2006.01693.x).

## Recommended next teaching phase

1. **Spaced revisits and transfer.** Bring missed concepts back after intervening questions and in a later session, using a parallel scenario rather than only repeating the exact question. Continue rehearsing a sample of previously correct concepts too. Start with local, optional progress; do not add student identities or a database by default.
2. **Application over recognition.** Extend instructor-approved packs with paired examples, short predictions and practical decisions, aligned to the existing learning outcomes. A correct guess should not be treated as a mastered concept. An optional “explain the rule to a partner” classroom prompt can check reasoning without adding another compulsory in-game click.
3. **Validate with students.** Review every distractor rationale with the instructor, then measure delayed retention and application to unseen problems, alongside readability and completion. Compare equivalent question sets rather than interpreting more wins, faster answers or immediate replay accuracy as learning gains.

The current release has no cross-session spaced scheduler or new application question bank. Browser tests establish software behaviour and layout; physical-device usability and classroom learning outcomes still need human evaluation.
