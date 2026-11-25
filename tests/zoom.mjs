import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { fixture } from '../scripts/fixture.mjs';

// Zoom and pan checks for the wall, run against the compiled demo on desktop and on a touch phone.
const baseUrl = process.env.ZOOM_QA_URL ?? 'http://127.0.0.1:8788';
const output = process.env.ZOOM_QA_OUTPUT ?? '/tmp/thankyouboard-qa-zoom';
const desktopViewport = { width: 1440, height: 1000, deviceScaleFactor: 1 };
const phoneViewport = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const tiles = '.paper-board button[data-slot]';
const notes = new Map(fixture().notes.map((note) => [note.id, note]));
const report = { steps: [], errors: [], consoleErrors: [] };

function pass(description) {
  report.steps.push(description);
  console.log(`PASS ${description}`);
}

const screenshot = (page, name) => page.screenshot({ path: join(output, `${name}.png`) });
const frame = (page) => page.$eval('.paper-board', (board) => {
  const box = board.getBoundingClientRect();
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
});
const state = (page) => page.evaluate(() => {
  const board = document.querySelector('.paper-board');
  const layer = document.querySelector('.board-pan');
  const box = layer.getBoundingClientRect();
  return {
    zoomed: board.hasAttribute('data-zoomed'),
    transform: layer.style.transform,
    percent: document.querySelector('.board-zoom output').textContent,
    left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width,
  };
});
const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 260)))));
// The Fit button is hidden at 100%, so click it programmatically (a no-op there, like a user who cannot see it).
const fitWall = (page) => page.$eval('.board-zoom button[aria-label="Fit the whole wall"]', (button) => button.click());
const zoomButton = (page, label) => page.$(`.board-zoom button[aria-label="${label}"]`);
const dialogs = (page) => page.evaluate(() => [...document.querySelectorAll('dialog[open]')].length);

async function closeDialog(page) {
  if (await dialogs(page)) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  }
}

async function unlock(page) {
  assert.equal((await page.goto(baseUrl, { waitUntil: 'networkidle0' })).status(), 200);
  await page.locator(`::-p-aria([name="I'm a teacher"])`).click();
  const input = await page.waitForSelector('input[type="password"]', { visible: true });
  await input.type('paper-garden');
  await page.keyboard.press('Enter');
  const open = await page.waitForSelector('.dedication button', { visible: true });
  await open.click();
  await page.waitForSelector(tiles, { visible: true });
  await page.waitForFunction(() => document.querySelectorAll('.paper-board button[data-slot]').length === 500);
}

// The tile the hover layer should pick at a screen point: the first note, in slot order, whose box holds it.
const expectedAt = (page, x, y) => page.evaluate((px, py) => {
  const hit = [...document.querySelectorAll('.paper-board button[data-slot]')].find((tile) => {
    const box = tile.getBoundingClientRect();
    return px >= box.left && px < box.right && py >= box.top && py < box.bottom;
  });
  return hit ? { id: hit.dataset.id, slot: hit.dataset.slot } : null;
}, x, y);

// A point well inside one tile and inside the frame, away from the zoom controls and from overlapping tiles.
const roomyPoint = (page, near) => page.evaluate((target) => {
  const board = document.querySelector('.paper-board').getBoundingClientRect();
  const controls = document.querySelector('.board-zoom').getBoundingClientRect();
  const all = [...document.querySelectorAll('.paper-board button[data-slot]')];
  let best = null;
  for (const tile of all) {
    const box = tile.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    if (x < board.left + 40 || x > board.right - 40 || y < board.top + 40 || y > board.bottom - 40) continue;
    if (x > controls.left - 20 && y > controls.top - 20) continue;
    const owner = all.find((other) => {
      const o = other.getBoundingClientRect();
      return x >= o.left && x < o.right && y >= o.top && y < o.bottom;
    });
    if (owner !== tile) continue;
    const distance = Math.hypot(x - target.x, y - target.y);
    if (!best || distance < best.distance) best = { x, y, distance, id: tile.dataset.id };
  }
  return best;
}, near);

async function assertCovers(page, message) {
  const [box, view] = [await frame(page), await state(page)];
  const slack = 1.5;
  assert(view.left <= box.left + slack && view.top <= box.top + slack && view.right >= box.right - slack && view.bottom >= box.bottom - slack, `${message}: the wall must always cover the frame (${JSON.stringify({ box, view })})`);
}

