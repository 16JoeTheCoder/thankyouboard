import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { fixture } from '../scripts/fixture.mjs';

const baseUrl = process.env.BOARD_QA_URL ?? 'http://127.0.0.1:8788';
const output = process.env.BOARD_QA_OUTPUT ?? '/tmp/thankyouboard-qa-board';
const desktopViewport = { width: 1440, height: 1000, deviceScaleFactor: 1 };
const phoneViewport = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const cards = '.paper-board button[data-slot]';
const themes = ['Original', 'After Hours', 'Blue Hour', 'Garden'];
const syntheticNotes = new Map(fixture().notes.map((note) => [note.id, note]));
const report = { steps: [], errors: [] };

function getSyntheticTeachers() {
  const counts = new Map();
  for (const note of syntheticNotes.values()) counts.set(note.teacher, (counts.get(note.teacher) ?? 0) + 1);
  return [...counts.entries()].slice(0, 3).map(([name, count]) => ({ name, count }));
}

function pass(description) {
  report.steps.push(description);
  console.log(`PASS ${description}`);
}

async function control(page, regex, selector = 'button,[role="button"],a[href]') {
  const handle = await page.waitForFunction((pattern, flags, query) => {
    const expression = new RegExp(pattern, flags);
    return Array.from(document.querySelectorAll(query)).find((element) => {
      const labelledBy = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/u).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
      const name = element.getAttribute('aria-label') || labelledBy || [...(element.labels ?? [])].map((label) => label.textContent).join(' ') || element.textContent || element.placeholder || '';
      return expression.test(name.replace(/\s+/gu, ' ').trim()) && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible' && !element.closest('[inert],[aria-hidden="true"]');
    });
  }, { timeout: 4000 }, regex.source, regex.flags, selector);
  const element = handle.asElement();
  assert(element, `Expected a control matching ${regex}`);
  return element;
}

async function clickControl(page, name, selector) {
  const button = await control(page, name, selector);
  await button.click();
  await button.dispose();
}

async function modifiedKey(page, modifier, key) {
  await page.keyboard.down(modifier);
  try {
    await page.keyboard.press(key);
  } finally {
    await page.keyboard.up(modifier);
  }
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(output, `${name}.png`) });
}

async function mark(page, label) {
  await page.evaluate((name) => performance.mark(`board-qa-${name}`), label);
}

async function visibleDialogs(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('dialog[open],[role="dialog"]')).filter((dialog) => dialog.getClientRects().length && !dialog.closest('[aria-hidden="true"]')).length);
}

async function waitForDialog(page, heading) {
  await page.waitForFunction((title) => [...document.querySelectorAll('dialog[open],[role="dialog"]')].some((dialog) => {
    return dialog.getClientRects().length && !dialog.closest('[aria-hidden="true"]') && [...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')].some((element) => element.textContent.trim().includes(title));
  }), { timeout: 4500 }, heading);
}

async function closeDialog(page) {
  if (await visibleDialogs(page)) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => ![...document.querySelectorAll('dialog[open],[role="dialog"]')].some((dialog) => dialog.getClientRects().length && !dialog.closest('[aria-hidden="true"]')));
  }
}

async function waitForWall(page) {
  await control(page, /^Surprise me$/i);
}

async function unlock(page, { invalid = false } = {}) {
  assert.equal((await page.goto(baseUrl, { waitUntil: 'networkidle0' })).status(), 200);
  await clickControl(page, /^I'm a teacher$/i);
  const input = await page.waitForSelector('input[type="password"]', { visible: true });
  assert(input, 'Teacher gate should request a passphrase');
  if (invalid) {
    await input.type('a synthetic incorrect passphrase');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /incorrect|try again|did not match|check the passphrase/i.test(document.body.innerText));
    assert(await page.$('input[type="password"]'), 'Incorrect passphrase unexpectedly bypassed the gate');
    await input.focus();
    await modifiedKey(page, 'Control', 'a');
  }
  await input.type('paper-garden');
  await page.keyboard.press('Enter');
}

async function enterWall(page, { firstRun = true } = {}) {
  if (firstRun) {
    const action = await control(page, /^Open the wall$/i);
    await screenshot(page, 'dedication');
    await action.click();
    await action.dispose();
  }
  await waitForWall(page);
}

async function searchInput(page) {
  return control(page, /find my notes|teacher name|search teachers/i, 'input:not([type="password"])');
}

