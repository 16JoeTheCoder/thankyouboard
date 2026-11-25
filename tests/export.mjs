import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer-core';
import { fixture } from '../scripts/fixture.mjs';

const run = promisify(execFile);
const origin = new URL(process.env.EXPORT_QA_URL ?? 'http://127.0.0.1:8793');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use an isolated local demo for export QA');
const output = resolve(process.env.EXPORT_QA_OUTPUT ?? join(tmpdir(), 'thankyouboard-qa-export'));
const downloads = join(output, 'downloads');
const layouts = ['Botanical', 'Rose Letter', 'Blue Ink', 'Gallery', 'Letterpress'];
const dimensions = { A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148] };
const teacher = 'Ada Chen';
const notes = fixture().notes.filter((note) => note.teacher === teacher);
const mixedNote = notes[0];
const longNote = notes[1];
let boardOrder;
let sparse;
const report = { browser: '', cases: [], checks: [], failures: [] };
const workspace = 'dialog.ks-dialog[open]';
const compact = (value) => value.replace(/\s/gu, '');
const slug = (value) => value.toLowerCase().replace(/ /gu, '-');

async function check(name, action) {
  try {
    await action();
    report.checks.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    report.failures.push({ name, error: String(error.stack ?? error) });
    console.error(`FAIL ${name}\n${error.stack ?? error}`);
  }
}

async function button(container, text) {
  const handle = await container.waitForFunction((root, label) => [...document.querySelectorAll(root + ' button')].find(
    (element) => element.getClientRects().length && (element.getAttribute('aria-label') || element.textContent.trim()) === label,
  ), {}, container.scope, text);
  const element = handle.asElement();
  assert(element, `Button "${text}" should be visible`);
  try {
    assert.equal(await element.evaluate((candidate) => candidate.disabled), false, `Button "${text}" should be enabled`);
    await element.click();
  } finally {
    await handle.dispose();
  }
}

function inScope(page, scope) {
  return { scope, waitForFunction: page.waitForFunction.bind(page) };
}

async function unlock(page) {
  assert.equal((await page.goto(origin.href, { waitUntil: 'domcontentloaded' })).status(), 200);
  await page.locator(`::-p-aria([name="I'm a teacher"][role="link"])`).click();
  await page.waitForSelector('input[type="password"]', { visible: true });
  await page.type('input[type="password"]', 'paper-garden');
  await page.keyboard.press('Enter');
  await button(inScope(page, 'body'), 'Open the wall');
  await page.waitForSelector('.paper-board button[data-slot]');
}

async function openExport(page, individual = false) {
  await page.type('input[aria-label="Find my notes"]', teacher);
  await page.waitForFunction((name) => [...document.querySelectorAll('[role="option"]')].some((option) => option.firstElementChild.textContent === name), {}, teacher);
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open] .reader-list');
  if (individual) {
    const block = await page.waitForFunction((source) => [...document.querySelectorAll('dialog[open] article')].find((article) => article.querySelector('p')?.textContent === source)?.querySelector('button'), {}, mixedNote.text);
    await block.asElement().click();
    await block.dispose();
    await page.waitForSelector('dialog[open] .reader-letter');
  }
  await button(inScope(page, 'dialog[open]'), individual ? 'Save this note' : 'Save my notes');
  await page.waitForSelector(workspace);
  await ready(page);
}

async function ready(page) {
  await page.waitForFunction((root) => {
    const dialog = document.querySelector(root);
    return dialog?.querySelector('.ks-stage .ks-paper') &&
      [...dialog.querySelectorAll('.ks-actions button')].every((control) => !control.disabled);
  }, {}, workspace);
}

async function options(page, layout, size) {
  for (const choice of [layout, size]) {
    const handle = await page.waitForFunction((root, label) => [...document.querySelectorAll(root + ' label')].find(
      (item) => item.querySelector('input[type="radio"]') && item.textContent.trim() === label,
    ), {}, workspace, choice);
    await handle.asElement().click();
    await handle.dispose();
  }
  await ready(page);
}

