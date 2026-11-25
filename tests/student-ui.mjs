import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { fixture } from '../scripts/fixture.mjs'

const origin = new URL(process.env.STUDENT_UI_QA_URL ?? 'http://127.0.0.1:8797')
assert(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'Use an isolated loopback demo')
const output = process.env.STUDENT_UI_QA_OUTPUT ?? '/tmp/thankyouboard-qa-student-ui'
const desktop = { width: 1440, height: 1000, deviceScaleFactor: 1 }
const phone = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const tileSelector = '.paper-board button[data-slot]'
const notes = fixture().notes
const teacherNames = [...new Set(notes.map(note => note.teacher))].sort()
const report = { origin: origin.origin, desktop, phone, checks: [], errors: [] }

function pass(message) {
  report.checks.push(message)
  console.log(`PASS ${message}`)
}

async function named(page, name, role = 'button') {
  const control = await page.waitForSelector(`::-p-aria([name=${JSON.stringify(name)}][role=${JSON.stringify(role)}])`, { visible: true, timeout: 6000 })
  assert(control, `Expected a visible ${role} named ${name}`)
  return control
}

async function choose(page, name, { touch = false, role = 'button' } = {}) {
  const element = await named(page, name, role)
  if (touch) await element.tap()
  else await element.click()
  await element.dispose()
}

const photograph = (page, label) => page.screenshot({ path: join(output, `${label}.png`) })

async function open(page, route = '/') {
  const response = await page.goto(new URL(route, origin).href, { waitUntil: 'domcontentloaded' })
  assert([200, 304].includes(response.status()), `Could not open ${route}: ${response.status()}`)
}

async function roleChoice(page, label) {
  await open(page)
  const teacher = await named(page, "I'm a teacher", 'link')
  const student = await named(page, "I'm a student", 'link')
  assert.equal(await page.$('input[type="password"]'), null, 'Passphrase input should follow teacher role choice')
  assert.equal(await page.$(tileSelector), null, 'Role choice must not display protected notes')
  const width = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }))
  assert.equal(width.page, width.viewport, 'Role choices should fit without sideways scrolling')
  await photograph(page, `${label}-role-choice`)
  await Promise.all([teacher.dispose(), student.dispose()])
}

async function unlock(page) {
  await roleChoice(page, 'desktop')
  const teacher = await named(page, "I'm a teacher", 'link')
  await teacher.focus()
  await page.keyboard.press('Enter')
  await teacher.dispose()
  const password = await page.waitForSelector('input[type="password"]', { visible: true, timeout: 4000 })
  await password.type('paper-garden')
  await page.keyboard.press('Enter')
  await choose(page, 'Open the wall')
  await page.waitForSelector(tileSelector, { visible: true, timeout: 6000 })
}

async function request(page, route, body) {
  const response = await page.evaluate(async (path, payload) => {
    const response = await fetch(path, {
      cache: 'no-store',
      ...(payload !== null && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    })
    return { ok: response.ok, status: response.status, data: await response.json() }
  }, route, body ?? null)
  assert(response.ok, `${route} returned ${response.status}: ${response.data.error ?? ''}`)
  return response.data
}

async function submit(page, { label, teacher, text, touch }) {
  const protectedRequests = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/board') protectedRequests.push(request.url())
  })
  await roleChoice(page, label)
  await choose(page, "I'm a student", { touch, role: 'link' })
  const picker = await page.waitForSelector('form select', { visible: true, timeout: 6000 })
  const note = await page.waitForSelector('form textarea', { visible: true, timeout: 6000 })
  await page.waitForFunction(() => !document.querySelector('form select').disabled, { timeout: 6000 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'The student form should not overflow its viewport')
  const options = await picker.evaluate(element => ({ label: [...element.labels].map(label => label.textContent.trim()).join(' '), choices: [...element.options].filter(option => option.value).map(option => ({ label: option.textContent.trim(), value: option.value })) }))
  assert.match(options.label, /^Teacher\b/)
  assert.deepEqual(options.choices.map(option => option.label).sort(), teacherNames)
  assert.match(await note.evaluate(element => [...element.labels].map(label => label.textContent.trim()).join(' ')), /^Your note\b/)
  await picker.select(options.choices.find(option => option.label === teacher).value)
  await note.focus()
  await page.keyboard.sendCharacter(text)
  assert.equal(await note.evaluate(element => element.value), text, 'The form should accept the exact Unicode message and line break')
  await photograph(page, `${label}-student-form`)
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/submit' && response.request().method() === 'POST', { timeout: 8000 }),
    choose(page, 'Send for review', { touch }),
  ])
  assert(response.ok(), `Student submission failed with ${response.status()}`)
  const payload = JSON.parse(await response.request().fetchPostData())
  assert.equal(payload.teacher, teacher)
  assert.equal(payload.text, text)
  assert.match(payload.id, /^[0-9a-f-]{36}$/iu)
  const confirmation = await named(page, 'Your note is in review.', 'heading')
  await confirmation.dispose()
  assert.equal(await page.$('input[type="password"]'), null)
  assert.equal(await page.$(tileSelector), null)
  assert.deepEqual(protectedRequests, [], 'Student role must not request the protected board')
  await photograph(page, `${label}-student-success`)
  return { id: payload.id, publishedId: `student-${payload.id}`, text, teacher }
}