async function searchForTeacher(page, teacher) {
  const input = await searchInput(page);
  await input.focus();
  await input.evaluate((element) => element.select());
  await page.keyboard.sendCharacter(teacher);
  await input.dispose();
  const buttonName = new RegExp(teacher.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu');
  return control(page, buttonName, '.teacher-search [role="option"]');
}

// Choosing a teacher dims the wall and lights her notes; the reader opens only from this button.
async function viewMyNotes(page, name) {
  await page.waitForFunction(() => document.querySelector('.paper-board.spotlight') && document.querySelector('.spot-bar'));
  assert.equal(await visibleDialogs(page), 0, 'Choosing a teacher must not open the reader by itself');
  assert((await page.$eval('.spot-bar', (bar) => bar.textContent)).includes(name), 'The spotlight bar should name the selected teacher');
  const button = await control(page, /^View my notes$/i, '.spot-bar button');
  await button.click();
  await button.dispose();
  await waitForDialog(page, name);
}

async function tracePerformance(page, points, rapidTeacherSelections) {
  const session = await page.createCDPSession();
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.$eval('.paper-board', (board) => {
    window.qaPointerHits = new Map();
    const plane = board.querySelector('.paper-hit-plane');
    const target = plane ?? board;
    target.addEventListener(plane ? 'pointermove' : 'pointerover', (event) => {
      const slot = event.target.dataset.slot;
      if (slot) window.qaPointerHits.set(`${event.clientX},${event.clientY}`, slot);
    }, { passive: true, capture: !plane });
  });
  const tracePath = join(output, 'board-4x.trace.json');
  await page.tracing.start({
    path: tracePath,
    categories: ['blink.user_timing', 'devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'toplevel'],
  });
  try {
    await page.mouse.move(2, 2);
    await delay(250);
    const idleAnimations = await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length);
    await mark(page, 'idle-start');
    await delay(1100);
    await mark(page, 'idle-end');

    await mark(page, 'hover-start');
    for (const point of points) {
      await page.mouse.move(point.x, point.y);
      await delay(15);
    }
    await mark(page, 'hover-end');
    const pointerHits = new Map(await page.evaluate(() => [...window.qaPointerHits]));
    await page.mouse.move(2, 2);

    const dwellResults = [];
    await mark(page, 'dwell-start');
    for (let i = 1; i <= 6; i++) {
      const point = points[Math.floor(points.length * i / 7)];
      await page.mouse.move(point.x, point.y);
      await delay(300);
      const preview = await page.$eval('.paper-peek', (element) => element.hidden ? null : { teacher: element.firstElementChild.textContent, excerpt: element.lastElementChild.textContent });
      const note = syntheticNotes.get(point.id);
      const correct = Boolean(preview && note && preview.teacher === note.teacher && preview.excerpt.length > 20 && note.text.startsWith(preview.excerpt));
      dwellResults.push({ slot: point.slot, correct });
    }
    await mark(page, 'dwell-end');
    await page.mouse.move(2, 2);

    await mark(page, 'teachers-start');
    let rapidSelectionError;
    let rapidSelections;
    try {
      rapidSelections = await rapidTeacherSelections();
    } catch (error) {
      rapidSelectionError = error;
    }
    await mark(page, 'teachers-end');
    return { tracePath, idleAnimations, pointerHits, dwellResults, rapidSelections, rapidSelectionError };
  } finally {
    await page.tracing.stop();
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await session.detach();
  }
}

async function summarizeTrace(tracePath) {
  const { traceEvents } = JSON.parse(await readFile(tracePath, 'utf8'));
  const frameNames = new Set(['BeginFrame', 'DrawFrame', 'DroppedFrame', 'Scheduler::BeginFrameDropped']);
  const summary = {};
  for (const segment of ['idle', 'hover', 'dwell', 'teachers']) {
    const start = traceEvents.find((event) => event.name === `board-qa-${segment}-start`);
    const end = traceEvents.find((event) => event.name === `board-qa-${segment}-end`);
    assert(start && end, `Missing performance marks in the ${segment} segment`);
    const frames = {};
    const drawnAt = [];
    const longTasks = [];
    let animationCallbacks = 0;
    for (const event of traceEvents) {
      if (event.ts < start.ts || event.ts > end.ts || event.pid !== start.pid) continue;
      if (frameNames.has(event.name) && event.ph === 'I') frames[event.name] = (frames[event.name] ?? 0) + 1;
      if (event.name === 'DrawFrame' && event.ph === 'I') drawnAt.push(event.ts);
      if (event.tid !== start.tid) continue;
      if (event.name === 'FireAnimationFrame') animationCallbacks++;
      if (['RunTask', 'ThreadControllerImpl::RunTask'].includes(event.name) && event.ph === 'X' && event.dur > 50000) {
        const activity = traceEvents.filter((child) => child.tid === start.tid && child.pid === start.pid && child.ts >= event.ts && child.ts < event.ts + event.dur && child.ph === 'X' && child.name !== event.name).sort((a, b) => b.dur - a.dur).slice(0, 4).map((child) => ({ name: child.name, ms: child.dur / 1000 }));
        longTasks.push({ elapsedMs: (event.ts - start.ts) / 1000, durationMs: event.dur / 1000, threadMs: event.tdur === undefined ? null : event.tdur / 1000, activity });
      }
    }
    const durationMs = (end.ts - start.ts) / 1000;
    drawnAt.sort((a, b) => a - b);
    const drawIntervals = drawnAt.slice(1).map((timestamp, index) => (timestamp - drawnAt[index]) / 1000).sort((a, b) => a - b);
    const p95DrawIntervalMs = drawIntervals.length ? drawIntervals[Math.ceil(drawIntervals.length * .95) - 1] : null;
    const maxDrawIntervalMs = drawIntervals.at(-1) ?? null;
    summary[segment] = { durationMs, frames, drawnFramesPerSecond: drawnAt.length / durationMs * 1000, p95DrawIntervalMs, maxDrawIntervalMs, animationCallbacks, longTasks };
  }
  return summary;
}

async function setTheme(page, theme) {
  const selected = await page.evaluate(() => document.querySelector('.wall-app')?.dataset.theme);
  if (selected === theme) return;
  const nativePicker = await page.$('select');
  if (nativePicker) {
    const value = await nativePicker.evaluate((select, label) => [...select.options].find((option) => option.textContent.trim() === label)?.value, theme);
    if (value !== undefined) await nativePicker.select(value);
  }
  if ((await page.evaluate(() => document.querySelector('.wall-app')?.dataset.theme)) !== theme) {
    const picker = await control(page, /theme|appearance|original|after hours|blue hour|garden/i);
    await picker.click();
    await picker.dispose();
    const themeName = new RegExp(`^${theme}$`, 'i');
    await clickControl(page, themeName, 'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"]');
  }
  await page.waitForFunction((label) => document.querySelector('.wall-app')?.dataset.theme === label, {}, theme);
}

async function checkThemes(page) {
  const fingerprints = [];
  for (const theme of themes) {
    await setTheme(page, theme);
    fingerprints.push(await page.evaluate((query) => [
      ...document.querySelectorAll('.wall-app,.paper-board'),
      ...[...document.querySelectorAll(query)].slice(0, 12),
    ].map((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor, style.backgroundImage, style.borderColor].join('|');
    }).join('\n'), cards));
    await screenshot(page, `desktop-${theme.toLowerCase().replace(/\s/gu, '-')}`);
  }
  assert.equal(new Set(fingerprints).size, 4, 'Each theme should present distinct computed colors');
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForWall(page);
  assert.equal(await page.$eval('.wall-app', (wall) => wall.dataset.theme), 'Garden', 'Reload should preserve the chosen theme');
  await setTheme(page, 'Original');
  pass('Original, After Hours, Blue Hour and Garden show distinct colors and the selected theme survives reload');
}