async function choose(page, expected) {
  await button(inScope(page, workspace), 'Clear');
  for (const note of expected) {
    const index = boardOrder.indexOf(note);
    assert(index >= 0);
    await page.click(`${workspace} .ks-list label:nth-child(${index + 1})`);
  }
  await ready(page);
  assert.deepEqual(await checkedText(page), expected.map((note) => note.text));
}

async function checkedText(page) {
  return page.$$eval(`${workspace} .ks-list input:checked`, (inputs) => inputs.map((input) => input.nextElementSibling.textContent));
}

async function waitForDownload(page, name) {
  const previous = new Set(await readdir(downloads));
  await button(inScope(page, workspace), 'Download PDF');
  for (let attempt = 0; attempt < 300; attempt++) {
    const file = (await readdir(downloads)).find((entry) => entry.endsWith('.pdf') && !previous.has(entry));
    if (file) {
      const target = join(output, `${name}.pdf`);
      await rename(join(downloads, file), target);
      assert.equal((await readFile(target)).subarray(0, 5).toString(), '%PDF-');
      return target;
    }
    await delay(100);
  }
  throw new Error(`PDF download did not complete for ${name}: ${await page.$eval(workspace, (dialog) => dialog.querySelector('[role=alert]')?.textContent ?? '')}`);
}

function pdfPages(raw) {
  return raw.split('\f').map((page) => page.trim()).filter(Boolean);
}

function pageBody(source, number) {
  return source.replace(/^For\r?\nAda Chen\r?\n/u, '').replace(new RegExp(
    '\\n?STJBS Student Council\\s+' + String(number).padStart(2, '0') + '(?=\\s|$)', 'u',
  ), '');
}

async function inspectPdf(file, size, expected, { rendered = true } = {}) {
  // All PDFs come from completed downloads or the Chromium print path, and are synthetic.
  const [{ stdout: info }, { stdout: raw }, { stdout: bbox }, { stdout: fonts }] = await Promise.all([
    run('pdfinfo', ['-f', '1', '-l', '200', '-box', file]),
    run('pdftotext', ['-raw', file, '-']),
    run('pdftotext', ['-bbox', file, '-'], { maxBuffer: 12 * 1024 * 1024 }),
    run('pdffonts', [file]),
  ]);
  const pages = pdfPages(raw);
  const boxes = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/gu)];
  const expectedBody = expected.map((note) => compact(note.text)).join('');
  const extractedBody = pages.map((page, index) => compact(pageBody(page, index + 1))).join('');
  const suffix = file.slice(output.length + 1);
  assert.equal(Number(info.match(/^Pages:\s+(\d+)/mu)?.[1]), pages.length, `${suffix} page count`);
  assert.equal(boxes.length, pages.length, `${suffix} word bounding page count`);
  assert.match(fonts, /\byes\s+(?:no|yes)\s+yes\b/u, `${suffix} uses embedded selectable Unicode fonts`);
  for (const [index, [, width, height, words]] of boxes.entries()) {
    assert(Math.abs(Number(width) - dimensions[size][0] * 72 / 25.4) <= 1, `${suffix} page ${index + 1} width ${width}`);
    assert(Math.abs(Number(height) - dimensions[size][1] * 72 / 25.4) <= 1, `${suffix} page ${index + 1} height ${height}`);
    assert.match(pages[index], /Ada Chen/u, `${suffix} teacher heading on page ${index + 1}`);
    assert.match(pages[index], /STJBS Student Council/u, `${suffix} Student Council signature on page ${index + 1}`);
    assert(compact(pageBody(pages[index], index + 1)), `${suffix} has an empty page ${index + 1}`);
    for (const [, left, top, right, bottom] of words.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">/gu)) {
      assert(Number(left) >= 9 && Number(right) <= Number(width) - 9, `${suffix} page ${index + 1}: x ${left}–${right} exceeds 9 pt clearance`);
      assert(Number(top) >= 5 && Number(bottom) <= Number(height) - 5, `${suffix} page ${index + 1}: y ${top}–${bottom} exceeds 5 pt clearance`);
    }
  }
  await writeFile(file.replace(/\.pdf$/u, '.txt'), raw);
  const raster = file.replace(/\.pdf$/u, '');
  if (rendered) await run('pdftoppm', ['-r', '110', '-f', '1', '-l', '1', '-png', '-singlefile', file, raster]);
  report.cases.push({ artifact: suffix, size, pages: pages.length, notes: expected.length, textMatches: extractedBody === expectedBody });
  if (extractedBody !== expectedBody) {
    const actualCharacters = [...extractedBody];
    const expectedCharacters = [...expectedBody];
    const mismatch = expectedCharacters.findIndex((character, index) => character !== actualCharacters[index]);
    const start = Math.max(0, mismatch - 12);
    throw new Error(`${suffix} exact text mismatch near character ${mismatch}: expected "${expectedCharacters.slice(start, start + 28).join('')}", received "${actualCharacters.slice(start, start + 28).join('')}"`);
  }
  return pages.length;
}