async function councilAction(page, note, action) {
  const handle = await page.waitForFunction((text, label) => [...document.querySelectorAll('button')].find(button => {
    if (button.disabled || !button.getClientRects().length || (button.getAttribute('aria-label') || button.textContent.trim()) !== label) return false
    const row = button.closest('article,tr,li,[data-submission-id],.adm-review-card')
    return row?.textContent.includes(text)
  }), { timeout: 6000 }, note.text, action)
  const button = handle.asElement()
  assert(button, `Missing ${action} control for submitted note`)
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/review' && response.request().method() === 'POST', { timeout: 8000 }),
    button.click(),
  ])
  await button.dispose()
  assert(response.ok(), `${action} student note returned ${response.status()}`)
}

async function folder(page, name) {
  const handle = await page.waitForFunction(label => [...document.querySelectorAll('.review-tabs button')].find(button => button.firstChild.textContent.trim() === label), { timeout: 6000 }, name)
  await handle.asElement().click()
  await handle.dispose()
}

async function selectedTabContrast(page) {
  const tab = await page.$('.review-tabs button[aria-pressed="true"]')
  assert(tab, 'Review should identify the selected folder')
  await tab.hover()
  const contrast = await tab.evaluate(async button => {
    await Promise.all(button.getAnimations().map(animation => animation.finished.catch(() => {})))
    const style = getComputedStyle(button)
    const canvas = document.createElement('canvas')
    const pixel = canvas.getContext('2d')
    function luminance(color) {
      pixel.clearRect(0, 0, 1, 1)
      pixel.fillStyle = color
      pixel.fillRect(0, 0, 1, 1)
      const [red, green, blue] = [...pixel.getImageData(0, 0, 1, 1).data].slice(0, 3).map(byte => {
        const value = byte / 255
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
      })
      return red * .2126 + green * .7152 + blue * .0722
    }
    const values = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a)
    return (values[0] + .05) / (values[1] + .05)
  })
  await tab.dispose()
  assert(contrast >= 4.5, `Hovered selected review tab must meet 4.5:1 text contrast (${contrast.toFixed(2)}:1)`)
  return contrast
}

async function verifyBoard(page, count, label) {
  await page.waitForFunction((selector, total) => document.querySelectorAll(selector).length === total, { timeout: 8000 }, tileSelector, count)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const composition = await page.$$eval(tileSelector, tiles => {
    const wall = document.querySelector('.paper-board').getBoundingClientRect()
    const entries = tiles.map(tile => {
      const rect = tile.getBoundingClientRect()
      return {
        id: tile.dataset.id, slot: Number(tile.dataset.slot),
        letter: [...tile.classList].find(name => /^ink-\d+$/u.test(name)),
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
        fits: rect.x >= wall.x - 1 && rect.y >= wall.y - 1 && rect.right <= wall.right + 1 && rect.bottom <= wall.bottom + 1,
      }
    })
    const canvas = document.querySelector('canvas.printed-wall')
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let ink = 0
    for (let i = 3; i < pixels.length; i += 4 * 97) if (pixels[i]) ink++
    return { entries, ink, fits: document.documentElement.scrollWidth === innerWidth }
  })
  const { entries, ink, fits } = composition
  assert(fits, `${label} wall should fit its viewport`)
  assert(ink > 100, `${label} canvas should show the composition`)
  assert.equal(new Set(entries.map(entry => entry.id)).size, count, 'Each visible note should have a unique button')
  assert.equal(new Set(entries.map(entry => entry.slot)).size, count, 'Each button should retain a unique slot')
  assert(entries.every(entry => entry.fits && entry.width > 0 && entry.height > 0))
  for (const [index, entry] of entries.entries()) {
    assert(!entries.slice(index + 1).some(other => Math.min(entry.right, other.right) - Math.max(entry.left, other.left) > .4 && Math.min(entry.bottom, other.bottom) - Math.max(entry.top, other.top) > .4), `Slot ${entry.slot} must not overlap another hit target`)
  }
  const letterCounts = Object.fromEntries(Array.from({ length: 8 }, (_, n) => [`ink-${n}`, 0]))
  for (const { letter } of entries) letterCounts[letter]++
  assert(Object.values(letterCounts).every(total => total > 0), 'All eight letter silhouettes should have notes')
  report[label] = { total: count, letterCounts, inkSamples: ink }
  await photograph(page, label)
  return new Map(entries.map(({ id, slot }) => [id, slot]))
}