async function getBoardPoints(page) {
  await page.waitForSelector(cards, { visible: true });
  const points = await page.$$eval(cards, (elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    const index = [...element.classList].find((name) => /^ink-\d+$/u.test(name));
    const coordinates = [[.5, .5], [.4, .4], [.6, .4], [.4, .6], [.65, .65], [.25, .5], [.75, .5], [.5, .25], [.5, .75]];
    for (const [ratioX, ratioY] of coordinates) {
      const x = Math.round(bounds.left + bounds.width * ratioX);
      const y = Math.round(bounds.top + bounds.height * ratioY);
      const hit = document.elementFromPoint(x, y);
      if (hit?.closest('button[data-slot]') === element || hit?.classList.contains('paper-hit-plane')) return { slot: element.dataset.slot, id: element.dataset.id, index, x, y };
    }
    return { slot: element.dataset.slot, occluded: true };
  }));
  assert.equal(points.length, 500, 'Expected 500 addressable note cards in the full demo');
  assert.equal(new Set(points.map(({ slot }) => slot)).size, 500, 'Each note should have its own stable slot');
  const missing = points.filter((point) => point.occluded);
  assert.equal(missing.length, 0, `Tiles outside or occluded in the desktop viewport: ${missing.map(({ slot }) => slot).join(', ')}`);
  return points.sort((a, b) => Math.floor(a.y / 18) - Math.floor(b.y / 18) || (Math.floor(a.y / 18) % 2 ? b.x - a.x : a.x - b.x));
}