async function hoverAndRead(page, point) {
  await page.mouse.move(point.x - 3, point.y - 3);
  await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.waitForFunction(() => {
    const peek = document.querySelector('.paper-peek');
    return peek && !peek.hidden;
  }, { timeout: 2000 });
  return page.evaluate(() => {
    const peek = document.querySelector('.paper-peek');
    const box = peek.getBoundingClientRect(), board = document.querySelector('.paper-board').getBoundingClientRect();
    return { teacher: peek.firstElementChild.textContent, text: peek.lastElementChild.textContent, width: box.width, inside: box.left >= board.left - 1 && box.right <= board.right + 1 };
  });
}

// At 100% the controls shrink to one button and must not sit on top of any note.
async function assertFitControls(page) {
  const fit = await page.evaluate(() => {
    const bar = document.querySelector('.board-zoom');
    const shown = [...bar.querySelectorAll('button,output')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getAttribute('aria-label'));
    const box = bar.getBoundingClientRect();
    const covered = [...document.querySelectorAll('.paper-board button[data-slot]')].filter((tile) => {
      const t = tile.getBoundingClientRect();
      const x = t.left + t.width / 2, y = t.top + t.height / 2;
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    }).length;
    return { shown, covered, width: box.width };
  });
  assert.deepEqual(fit.shown, ['Zoom in'], `Only zoom in is shown at 100% (${fit.shown})`);
  assert.equal(fit.covered, 0, `At 100% the control must not cover any note (${fit.covered} covered)`);
  assert(fit.width < 70, `The compact control stays small (${fit.width}px)`);
}