async function boardRefresh(page) {
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/board' && response.status() === 200, { timeout: 8000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  return (await refreshed).json()
}

async function append(council, from, to) {
  for (let count = from; count <= to; count++) {
    await request(council, '/api/admin/notes', {
      requestId: randomUUID(), id: randomUUID(), expectedRevision: 0, visible: true,
      teacher: teacherNames[count % teacherNames.length], text: `Synthetic expansion note ${count}. Thank you for being patient while we worked on the project.`,
    })
  }
}

async function verifyGrownReader(page, board) {
  await page.bringToFront()
  await page.focus(tileSelector)
  await page.keyboard.press('0')
  await page.keyboard.press('=')
  await page.waitForFunction(() => document.querySelector('.board-zoom output')?.textContent === '150%', { timeout: 4000 })
  await page.keyboard.press('End')
  const last = board.notes.at(-1)
  await page.waitForFunction((id) => document.activeElement?.dataset.id === id, { timeout: 4000 }, last.id)
  await page.waitForFunction(() => {
    const wall = document.querySelector('.paper-board').getBoundingClientRect()
    const focus = document.activeElement.getBoundingClientRect()
    return focus.left >= wall.left - 1 && focus.right <= wall.right + 1 && focus.top >= wall.top - 1 && focus.bottom <= wall.bottom + 1
  }, { timeout: 4000 })
  await page.keyboard.press('Enter')
  await page.waitForSelector('dialog[open] .reader-letter p', { visible: true, timeout: 6000 })
  assert.equal(await page.$eval('dialog[open] .reader-letter p', body => body.textContent), last.text)
  await photograph(page, 'desktop-521-expanded-note-reader')
  await page.keyboard.press('Escape')
  await page.waitForFunction((id) => !document.querySelector('dialog[open]') && document.activeElement?.dataset.id === id, { timeout: 4000 }, last.id)
  const clickedTile = await page.$(`${tileSelector}[data-id="${last.id}"]`)
  const box = await clickedTile.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForSelector('dialog[open] .reader-letter p', { visible: true, timeout: 6000 })
  assert.equal(await page.$eval('dialog[open] .reader-letter p', body => body.textContent), last.text)
  pass('On the 521-note wall, keyboard zoom keeps the newly added note in view, Escape restores focus, and a mouse click opens the same exact text')
}

await mkdir(output, { recursive: true })
const probe = await fetch(new URL('/api/session', origin)).then(response => response.json())
assert.equal(probe.demo, true, 'Student UI QA mutates a synthetic demo database')
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

async function pageFor(viewport, role, context) {
  const owner = context ?? await browser.createBrowserContext()
  const page = await owner.newPage()
  page.on('pageerror', error => report.errors.push(`${role}: ${error.message}`))
  await page.setViewport(viewport)
  return [page, owner]
}