async function previewPages(page, expected) {
  const scope = inScope(page, workspace);
  const counter = `${workspace} .ks-pagination span`;
  const label = await page.$eval(counter, (element) => element.textContent);
  const total = Number(label.match(/^Page 1 of (\d+)$/u)?.[1]);
  assert(total >= 1, `Preview should open on its first page: ${label}`);
  const bodies = [];
  for (let number = 1; number <= total; number++) {
    await page.waitForFunction((selector, value) => document.querySelector(selector).textContent === value, {}, counter, `Page ${number} of ${total}`);
    bodies.push(await page.$$eval(`${workspace} .ks-stage svg > text`, (text) => text.slice(4).map((element) => element.textContent)));
    if (number !== total) await button(scope, 'Next page');
  }
  assert(await page.$eval(`${workspace} [aria-label="Next page"]`, (control) => control.disabled));
  if (total > 1) {
    await button(scope, 'Previous page');
    await page.waitForFunction((selector, value) => document.querySelector(selector).textContent === value, {}, counter, `Page ${total - 1} of ${total}`);
  }
  assert.equal(bodies.flat().join(''), expected.map((note) => note.text.replace(/\r?\n/gu, '')).join(''), 'Live SVG retains the selected source characters and spaces in stable order');
  return bodies;
}

async function printPdf(page, file, preview) {
  await page.evaluate(() => { window.printCalls = 0; window.print = () => { window.printCalls++; }; });
  await button(inScope(page, workspace), 'Print');
  await page.waitForFunction(() => window.printCalls === 1);
  const sheets = await page.$$eval(`${workspace} .ks-print svg`, (pages) => pages.map(
    (paper) => [...paper.querySelectorAll('text')].slice(4).map((line) => line.textContent),
  ));
  assert.deepEqual(sheets, preview, 'Print and preview use the same body lines and page breaks');
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
}