async function checkDesktop(page, teachers) {
  await unlock(page, { invalid: true });
  await enterWall(page);
  await page.waitForSelector(cards, { visible: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await waitForWall(page);
  assert(!(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Open the wall' && button.getClientRects().length))), 'Dedication unexpectedly reopened after reload');
  await clickControl(page, /^Replay dedication$/i);
  await enterWall(page);
  pass('Invalid passphrase rejected, valid passphrase unlocks, dedication appears once and can be replayed');

  await checkThemes(page);

  const spotlight = await searchForTeacher(page, teachers[0].name);
  await spotlight.click();
  await spotlight.dispose();
  await page.waitForFunction(() => document.querySelectorAll('.paper-board .matched').length > 0);
  const spotlightState = await page.evaluate(() => ({ matched: document.querySelectorAll('.paper-board .matched').length, travelling: document.querySelectorAll('.paper-board .spot-lift').length }));
  assert.equal(spotlightState.matched, teachers[0].count, 'Spotlight should highlight every visible note for the selected teacher');
  assert(spotlightState.travelling <= 4, 'Only a capped subset of matching note cards can travel');
  await viewMyNotes(page, teachers[0].name);
  await screenshot(page, 'desktop-teacher-spotlight');
  await closeDialog(page);
  pass(`Teacher spotlight reaches the ${teachers[0].count}-note reader with ${spotlightState.travelling} travelling cards`);

  const tile = await page.$(`${cards}[tabindex="0"]`);
  assert(tile, 'The board should have a keyboard entry point');
  await tile.focus();
  await page.waitForSelector('.paper-peek', { visible: true });
  assert(await tile.evaluate((element) => element === document.activeElement), 'Paper preview should leave focus on its tile');
  const firstSlot = await tile.evaluate((element) => element.dataset.slot);
  await page.keyboard.press('ArrowRight');
  const nextSlot = await page.evaluate(() => document.activeElement.dataset.slot);
  assert(nextSlot && nextSlot !== firstSlot, 'ArrowRight should move keyboard focus to another note');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open] .reader-letter', { visible: true });
  await closeDialog(page);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.slot), nextSlot, 'Escape should restore focus to the opened tile');
  await page.keyboard.press('Escape');
  pass('Board keyboard entry, arrow navigation and a focus-preserving preview reach an individual note');

  const browse = await control(page, /^(browse )?all notes$/i);
  await browse.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Boolean(document.querySelector('dialog[open],[role="dialog"]')));
  assert(await page.evaluate(() => Boolean(document.activeElement.closest('dialog[open],[role="dialog"]'))), 'Keyboard opening should focus the reader');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => Boolean(document.activeElement.closest('dialog[open],[role="dialog"]'))), 'The modal should keep forward keyboard navigation inside');
  await modifiedKey(page, 'Shift', 'Tab');
  assert(await page.evaluate(() => Boolean(document.activeElement.closest('dialog[open],[role="dialog"]'))), 'The modal should keep backwards keyboard navigation inside');
  await modifiedKey(page, 'Shift', 'Tab');
  assert(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement.closest('dialog[open],[role="dialog"]'))), 'The modal must prevent navigation to controls on the background wall');
  await closeDialog(page);
  assert(await browse.evaluate((element) => document.activeElement === element), 'Closing the reader should restore focus to the invoking control');
  await browse.dispose();
  pass('Browse all notes works by keyboard, keeps focus in the modal and restores focus on Escape');

  await clickControl(page, /^Surprise me$/i);
  await page.waitForFunction(() => Boolean(document.querySelector('dialog[open],[role="dialog"]')));
  await closeDialog(page);
  pass('Surprise me opens a reader and Escape returns to the board');

  const points = await getBoardPoints(page);
  const first = points[0];
  const adjacent = points.slice(1).reduce((closest, candidate) => Math.hypot(candidate.x - first.x, candidate.y - first.y) < Math.hypot(closest.x - first.x, closest.y - first.y) ? candidate : closest);
  const focusBefore = await page.evaluateHandle(() => document.activeElement);
  await page.mouse.move(first.x, first.y);
  const preview = await page.waitForSelector('.paper-peek', { visible: true });
  assert(await preview.evaluate((element) => element.innerText.trim().length > 20 && getComputedStyle(element).pointerEvents === 'none'), 'Hovered note should reveal a readable non-interactive preview');
  await page.mouse.move(adjacent.x, adjacent.y);
  const adjacentTarget = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return hit?.closest('button[data-slot],.paper-hit-plane')?.dataset.slot;
  }, adjacent);
  assert.equal(adjacentTarget, adjacent.slot, 'A visible preview must not intercept a neighboring tile');
  assert(await focusBefore.evaluate((element) => document.activeElement === element), 'Desktop hover must not move focus');
  await focusBefore.dispose();
  await delay(190);
  await screenshot(page, 'desktop-hover-preview');
  await page.mouse.move(2, 2);
  await page.waitForSelector('.paper-peek', { hidden: true });
  pass('Desktop hover reveals a readable preview while preserving focus and adjacent pointer targets');

  const letters = new Map();
  for (const point of points) if (!letters.has(point.index)) letters.set(point.index, point);
  assert.equal(letters.size, 8, 'All eight letters should have addressable note tiles');
  for (const point of letters.values()) {
    const note = syntheticNotes.get(point.id);
    assert(note, `Missing synthetic note for slot ${point.slot}`);
    await page.mouse.click(point.x, point.y);
    await waitForDialog(page, note.teacher);
    assert.equal(await page.$eval('dialog[open] .reader-letter p', (body) => body.textContent), note.text, `Letter ${point.index} opened a different note than the clicked slot`);
    await closeDialog(page);
  }
  pass('Eight physical mouse clicks open the exact expected synthetic notes from all eight letters');
}