try {
  report.browser = await browser.version()
  const [wall, teacherContext] = await pageFor(desktop, 'teacher')
  const [desktopStudent] = await pageFor(desktop, 'desktop student')
  const [phoneStudent] = await pageFor(phone, 'phone student')
  const [council, councilContext] = await pageFor(desktop, 'council')
  await unlock(wall)
  const baseline = await verifyBoard(wall, 500, 'desktop-500-wall')
  const desktopNote = await submit(desktopStudent, { label: 'student-desktop', teacher: teacherNames[0], text: 'Browser QA desktop note. Thank you for your patience. 🌷\n謝謝老師。', touch: false })
  const phoneNote = await submit(phoneStudent, { label: 'student-phone', teacher: teacherNames[1], text: 'Browser QA phone note. Thank you for the extra encouragement. ✨\n謝謝您的幫忙。', touch: true })
  pass('Desktop and 390px touch students can choose their role and submit exact multilingual notes without opening the teacher wall')
  let board = await request(wall, '/api/board')
  assert.equal(board.notes.length, 500)
  assert(!board.notes.some(note => [desktopNote, phoneNote].some(pending => pending.publishedId === note.id || pending.text === note.text)), 'Pending notes must not reach the teacher board')

  await open(council, '/admin')
  await choose(council, 'Enter demo admin')
  await choose(council, 'Review', { role: 'link' })
  await council.waitForFunction(text => document.querySelector('main').textContent.includes(text), { timeout: 6000 }, desktopNote.text)
  await photograph(council, 'council-pending')
  const [phoneCouncil] = await pageFor(phone, 'phone council', councilContext)
  await open(phoneCouncil, '/admin/review')
  await phoneCouncil.waitForFunction(text => document.querySelector('main').textContent.includes(text), { timeout: 6000 }, desktopNote.text)
  assert(await phoneCouncil.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'Mobile review should fit without sideways scrolling')
  const reviewTargets = await phoneCouncil.$$eval('.review-tabs button, .review-letter footer button', buttons => buttons.map(button => button.getBoundingClientRect().height))
  assert(reviewTargets.every(height => height >= 44), `Mobile review controls should be at least 44px tall (${reviewTargets})`)
  await photograph(phoneCouncil, 'phone-council-pending')
  await phoneCouncil.close()
  await councilAction(council, phoneNote, 'Reject')
  await folder(council, 'Trash')
  await council.waitForFunction(text => document.querySelector('main').textContent.includes(text), { timeout: 6000 }, phoneNote.text)
  report.selectedTrashContrast = await selectedTabContrast(council)
  await photograph(council, 'council-trash')
  board = await request(wall, '/api/board')
  assert(!board.notes.some(note => note.id === phoneNote.publishedId || note.text === phoneNote.text), 'Rejected notes must not reach the teacher board')
  await councilAction(council, phoneNote, 'Restore')
  await folder(council, 'Pending')
  await councilAction(council, phoneNote, 'Approve')
  board = await boardRefresh(wall)
  assert.equal(board.notes.length, 501)
  assert.equal(board.notes.find(note => note.id === phoneNote.publishedId)?.text, phoneNote.text)
  pass('Council Review rejects to Trash, restores to Pending and approves a submission above the original 500 slots')

  await append(council, 502, 510)
  await boardRefresh(wall)
  await verifyBoard(wall, 510, 'desktop-510-wall')
  await append(council, 511, 520)
  await councilAction(council, desktopNote, 'Approve')
  board = await boardRefresh(wall)
  const grown = await verifyBoard(wall, 521, 'desktop-521-wall')
  assert.equal(board.notes.find(note => note.id === desktopNote.publishedId)?.text, desktopNote.text)
  for (const [id, slot] of baseline) assert.equal(grown.get(id), slot, 'Growth should preserve existing note slots')
  pass('At 510 and 521 notes, the wall paints all eight letters and gives every published note a unique stable slot')

  const [phoneWall] = await pageFor(phone, 'phone teacher', teacherContext)
  await roleChoice(phoneWall, 'phone-teacher')
  await choose(phoneWall, "I'm a teacher", { touch: true, role: 'link' })
  await verifyBoard(phoneWall, 521, 'phone-521-wall')
  const phoneTile = await phoneWall.$(`${tileSelector}[data-id="${desktopNote.publishedId}"]`)
  assert(phoneTile, 'The newly approved note must have a touch target')
  await phoneTile.tap()
  await phoneWall.waitForSelector('dialog[open] .reader-letter p', { visible: true, timeout: 6000 })
  assert.equal(await phoneWall.$eval('dialog[open] .reader-letter p', body => body.textContent), desktopNote.text)
  await photograph(phoneWall, 'phone-521-note-reader')
  pass('At 390px, the expanded 521-note wall fits and a direct touch opens the exact note')
  await verifyGrownReader(wall, board)
} catch (error) {
  report.errors.push(error.stack ?? error.message)
  console.error(error.stack ?? error.message)
  for (const [index, page] of (await browser.pages()).entries()) {
    if (new URL(page.url()).origin !== origin.origin) continue
    await page.bringToFront()
    await page.screenshot({ path: join(output, `failure-page-${index}.png`), waitForFonts: false }).catch(() => {})
  }
} finally {
  await browser.close()
  await writeFile(join(output, 'student-ui-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Student UI QA evidence: ${output}`)
  if (report.errors.length) process.exitCode = 1
}