async function adminClient() {
  const session = await fetch(new URL('/api/session', origin));
  assert.equal((await session.json()).demo, true, 'Mutation QA requires the isolated synthetic demo');
  const signIn = await fetch(new URL('/api/demo/admin', origin), { method: 'POST' });
  assert.equal(signIn.status, 200);
  const cookie = signIn.headers.get('set-cookie').split(';')[0];
  return async (path, body) => {
    const response = await fetch(new URL(path, origin), {
      headers: { cookie, ...(body && { 'content-type': 'application/json' }) },
      method: body ? 'POST' : 'GET',
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, 200, `Demo admin ${path}`);
    return response.json();
  };
}

async function noteVisibility(admin, note, visible) {
  const wall = await admin('/api/admin');
  const current = wall.notes.find((entry) => entry.id === note.id);
  assert.equal(current.text, note.text);
  await admin('/api/admin/notes', {
    requestId: crypto.randomUUID(),
    id: current.id,
    expectedRevision: current.revision,
    teacher: current.teacher,
    text: current.text,
    visible,
  });
}

async function runExport(page) {
  const scope = inScope(page, workspace);
  await unlock(page);
  const board = await page.evaluate(async () => (await (await fetch('/api/board')).json()).notes);
  const byId = new Map(notes.map((note) => [note.id, note]));
  boardOrder = board.filter((note) => note.teacher === teacher).sort((a, b) => a.slot - b.slot).map((note) => {
    const synthetic = byId.get(note.id);
    assert.equal(note.text, synthetic?.text, `Board note ${note.id} matches the fixture`);
    return synthetic;
  });
  assert.equal(boardOrder.length, 55);
  sparse = [boardOrder[0], boardOrder[12], boardOrder[37]];
  assert(sparse.includes(mixedNote), 'Sparse selection should exercise mixed-script text');
  await openExport(page, true);
  await check('Individual shortcut selects the mixed-script note and defaults to Gallery/A4', async () => {
    assert.deepEqual(await checkedText(page), [mixedNote.text]);
    assert.deepEqual(await page.$$eval(`${workspace} input[type="radio"]:checked`, (controls) => controls.map((control) => control.closest('label').textContent.trim())), ['Gallery', 'A4']);
    const preview = await previewPages(page, [mixedNote]);
    assert.equal(preview.length, 1);
    const [chinese, english] = mixedNote.text.split('\n');
    assert(preview[0].some((line) => line === chinese), 'Preview ends the Chinese line at the source line break');
    assert.equal(preview[0].slice(preview[0].indexOf(chinese) + 1).join(''), english, 'Preview preserves the separate English source line across physical wraps');
    await page.screenshot({ path: join(output, 'individual-workspace.png') });
    await inspectPdf(await waitForDownload(page, 'individual-gallery-a4'), 'A4', [mixedNote]);
  });
  await check('Browser print preserves the mixed-script note and the one-page preview', async () => {
    const preview = await previewPages(page, [mixedNote]);
    const printed = join(output, 'individual-gallery-a4-print.pdf');
    await printPdf(page, printed, preview);
    assert.equal(await inspectPdf(printed, 'A4', [mixedNote]), 1);
  });
  await button(scope, 'Back to notes');
  await button(inScope(page, 'dialog[open]'), `More for ${teacher}`);
  await button(inScope(page, 'dialog[open]'), 'Save my notes');
  await ready(page);
  await check('Teacher workspace defaults to all 55 and has clear/empty/individual selection states', async () => {
    assert.deepEqual(await checkedText(page), boardOrder.map((note) => note.text));
    await button(scope, 'Clear');
    assert.equal((await checkedText(page)).length, 0);
    assert.match(await page.$eval(`${workspace} .ks-stage`, (stage) => stage.textContent), /Select a note/u);
    assert.equal(await page.$$eval(`${workspace} .ks-actions button:disabled`, (buttons) => buttons.length), 2);
    await button(scope, 'Select all');
    assert.equal((await checkedText(page)).length, 55);
    await choose(page, sparse);
  });
  for (const layout of layouts) {
    for (const size of Object.keys(dimensions)) {
      const name = `sparse-${slug(layout)}-${slug(size)}`;
      await check(`${layout} ${size} sparse PDF preserves selection, dimensions and margins`, async () => {
        await options(page, layout, size);
        assert.deepEqual(await checkedText(page), sparse.map((note) => note.text));
        const preview = await previewPages(page, sparse);
        assert.equal(await inspectPdf(await waitForDownload(page, name), size, sparse), preview.length);
      });
    }
  }
  await check('The long note flows through A6 PDF and browser print with the same pagination', async () => {
    await choose(page, [longNote]);
    await options(page, 'Gallery', 'A6');
    const preview = await previewPages(page, [longNote]);
    assert(preview.length > 1, 'Long A6 note should flow to a continuation page');
    assert(preview.flat().filter((line) => line === '').length >= 13, 'Preview retains the source paragraph breaks');
    await page.screenshot({ path: join(output, 'a6-long-workspace.png') });
    const pdf = await waitForDownload(page, 'long-gallery-a6');
    await run('pdftoppm', ['-r', '110', '-png', pdf, join(output, 'long-a6-pages')]);
    // Keep this validation after printing so a download regression does not hide a print regression.
    const printed = join(output, 'long-gallery-a6-print.pdf');
    await printPdf(page, printed, preview);
    for (const file of [pdf, printed]) assert.equal(await inspectPdf(file, 'A6', [longNote]), preview.length);
  });
  await check('All 55 A6 notes download in stable order with every preview page represented', async () => {
    await button(scope, 'Select all');
    await options(page, 'Blue Ink', 'A6');
    assert.deepEqual(await checkedText(page), boardOrder.map((note) => note.text));
    const preview = await previewPages(page, boardOrder);
    assert(preview.length > 10, 'All 55 selected notes should fill at least 11 A6 pages');
    const pdf = await waitForDownload(page, 'all-55-blue-ink-a6');
    assert.equal(await inspectPdf(pdf, 'A6', boardOrder), preview.length);
  });

  await check('Failed export refresh offers a retry and keeps the selection', async () => {
    await choose(page, [notes[2]]);
    await options(page, 'Gallery', 'A4');
    let failed = false;
    const intercept = async (request) => {
      if (!failed && new URL(request.url()).pathname === '/api/board') {
        failed = true;
        await request.respond({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic QA interruption"}' });
      } else await request.continue();
    };
    await page.setRequestInterception(true);
    page.on('request', intercept);
    try {
      await button(scope, 'Download PDF');
      await page.waitForFunction((selector) => /try again/u.test(document.querySelector(selector + ' [role="alert"]')?.textContent ?? ''), {}, workspace);
      assert(failed, 'The export should have refreshed the board before download');
      assert.deepEqual(await checkedText(page), [notes[2].text]);
      await page.screenshot({ path: join(output, 'export-retry.png') });
      await inspectPdf(await waitForDownload(page, 'retry-gallery-a4'), 'A4', [notes[2]]);
    } finally {
      page.off('request', intercept);
      await page.setRequestInterception(false);
    }
  });

  await check('A note hidden after selection is excluded on the next download and evicted from preview', async () => {
    await choose(page, sparse);
    const admin = await adminClient();
    await noteVisibility(admin, mixedNote, false);
    try {
      const pdf = await waitForDownload(page, 'hidden-excluded-gallery-a4');
      const remaining = sparse.slice(1);
      await page.waitForFunction((selector, text) => ![...document.querySelectorAll(selector + ' .ks-list span')].some((line) => line.textContent === text), {}, workspace, mixedNote.text);
      await ready(page);
      assert.deepEqual(await checkedText(page), remaining.map((note) => note.text));
      assert.equal(await inspectPdf(pdf, 'A4', remaining), (await previewPages(page, remaining)).length);
    } finally {
      await noteVisibility(admin, mixedNote, true);
    }
  });
}

await mkdir(downloads, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  report.browser = await browser.version();
  const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath: downloads } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => { report.failures.push({ name: 'Chromium page error', error: error.message }); });
  try {
    await runExport(page);
  } catch (error) {
    report.failures.push({ name: 'Export QA setup or navigation', error: String(error.stack ?? error) });
    console.error(error);
    await page.screenshot({ path: join(output, 'setup-failure.png') });
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'export-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Export QA evidence: ${output}`);
  if (report.failures.length) process.exitCode = 1;
}