async function checkPhone(page, teacher) {
  await unlock(page);
  await enterWall(page);
  const input = await searchInput(page);
  const searchBounds = await input.boundingBox();
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, touch: navigator.maxTouchPoints }));
  assert.equal(layout.width, 390);
  assert.equal(layout.scrollWidth, 390, 'Phone layout must fit without horizontal scrolling');
  assert(layout.touch > 0, 'Mobile emulation must expose touch input');
  assert(searchBounds.y >= 0 && searchBounds.y + searchBounds.height <= layout.height, 'Teacher search must be visible before scrolling the mobile board');
  await input.dispose();
  await screenshot(page, 'phone-wall');
  await page.waitForSelector(cards, { visible: true });
  const tile = await page.$(cards);
  const label = await tile.evaluate((element) => element.getAttribute('aria-label') ?? '');
  assert(label.trim(), 'A paper tile must have an accessible name');
  const bounds = await tile.boundingBox();
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.waitForFunction(() => Boolean(document.querySelector('dialog[open],[role="dialog"]')));
  await screenshot(page, 'phone-note-reader');
  await closeDialog(page);
  pass('At a 390px touch viewport teacher search is visible, the page fits, and one real tile tap opens the reader');

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const match = await searchForTeacher(page, teacher.name);
  await match.click();
  await match.dispose();
  await viewMyNotes(page, teacher.name);
  const motion = await page.evaluate(() => ({ pref: matchMedia('(prefers-reduced-motion: reduce)').matches, travelling: [...document.querySelectorAll('.paper-board .spot-lift')].filter((element) => element.getAnimations().some((animation) => animation.playState === 'running')).length }));
  assert(motion.pref && motion.travelling === 0, 'Reduced motion must preserve content without animated travelling cards');
  await screenshot(page, 'phone-teacher-reduced-motion');
  pass('Reduced motion preserves the teacher reader without animated spotlight travel');
}

