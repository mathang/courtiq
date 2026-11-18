import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.COURTIQ_URL ?? 'http://127.0.0.1:4173';
const output = process.env.REVIEW_OUT ?? 'output/arcade-match';
await mkdir(output, { recursive: true });
const packDir = 'content/approved-packs';
const questions = (await Promise.all((await readdir(packDir)).filter(name => name.endsWith('.json'))
  .map(async name => JSON.parse(await readFile(`${packDir}/${name}`, 'utf8')).questions))).flat();
const browser = await chromium.launch({
  args: process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const report = [];

try {
  for (const [name, width, height, touch] of [
    ['desktop', 1440, 900, false], ['portrait', 390, 844, true], ['landscape', 844, 390, true],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    const touchSession = touch ? await page.context().newCDPSession(page) : null;
    const errors = [];
    const roomRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/room')) roomRequests.push(request.url()); });
    const step = ms => page.evaluate(ms => window.advanceTime(ms), ms);
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const photo = label => page.screenshot({ path: `${output}/${name}-${label}.png` });
    const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
    const primary = () => touch ? click('#btn-touch-shoot') : page.keyboard.press('KeyJ');
    const secondary = () => touch ? click('#btn-touch-trick') : page.keyboard.press('KeyK');
    const point = async (selector, dx, dy, id) => {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, selector + ' tap target');
      return { x: box.x + box.width * dx, y: box.y + box.height * dy, id };
    };
    const drive = async ms => {
      if (touchSession) {
        const stick = await point('#touch-joystick-base', .68, .14, 1);
        const turbo = await point('#btn-touch-sprint', .50, .50, 2);
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick, turbo] });
        await step(ms);
        await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.keyboard.down('KeyW');
        await page.keyboard.down('KeyL');
        await step(ms);
        await page.keyboard.up('KeyL');
        await page.keyboard.up('KeyW');
      }
    };

    await page.addInitScript(() => {
      let seed = 4107;
      Math.random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 2 ** 32);
    });
    await page.goto(baseUrl);
    await page.waitForFunction(() => window.render_game_to_text &&
      JSON.parse(window.render_game_to_text()).playerModels.every(model => model === 'ready'));
    await step(0);
    assert.match(await page.locator('#lobby-overlay').innerText(), /nickname/i);
    assert.equal((await state()).features.multiplayer, false);
    await click('#btn-lobby-help');
    const rules = await page.locator('#tutorial-modal').innerText();
    assert.match(rules, /WASD or joystick/);
    assert.match(rules, /IF CORRECT/);
    await click('#btn-close-tutorial');
    await page.locator('#lobby-options > summary').click();
    await page.selectOption('#select-session-length', 'quick');
    await page.selectOption('#select-ai-difficulty', 'intermediate');
    await page.locator('#lobby-options > summary').click();
    await click('#btn-start-solo');
    await step(70);
    const first = await state();
    assert.equal(first.phase, 'Possession');
    assert.ok(first.presentation.shotForecast > 0);
    assert.match(await page.locator('#arcade-commentary').innerText(), /Light up/);
    await photo('floor');

    if (touch) {
      for (const [id, expected] of [['shoot', 'rgb(185, 28, 51)'], ['trick', 'rgb(19, 78, 174)'], ['sprint', 'rgb(245, 247, 255)']]) {
        const button = page.locator('#btn-touch-' + id);
        assert.equal(await button.evaluate(el => getComputedStyle(el).backgroundColor), expected);
        await point('#btn-touch-' + id, .5, .5, 1);
      }
    }
    const rounds = [];
    let attacked = 0;
    let defended = 0;
    let stepbackDistance;
    while ((await state()).phase !== 'MatchEnd' && rounds.length < 28) {
      let current = await state();
      if (current.possessionCountdownMs > 0) await step(current.possessionCountdownMs + 25);
      current = await state();
      const human = current.attacker === 0;
      if (human) {
        attacked++;
        if (attacked === 1) {
          const before = current.presentation.shotForecast;
          for (let i = 0; i < 4; i++) {
            await secondary();
            if (i < 3) await step(45);
          }
          assert.equal((await state()).trickSelection.move, 'stepback');
          await step(680);
          current = await state();
          assert.equal(current.players[0].lastTrick, 'stepback');
          stepbackDistance = current.players[0].z - first.players[0].z;
          assert.ok(stepbackDistance > .3, `Step-back moved ${stepbackDistance} metres`);
          await photo('stepback');
          await drive(630);
          current = await state();
          assert.ok(current.players[0].sprintStamina < .9, 'Turbo was never used');
          assert.ok(current.players[0].z < first.players[0].z + stepbackDistance - .6, 'Drive did not move towards hoop');
          assert.notEqual(current.presentation.shotForecast, before, 'Position and contest did not change forecast');
        } else {
          await drive(420);
        }
        if ((await state()).phase === 'Possession' && (await state()).attacker === 0) {
          await primary();
          await step(40);
          assert.equal((await state()).phase, 'QuestionReady');
        }
      } else {
        defended++;
        if (defended === 1) {
          await secondary();
          await step(20);
          assert.equal((await state()).players[0].defenseAction, 'swipe');
        }
        for (let i = 0; i < 80 && (await state()).phase === 'Possession' && (await state()).attacker === 1; i++) await step(100);
        if ((await state()).phase === 'QuestionReady') {
          await primary();
          await step(15);
        }
      }
      for (let i = 0; i < 24 && (await state()).phase === 'QuestionReady'; i++) await step(50);
      current = await state();
      if (current.phase === 'Possession' || current.phase === 'MatchEnd') {
        rounds.push({ turnover: current.commentary });
        continue;
      }
      if (current.phase === 'Duel') {
        assert.equal(current.presentation.shotForecast, null);
        const live = current;
        const stem = (await page.locator('#q-stem-text').innerText()).trim();
        const q = questions.find(question => question.stem === stem);
        assert.ok(q, 'Question comes from the approved packs');
        await step(Math.max(0, live.duel.readingMs - live.duel.elapsedMs) + 35);
        const options = await page.locator('#q-options-grid .opt-text').allTextContents();
        const selected = q.options.find(option => rounds.length === 1 ? option.id !== q.correctOptionId : option.id === q.correctOptionId);
        const index = options.findIndex(option => option.trim() === selected.text.trim());
        assert.ok(index >= 0);
        if (touch) await click('#btn-opt-' + index);
        else await page.keyboard.press('Digit' + (index + 1));
        await page.locator('#feedback-overlay').waitFor({ state: 'visible' });
      }
      for (let i = 0; i < 120 && (await state()).phase !== 'Feedback'; i++) await step(150);
      current = await state();
      assert.equal(current.phase, 'Feedback');
      const status = current.learningReview?.status;
      assert.ok(['correct', 'incorrect', 'unanswered'].includes(status), 'Learning verdict missing');
      assert.ok(['basket','three','dunk','miss','block','clock','steal','fire'].includes(current.commentary));
      if (rounds.length < 2) await photo('feedback-' + rounds.length);
      rounds.push({ status, attacking: human, score: current.score, commentary: current.commentary });
      await click('#btn-next-possession');
      await step(20);
    }
    const end = await state();
    assert.equal(end.phase, 'MatchEnd');
    assert.ok(attacked && defended && rounds.some(round => round.status === 'correct'));
    assert.deepEqual(errors, []);
    assert.deepEqual(roomRequests, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await photo('results');
    report.push({ name, viewport: [width, height], score: end.score, attacking: attacked, defending: defended, stepbackDistance, rounds });
    console.log(JSON.stringify(report.at(-1)));    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
    await page.close();
  }
} finally {
  await browser.close();
}
