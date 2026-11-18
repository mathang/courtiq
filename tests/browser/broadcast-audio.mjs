import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.COURTIQ_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({
  args: process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  for (const [name, width, height, touch] of [
    ['desktop', 1440, 900, false], ['phone', 390, 844, true],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    await page.addInitScript(() => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.speak = () => { throw Error('Browser speech synthesis was used'); };
      }
    });
    const errors = [];
    const broadcasts = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('courtiq-broadcast.mp3')) broadcasts.push(request.url());
    });
    const step = ms => page.evaluate(ms => window.advanceTime(ms), ms);
    const audio = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).audio);
    const click = selector => touch ? page.locator(selector).tap() : page.locator(selector).click();
    const announcement = voice => page.waitForFunction(voice => {
      const audio = JSON.parse(window.render_game_to_text()).audio;
      return audio.broadcast.ready && audio.broadcast.active === voice;
    }, voice, { timeout: 7000 });

    const response = page.waitForResponse(r => r.url().includes('courtiq-broadcast.mp3') && r.ok());
    await page.goto(baseUrl);
    assert.match((await response).headers()['content-type'], /audio\/mpeg/);
    await page.waitForFunction(() => window.advanceTime && JSON.parse(window.render_game_to_text()).playerModels.every(m => m === 'ready'));
    await step(0);
    await click('#btn-start-solo');
    await step(70);
    await announcement('female');
    assert.match((await audio()).broadcast.last.text, /Light up the court/);
    assert.match(await page.locator('#arcade-commentary').innerText(), /Light up the court/);
    await click('#btn-toggle-mute');
    assert.equal((await audio()).broadcast.active, null);
    assert.equal((await audio()).muted, true);
    await click('#btn-toggle-mute');
    assert.equal((await audio()).broadcast.active, null, 'Unmute must not replay a stale call');

    await step(2500);
    for (let i = 0; i < 4; i++) {
      if (touch) await click('#btn-touch-trick');
      else await page.keyboard.press('KeyK');
      if (i < 3) await step(45);
    }
    await step(405);
    await announcement('male');
    assert.equal((await audio()).broadcast.last.text, 'Back-step lightning!');
    assert.match(await page.locator('#arcade-commentary').innerText(), /Back-step lightning/);
    await click('#btn-open-settings');
    await step(16);
    assert.equal((await audio()).broadcast.active, null);
    assert.equal((await audio()).paused, true);
    await click('#btn-close-settings');
    await step(16);
    assert.equal((await audio()).broadcast.active, null, 'Resume must not replay an interrupted call');
    assert.equal((await audio()).paused, false);
    assert.deepEqual(errors, []);
    assert.deepEqual(broadcasts, [new URL('/assets/audio/courtiq-broadcast.mp3', baseUrl).href]);
    console.log(`${name}: female tip-off, male step-back, captions, mute and pause verified`);
    await page.close();
  }
} finally {
  await browser.close();
}