async function rapidSelections(page, teachers) {
  const input = await searchInput(page);
  await input.focus();
  await input.evaluate((element) => element.select());
  await input.dispose();
  await page.evaluate((names) => {
    window.qaReaderTitles = [];
    window.qaSpotlights = [];
    window.qaReaders = new MutationObserver(() => {
      const title = document.querySelector('dialog[open] h2')?.textContent.trim();
      if (title && title !== window.qaReaderTitles.at(-1)) window.qaReaderTitles.push(title);
      const spotlight = document.querySelector('.paper-board .matched')?.getAttribute('aria-label')?.replace('Read note for ', '');
      if (spotlight && spotlight !== window.qaSpotlights.at(-1)) window.qaSpotlights.push(spotlight);
    });
    window.qaReaders.observe(document.querySelector('.wall-app'), { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    for (const name of names) {
      const tile = [...document.querySelectorAll('.paper-board button[data-slot]')].find((item) => item.getAttribute('aria-label') === `Read note for ${name}`);
      if (tile) window.qaReaders.observe(tile, { attributes: true, attributeFilter: ['class'] });
    }
  }, teachers.map(({ name }) => name));
  const intervals = [];
  let previous;
  for (const teacher of teachers) {
    await page.keyboard.sendCharacter(teacher.name);
    await page.keyboard.press('Enter');
    const current = performance.now();
    if (previous !== undefined) intervals.push(current - previous);
    previous = current;
  }
  const finalTitle = teachers.at(-1).name;
  await viewMyNotes(page, finalTitle);
  const { titles, spotlights } = await page.evaluate(() => {
    window.qaReaders.disconnect();
    return { titles: window.qaReaderTitles, spotlights: window.qaSpotlights };
  });
  assert.deepEqual(titles, [finalTitle], 'Earlier pending teacher selections must not open a stale reader');
  assert.deepEqual(spotlights, teachers.map(({ name }) => name), 'Every rapid keyboard selection must reach the spotlight state');
  await closeDialog(page);
  return { selections: teachers.length, intervalsMs: intervals, finalTitle };
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
  await page.setViewport(viewport);
  try {
    await fn(page);
  } catch (error) {
    console.error(`FAIL ${name}\n${error.stack}`);
    report.errors.push({ name, error: error.stack });
    await screenshot(page, `${name}-failure`);
  } finally {
    await context.close();
  }
}

try {
  const syntheticTeachers = getSyntheticTeachers();
  report.browser = await browser.version();
  report.desktop = desktopViewport;
  report.phone = phoneViewport;

  await run('desktop', desktopViewport, (page) => checkDesktop(page, syntheticTeachers));
  await run('phone', phoneViewport, (page) => checkPhone(page, syntheticTeachers[0]));
  await run('performance', desktopViewport, async (page) => {
    await unlock(page);
    await enterWall(page);
    const points = await getBoardPoints(page);
    const traced = await tracePerformance(page, points, async () => [
      await rapidSelections(page, syntheticTeachers),
      await rapidSelections(page, [...syntheticTeachers].reverse()),
    ]);
    const { tracePath, idleAnimations, pointerHits, dwellResults, rapidSelectionError, rapidSelections: selections } = traced;
    const missed = points.filter(({ slot, x, y }) => pointerHits.get(`${x},${y}`) !== slot);
    report.performance = { tracePath, points: points.length, hitSlots: points.length - missed.length, idleAnimations, dwellResults, rapidSelections: selections, segments: await summarizeTrace(tracePath) };
    const traceSummary = Object.fromEntries(Object.entries(report.performance.segments).map(([name, segment]) => [name, { ...segment, longTasks: segment.longTasks.length }]));
    console.log(JSON.stringify(traceSummary, null, 2));
    assert.equal(idleAnimations, 0, 'Idle board should have no running animations');
    assert.equal(report.performance.segments.idle.animationCallbacks, 0, 'Idle board should not request continuous animation frames');
    assert.equal(missed.length, 0, `Sweep missed ${missed.length} slots starting with ${missed.slice(0, 12).map(({ slot }) => slot).join(', ')}`);
    assert(dwellResults.every(({ correct }) => correct), 'Dwelling on a card should produce the expected teacher and excerpt');
    assert((report.performance.segments.dwell.frames.DrawFrame ?? 0) > 0, 'The trace should include compositor-drawn frames from hover previews');
    const hoverTasks = [...report.performance.segments.hover.longTasks, ...report.performance.segments.dwell.longTasks];
    assert.equal(hoverTasks.length, 0, 'The renderer main thread should have no >50ms tasks during sweeping or held hovers');
    if (rapidSelectionError) throw rapidSelectionError;
    pass('4× CPU sweep traces all 500 notes and rapid teacher changes with no >50 ms hover tasks or idle animation');
  });
} finally {
  await browser.close();
  await writeFile(join(output, 'board-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Board QA evidence: ${output}`);
  if (report.errors.length) process.exitCode = 1;
}