async function checkDesktop(page) {
  await unlock(page);
  let view = await state(page);
  assert.equal(view.zoomed, false);
  assert.equal(view.transform, '', 'The fit view must not leave a transform behind');
  assert.equal(view.percent, '100%');
  await assertFitControls(page);
  const sample = await page.$eval('canvas.printed-wall', (canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 0) inked++;
    return inked;
  });
  assert(sample > 200, 'The printed wall canvas must be painted at fit');
  await screenshot(page, 'desktop-fit');
  pass('Desktop opens at 100% with no transform, a painted canvas and zoom out disabled');

  // Zoom with the buttons.
  await (await zoomButton(page, 'Zoom in')).click();
  await (await zoomButton(page, 'Zoom in')).click();
  await settle(page);
  view = await state(page);
  assert(view.zoomed && view.percent === '225%' && view.transform.includes('scale(2.25'), `Two steps should reach 225% (${JSON.stringify(view)})`);
  await assertCovers(page, 'After zooming in');
  assert.equal(await page.$eval('.paper-board', (board) => getComputedStyle(board).touchAction), 'none', 'Zoomed, a touch drag belongs to the wall');
  await screenshot(page, 'desktop-zoomed-225');
  pass('Zoom in twice reaches 225% and the wall still covers the frame');

  // Hover and click must map to the right note at this zoom.
  const centre = await frame(page);
  const point = await roomyPoint(page, { x: centre.left + centre.width / 2, y: centre.top + centre.height / 2 });
  assert(point, 'Expected a note near the middle of the zoomed wall');
  const expected = await expectedAt(page, point.x, point.y);
  const peek = await hoverAndRead(page, point);
  assert.equal(peek.text, notes.get(expected.id).text.slice(0, 200), 'Hover at 225% must preview the note under the pointer');
  assert(peek.inside, 'The preview card must stay inside the frame');
  assert(peek.width < 260, `The preview card should stay a readable size when zoomed (was ${peek.width}px)`);
  await screenshot(page, 'desktop-zoomed-hover');
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('dialog[open] .reader-letter p');
  assert.equal(await page.$eval('dialog[open] .reader-letter p', (p) => p.textContent), notes.get(expected.id).text, 'Clicking at 225% must open the note under the pointer');
  await closeDialog(page);
  pass('At 225% hover previews and clicks hit the exact note under the pointer');

  // Drag to pan: the wall moves, no note opens, and the next real click still works.
  const before = await state(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 90, point.y - 40, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  const after = await state(page);
  assert(Math.abs(after.left - (before.left - 90)) < 3 && Math.abs(after.top - (before.top - 40)) < 3, `A 90/40px drag should move the wall by the same amount (${before.left},${before.top} -> ${after.left},${after.top})`);
  assert.equal(await dialogs(page), 0, 'Releasing a drag on a note must not open it');
  const again = await roomyPoint(page, { x: point.x, y: point.y });
  const expectedAgain = await expectedAt(page, again.x, again.y);
  await page.mouse.click(again.x, again.y);
  await page.waitForSelector('dialog[open] .reader-letter p');
  assert.equal(await page.$eval('dialog[open] .reader-letter p', (p) => p.textContent), notes.get(expectedAgain.id).text, 'A click right after a drag must open the note');
  await closeDialog(page);
  pass('Dragging pans by the exact distance, opens nothing, and the next click opens the right note');

  // Cannot be dragged off the wall.
  await page.mouse.move(centre.left + 200, centre.top + 200);
  await page.mouse.down();
  await page.mouse.move(centre.left + 3000, centre.top + 3000, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  await assertCovers(page, 'Dragged far down-right');
  await page.mouse.move(centre.left + 900, centre.top + 600);
  await page.mouse.down();
  await page.mouse.move(centre.left - 3000, centre.top - 3000, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  await assertCovers(page, 'Dragged far up-left');
  pass('Dragging far in any direction stops at the edge of the wall');

  // Ctrl + wheel zooms about the cursor.
  await fitWall(page);
  await settle(page);
  assert.equal((await state(page)).transform, '');
  const cursor = { x: centre.left + centre.width * 0.7, y: centre.top + centre.height * 0.4 };
  const under = await page.evaluate(({ x, y }) => {
    const box = document.querySelector('.board-pan').getBoundingClientRect();
    return { u: (x - box.left) / box.width, v: (y - box.top) / box.height };
  }, cursor);
  await page.mouse.move(cursor.x, cursor.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 4; i++) await page.mouse.wheel({ deltaY: -100 });
  await page.keyboard.up('Control');
  await settle(page);
  view = await state(page);
  assert(view.zoomed && parseInt(view.percent, 10) > 250, `Ctrl+wheel should zoom in (${view.percent})`);
  const still = await page.evaluate(({ x, y }) => {
    const box = document.querySelector('.board-pan').getBoundingClientRect();
    return { u: (x - box.left) / box.width, v: (y - box.top) / box.height };
  }, cursor);
  assert(Math.abs(still.u - under.u) < 0.004 && Math.abs(still.v - under.v) < 0.004, `The point under the cursor must stay put (${JSON.stringify(under)} -> ${JSON.stringify(still)})`);
  await assertCovers(page, 'After wheel zoom');
  await page.keyboard.down('Control');
  for (let i = 0; i < 30; i++) await page.mouse.wheel({ deltaY: 100 });
  await page.keyboard.up('Control');
  await settle(page);
  assert.equal((await state(page)).transform, '', 'Wheeling all the way out returns exactly to fit');
  await page.keyboard.down('Control');
  for (let i = 0; i < 60; i++) await page.mouse.wheel({ deltaY: -100 });
  await page.keyboard.up('Control');
  await settle(page);
  assert.equal((await state(page)).percent, '600%', 'Zoom stops at 600%');
  assert.equal(await zoomButton(page, 'Zoom in').then((b) => b.evaluate((e) => e.getAttribute('aria-disabled'))), 'true');
  await screenshot(page, 'desktop-zoomed-600');
  pass('Ctrl+wheel zooms about the cursor, returns exactly to fit and stops at 600%');

  // A plain wheel is left to the browser (page scroll) outside full screen; ctrl + wheel is taken over.
  await fitWall(page);
  await settle(page);
  const intercepted = (ctrlKey) => page.$eval('.paper-board', (board, ctrl) => {
    const event = new WheelEvent('wheel', { deltaY: 120, ctrlKey: ctrl, cancelable: true, bubbles: true });
    board.dispatchEvent(event);
    return event.defaultPrevented;
  }, ctrlKey);
  assert.equal(await intercepted(false), false, 'A plain wheel must be left to the page outside full screen');
  await settle(page);
  assert.equal((await state(page)).transform, '', 'A plain wheel must not zoom outside full screen');
  assert.equal(await intercepted(true), true, 'Ctrl+wheel is taken over by the wall');
  await fitWall(page);
  await settle(page);
  pass('A plain wheel over the wall is left to the page outside full screen');

  // Keyboard: + - 0 and focus following.
  await page.focus(tiles);
  await page.keyboard.press('=');
  await settle(page);
  assert.equal((await state(page)).percent, '150%');
  await page.keyboard.press('-');
  await settle(page);
  assert.equal((await state(page)).percent, '100%');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await settle(page);
  assert.equal((await state(page)).percent, '225%');
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 4 === 3 ? 'ArrowDown' : 'ArrowRight');
    await settle(page);
    const visible = await page.evaluate(() => {
      const focus = document.activeElement.getBoundingClientRect();
      const board = document.querySelector('.paper-board').getBoundingClientRect();
      return focus.left >= board.left - 1 && focus.right <= board.right + 1 && focus.top >= board.top - 1 && focus.bottom <= board.bottom + 1 && document.activeElement.matches('button[data-slot]');
    });
    assert(visible, `Keyboard focus left the screen after ${i + 1} moves`);
  }
  await assertCovers(page, 'After keyboard moves');
  await page.keyboard.press('0');
  await settle(page);
  assert.equal((await state(page)).transform, '', '0 fits the wall');
  await page.keyboard.down('Control');
  await page.keyboard.press('=');
  await page.keyboard.up('Control');
  assert.equal((await state(page)).transform, '', 'Browser shortcuts such as Ctrl+= are left alone');
  pass('Keyboard + − 0 work, and arrow keys keep the focused note on screen');

  // Spotlight still works while zoomed.
  await (await zoomButton(page, 'Zoom in')).click();
  await settle(page);
  const teacher = [...new Set([...notes.values()].map((n) => n.teacher))][2];
  const search = await page.$('.teacher-search input');
  await search.focus();
  await page.keyboard.sendCharacter(teacher);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.paper-board.spotlight .matched');
  assert.equal((await state(page)).zoomed, true, 'Choosing a teacher keeps the zoom (data-zoomed survives React re-renders)');
  await screenshot(page, 'desktop-zoomed-spotlight');
  await page.keyboard.press('Escape');
  pass('Choosing a teacher while zoomed keeps the zoom and lights their notes');
  await fitWall(page);
  await settle(page);

  // Full screen: plain wheel zooms, controls stay reachable.
  const full = await page.$('.board-tools button[aria-pressed]');
  assert(full, 'Full screen button');
  await full.click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('wall-collection'), { timeout: 3000 }).catch(() => {});
  const isFull = await page.evaluate(() => Boolean(document.fullscreenElement));
  if (!isFull) {
    report.steps.push('SKIPPED full screen (this browser build refused the request)');
    console.log('SKIP full screen: the browser did not enter full screen');
  } else {
    await settle(page);
    const fb = await frame(page);
    await page.mouse.move(fb.left + fb.width / 2, fb.top + fb.height / 2);
    await page.mouse.wheel({ deltaY: -100 });
    await page.mouse.wheel({ deltaY: -100 });
    await settle(page);
    view = await state(page);
    assert(view.zoomed, 'A plain wheel zooms in full screen');
    const controls = await page.$eval('.board-zoom', (e) => { const b = e.getBoundingClientRect(); return { right: b.right, bottom: b.bottom, left: b.left, top: b.top }; });
    assert(controls.right <= 1440 && controls.bottom <= 1000 && controls.left >= 0 && controls.top >= 0, 'Zoom controls are on screen in full screen');
    const fp = await roomyPoint(page, { x: fb.left + fb.width / 2, y: fb.top + fb.height / 2 });
    const fe = await expectedAt(page, fp.x, fp.y);
    const fpeek = await hoverAndRead(page, fp);
    assert.equal(fpeek.text, notes.get(fe.id).text.slice(0, 200), 'Hover is exact in full screen');
    await screenshot(page, 'desktop-fullscreen-zoomed');
    await page.mouse.move(fb.left + 300, fb.top + 300);
    await page.mouse.down();
    await page.mouse.move(fb.left + 200, fb.top + 250, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    await assertCovers(page, 'Full screen pan');
    await fitWall(page);
    await settle(page);
    assert.equal((await state(page)).transform, '');
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    pass('Full screen: plain wheel zooms, hover is exact, drag pans, controls are reachable, fit resets');
  }

  // Reduced motion applies the change at once.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await (await zoomButton(page, 'Zoom in')).click();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal((await state(page)).percent, '150%', 'Reduced motion zooms without easing');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  pass('Reduced motion applies a zoom step immediately');
}

async function checkPhone(page) {
  await unlock(page);
  const layout = await page.evaluate(() => {
    const controls = document.querySelector('.board-zoom').getBoundingClientRect();
    const board = document.querySelector('.paper-board').getBoundingClientRect();
    const sign = document.querySelector('.board-sign').getBoundingClientRect();
    return { scrollWidth: document.documentElement.scrollWidth, controls: { left: controls.left, right: controls.right, top: controls.top, bottom: controls.bottom, width: controls.width }, board: { left: board.left, right: board.right, top: board.top, bottom: board.bottom }, sign: { bottom: sign.bottom, left: sign.left, top: sign.top }, touchAction: getComputedStyle(document.querySelector('.paper-board')).touchAction, buttons: [...document.querySelectorAll('.board-zoom button')].map((b) => b.getBoundingClientRect().height).filter(Boolean) };
  });
  assert.equal(layout.scrollWidth, 390, 'No horizontal scrolling at 390px');
  assert(layout.controls.left >= 0 && layout.controls.right <= 390, 'Zoom controls fit on a phone');
  assert(layout.buttons.every((h) => h >= 44), `Touch targets are at least 44px (${layout.buttons})`);
  assert.equal(layout.touchAction, 'pan-y', 'At fit, one finger still scrolls the page');
  await assertFitControls(page);
  await screenshot(page, 'phone-fit');
  pass('Phone: controls fit, targets are 44px and one finger still scrolls at fit');

  await page.touchscreen.tap(...(await page.$eval('.board-zoom button[aria-label="Zoom in"]', (b) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })));
  await page.touchscreen.tap(...(await page.$eval('.board-zoom button[aria-label="Zoom in"]', (b) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })));
  await settle(page);
  let view = await state(page);
  assert(view.zoomed && view.percent === '225%', `Tapping zoom in twice reaches 225% (${view.percent})`);
  await assertCovers(page, 'Phone zoom');
  const pill = await page.evaluate(() => {
    const bar = document.querySelector('.board-zoom').getBoundingClientRect();
    return { left: bar.left, right: bar.right, heights: [...document.querySelectorAll('.board-zoom button')].map((b) => b.getBoundingClientRect().height) };
  });
  assert(pill.left >= 0 && pill.right <= 390, 'The full control fits on a phone');
  assert.equal(pill.heights.length, 3);
  assert(pill.heights.every((h) => h >= 44), `All three controls are 44px touch targets (${pill.heights})`);
  await screenshot(page, 'phone-zoomed-225');
  pass('Phone: two taps on zoom in reach 225%');

  // Tap a note: it must open the exact note.
  const centre = await frame(page);
  const point = await roomyPoint(page, { x: centre.left + centre.width / 2, y: centre.top + centre.height / 2 });
  assert(point, 'A note should be on screen');
  const expected = await expectedAt(page, point.x, point.y);
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForSelector('dialog[open] .reader-letter p');
  assert.equal(await page.$eval('dialog[open] .reader-letter p', (p) => p.textContent), notes.get(expected.id).text, 'Tapping at 225% opens the note under the finger');
  await closeDialog(page);
  pass('Phone: a tap at 225% opens the exact note under the finger');

  // One-finger drag pans and opens nothing.
  const before = await state(page);
  const finger = await page.touchscreen.touchStart(point.x, point.y);
  for (let i = 1; i <= 8; i++) await finger.move(point.x - i * 12, point.y - i * 5);
  await finger.end();
  await settle(page);
  const after = await state(page);
  assert(before.left - after.left > 60 && before.top - after.top > 25, `A one-finger drag should pan the wall (${before.left},${before.top} -> ${after.left},${after.top})`);
  assert.equal(await dialogs(page), 0, 'Ending a touch drag on a note must not open it');
  await assertCovers(page, 'Phone pan');
  pass('Phone: a one-finger drag pans the wall, opens nothing and stays inside the wall');

  // Page still scrolls with a finger on the board? Not while zoomed: it pans instead.
  assert.equal(await page.evaluate(() => scrollY), 0, 'Panning the wall must not scroll the page');

  // Two-finger pinch: zoom out, then in, around the midpoint.
  await fitWall(page);
  await settle(page);
  assert.equal((await state(page)).transform, '');
  const box = await frame(page);
  const cx = box.left + box.width * 0.55, cy = box.top + box.height * 0.5;
  const marker = await page.evaluate(({ x, y }) => {
    const b = document.querySelector('.board-pan').getBoundingClientRect();
    return { u: (x - b.left) / b.width, v: (y - b.top) / b.height };
  }, { x: cx, y: cy });
  const a = await page.touchscreen.touchStart(cx - 20, cy);
  const b = await page.touchscreen.touchStart(cx + 20, cy);
  for (let i = 1; i <= 10; i++) {
    await a.move(cx - 20 - i * 9, cy);
    await b.move(cx + 20 + i * 9, cy);
  }
  await a.end();
  await b.end();
  await settle(page);
  view = await state(page);
  const level = parseInt(view.percent, 10);
  assert(view.zoomed && level > 300 && level < 600, `Spreading two fingers should zoom in (${view.percent})`);
  const kept = await page.evaluate(({ x, y }) => {
    const r = document.querySelector('.board-pan').getBoundingClientRect();
    return { u: (x - r.left) / r.width, v: (y - r.top) / r.height };
  }, { x: cx, y: cy });
  assert(Math.abs(kept.u - marker.u) < 0.02 && Math.abs(kept.v - marker.v) < 0.04, `The wall under the fingers must stay under them (${JSON.stringify(marker)} -> ${JSON.stringify(kept)})`);
  assert.equal(await dialogs(page), 0, 'A pinch must not open a note');
  await assertCovers(page, 'After pinch');
  await screenshot(page, 'phone-pinched');
  const c = await page.touchscreen.touchStart(cx - 80, cy);
  const d = await page.touchscreen.touchStart(cx + 80, cy);
  for (let i = 1; i <= 10; i++) {
    await c.move(cx - 80 + i * 8, cy);
    await d.move(cx + 80 - i * 8, cy);
  }
  await c.end();
  await d.end();
  await settle(page);
  assert(parseInt((await state(page)).percent, 10) < level, 'Pinching in zooms out');
  pass('Phone: pinch zooms around the fingers, pinching in zooms out, nothing opens');

  // Spotlight and teacher flow on a phone while zoomed.
  await zoomButton(page, 'Zoom in').then((b) => b.evaluate((e) => e.click()));
  await settle(page);
  const teacher = [...new Set([...notes.values()].map((n) => n.teacher))][1];
  const search = await page.$('.teacher-search input');
  await search.focus();
  await page.keyboard.sendCharacter(teacher);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.paper-board.spotlight .matched');
  assert.equal((await state(page)).zoomed, true);
  const bar = await page.evaluate(() => {
    const spot = document.querySelector('.spot-bar').getBoundingClientRect();
    return { right: spot.right, scrollWidth: document.documentElement.scrollWidth };
  });
  assert(bar.right <= 390 && bar.scrollWidth === 390, 'Spotlight bar still fits on a phone');
  await screenshot(page, 'phone-zoomed-spotlight');
  pass('Phone: choosing a teacher while zoomed keeps the zoom and the page fits');
}

await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function run(name, viewport, fn) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push({ name, error: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push({ name, text: message.text() });
  });
  await page.setViewport(viewport);
  try {
    await fn(page);
  } catch (error) {
    console.error(`FAIL ${name}\n${error.stack}`);
    report.errors.push({ name, error: error.stack });
    await screenshot(page, `${name}-failure`).catch(() => {});
  } finally {
    await context.close();
  }
}

try {
  report.browser = await browser.version();
  await run('desktop', desktopViewport, checkDesktop);
  await run('phone', phoneViewport, checkPhone);
  if (report.consoleErrors.length) report.errors.push({ name: 'console', error: JSON.stringify(report.consoleErrors) });
} finally {
  await browser.close();
  await writeFile(join(output, 'zoom-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Zoom QA evidence: ${output}`);
  if (report.errors.length) process.exitCode = 1;
}
