import assert from 'node:assert/strict'
import { access, mkdir, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { fixture } from '../scripts/fixture.mjs'

const origin = new URL(process.env.ADMIN_QA_URL ?? 'http://127.0.0.1:8792')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'Use an isolated local demo URL for the mutating admin QA pass')
const artifacts = resolve(process.env.ADMIN_QA_ARTIFACTS ?? '.qa/admin')
const chromium = process.env.CHROME_PATH ?? '/usr/bin/chromium'

class Client {
  cookie = ''

  constructor(headers = {}) {
    this.headers = headers
  }

  async request(path, { method = 'GET', body, headers, status } = {}) {
    const response = await fetch(new URL(path, origin), {
      method,
      redirect: 'manual',
      headers: {
        ...this.headers,
        ...(this.cookie && { cookie: this.cookie }),
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';', 1)[0]
    const text = await response.text()
    const data = response.headers.get('content-type')?.includes('application/json') && text
      ? JSON.parse(text)
      : text
    if (status !== undefined) assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 300)}`)
    return { response, data, setCookie, status: response.status }
  }
}

async function check(label, action) {
  await action()
  console.log(`PASS ${label}`)
}

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => {
    const file = resolve(path, entry.name)
    return entry.isDirectory() ? walk(file) : file
  }))
  return nested.flat()
}

async function filesContainNone(path, needles) {
  await access(path)
  for (const file of await walk(path)) {
    const bytes = await readFile(file)
    for (const [label, value] of needles) {
      assert.ok(value.length >= 8, `Use a distinctive marker for ${label}`)
      assert.ok(!bytes.includes(value), `${label} appears in ${file}`)
    }
  }
}

async function browserCheck(action) {
  const browser = await puppeteer.launch({
    executablePath: chromium,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    await mkdir(artifacts, { recursive: true })
    await action(browser)
  } finally {
    await browser.close()
  }
}

async function clickText(page, selector, label) {
  const handle = await page.waitForFunction((selector, label) => [...document.querySelectorAll(selector)].find(
    element => element.getClientRects().length && element.textContent.trim() === label,
  ), {}, selector, label)
  const element = handle.asElement()
  assert.ok(element, `No visible ${selector} matching ${label}`)
  await element.click()
  await handle.dispose()
}

async function visibleText(page, selector, label) {
  await page.waitForFunction((selector, label) => [...document.querySelectorAll(selector)].some(
    element => element.getClientRects().length && element.textContent.trim().includes(label),
  ), {}, selector, label)
}

const demoPassphrase = 'paper-garden'
const anonymous = new Client()
const teacher = new Client()
const admin = new Client()
const requestId = () => crypto.randomUUID()
const changed = (path, body, options = {}) => admin.request(path, { method: 'POST', body, ...options })
const writeNote = (note, patch = {}, id = requestId()) => changed('/api/admin/notes', {
  requestId: id,
  id: note.id,
  expectedRevision: note.revision ?? 0,
  teacher: note.teacher,
  text: note.text,
  visible: note.visible ?? true,
  ...patch,
})
const adminState = async () => (await admin.request('/api/admin', { status: 200 })).data
const board = async () => teacher.request('/api/board', { status: 200 })
const noteById = (data, id) => {
  const note = data.notes.find(note => note.id === id)
  assert.ok(note, `Missing note ${id}`)
  return note
}
const isAccepted = result => result.status >= 200 && result.status < 300
const assertRejected = (result, label) => {
  assert.ok(result.status >= 400 && result.status < 500, `${label}: received ${result.status}`)
  assert.ok(result.data.error, `${label}: expected an actionable error`)
}
const assertAccepted = (result, label) => {
  assert.ok(isAccepted(result), `${label}: received ${result.status} ${JSON.stringify(result.data)}`)
}

await check('anonymous and cross-role requests are denied', async () => {
  for (const path of ['/api/board', '/api/admin', '/api/admin/backup']) {
    assertRejected(await anonymous.request(path), path)
  }
  assertRejected(await anonymous.request('/api/admin/notes', { method: 'POST', body: {} }), 'anonymous write')
  assertRejected(await new Client({ 'cf-access-authenticated-user-email': 'council@example.test' }).request('/api/admin'), 'identity header alone')
  assertRejected(await teacher.request('/api/unlock', {
    method: 'POST', body: { passphrase: 'intentionally-incorrect' },
  }), 'incorrect passphrase')
  const unlocked = await teacher.request('/api/unlock', { method: 'POST', body: { passphrase: demoPassphrase } })
  assertAccepted(unlocked, 'teacher unlock')
  assert.match(unlocked.setCookie ?? '', /\bHttpOnly\b/i)
  assert.match(unlocked.setCookie ?? '', /\bSameSite=(?:Strict|Lax)\b/i)
  const lifetime = /\bMax-Age=(\d+)\b/i.exec(unlocked.setCookie ?? '')
  const expiry = /\bExpires=([^;]+)/i.exec(unlocked.setCookie ?? '')
  const seconds = lifetime ? Number(lifetime[1]) : (Date.parse(expiry?.[1]) - Date.now()) / 1_000
  assert.ok(Math.abs(seconds - 30 * 24 * 60 * 60) < 10, 'Teacher cookie expires after 30 days')
  assertRejected(await teacher.request('/api/admin'), 'teacher session cannot read admin')
  assertRejected(await teacher.request('/api/admin/notes', { method: 'POST', body: {} }), 'teacher session cannot write admin')
  assertAccepted(await admin.request('/api/demo/admin', { method: 'POST' }), 'demo admin sign-in')
  assert.ok(admin.cookie, 'Mock admin sends a cookie')
  assertRejected(await admin.request('/api/board'), 'admin session alone cannot read teacher board')
  assertAccepted(await admin.request('/api/admin'), 'admin dashboard read')
  assertAccepted(await admin.request('/api/admin/backup'), 'admin backup read')
  assertRejected(await changed('/api/admin/sessions/revoke', { requestId: requestId() }, {
    headers: { origin: 'https://unrelated.invalid', 'sec-fetch-site': 'cross-site' },
  }), 'cross-origin administrator mutation')
})

const initial = await adminState()
const initialBoard = await board()
const originalBackup = (await admin.request('/api/admin/backup', { status: 200 })).data
const slots = new Map(initialBoard.data.notes.map(note => [note.id, note.slot]))
const counts = new Map()
for (const note of initialBoard.data.notes) counts.set(note.teacher, (counts.get(note.teacher) ?? 0) + 1)
const coverageNote = initial.notes.find(note => counts.get(note.teacher) === 3)
const otherNotes = initial.notes.filter(note => note.teacher !== coverageNote?.teacher)
const [secondNote, thirdNote] = otherNotes
const originalTeacher = coverageNote?.teacher

await check('synthetic seed has 500 stable slots and private board responses', async () => {
  assert.equal(initial.notes.length, 500)
  assert.equal(initialBoard.data.notes.length, 500)
  assert.equal(counts.size, 41)
  assert.equal(Math.max(...counts.values()), 55)
  assert.ok(Math.min(...counts.values()) >= 3)
  assert.ok(coverageNote, 'Demo contains a teacher at the three-note threshold')
  assert.equal(new Set(slots.values()).size, 500)
  assert.ok([...slots.values()].every(slot => Number.isInteger(slot) || typeof slot === 'string'))
  assert.match(initialBoard.response.headers.get('cache-control') ?? '', /private|no-store/i)
  const etag = initialBoard.response.headers.get('etag')
  assert.ok(etag, 'Protected board responds with a revision ETag')
  await teacher.request('/api/board', { headers: { 'if-none-match': etag }, status: 304 })
  assertRejected(await anonymous.request('/api/board', { headers: { 'if-none-match': etag } }), 'conditional read without authorization')
  assert.equal(originalBackup.version, 1)
  assert.equal(originalBackup.notes.length, 500)
  const fixtureNotes = fixture().notes
  for (const expected of fixtureNotes) {
    const actual = noteById(initialBoard.data, expected.id)
    assert.ok(actual.teacher === expected.teacher && actual.text === expected.text, `Seed changed synthetic note ${expected.id}`)
  }
  const markers = [...new Set(fixtureNotes.map(note => note.text.slice(0, 45)))].map(text => ['synthetic note excerpt', text])
  markers.push(['demo passphrase', demoPassphrase])
  await filesContainNone(resolve('dist'), markers)
  for (const path of ['/scripts/fixture.mjs', '/migrations/0001_wall.sql', '/.dev.vars']) {
    const { data } = await anonymous.request(path)
    const served = typeof data === 'string' ? data : JSON.stringify(data)
    for (const [label, marker] of markers) assert.ok(!served.includes(marker), `${label} served by ${path}`)
  }
})

let visibleRevision
await check('conditional refresh evicts hidden notes while any other slot stays stable', async () => {
  const etag = initialBoard.response.headers.get('etag')
  assertAccepted(await writeNote(coverageNote, { visible: false }), 'hide threshold note')
  const next = await teacher.request('/api/board', { headers: { 'if-none-match': etag }, status: 200 })
  assert.notEqual(next.response.headers.get('etag'), etag)
  assert.equal(next.data.notes.length, 499)
  assert.ok(!next.data.notes.some(note => note.id === coverageNote.id))
  for (const note of next.data.notes) assert.equal(note.slot, slots.get(note.id), note.id)
  const state = await adminState()
  assert.equal(noteById(state, coverageNote.id).visible, false)
  assert.equal(next.data.notes.filter(note => note.teacher === originalTeacher).length, 2)
  const history = state.history.find(record => record.noteId === coverageNote.id)
  assert.ok(history?.before?.visible && !history?.after?.visible && history?.actor, 'Hide history keeps before/after visibility and the actor')
  visibleRevision = history.id
})

await check('restoring the seeded revision reclaims its original slot when available', async () => {
  const hidden = noteById(await adminState(), coverageNote.id)
  assertAccepted(await changed('/api/admin/revision', {
    requestId: requestId(), id: hidden.id, expectedRevision: hidden.revision, historyId: visibleRevision, side: 'before',
  }), 'restore the original seeded revision')
  assert.equal(noteById((await board()).data, hidden.id).slot, slots.get(hidden.id))
  assertAccepted(await writeNote(noteById(await adminState(), hidden.id), { visible: false }), 'free the slot again')
})

const additions = []
await check('concurrent allocation uses separate slots and grows past 500', async () => {
  const secondAdmin = new Client()
  assertAccepted(await secondAdmin.request('/api/demo/admin', { method: 'POST' }), 'independent admin client')
  const bodies = [0, 1].map(index => ({
    requestId: requestId(),
    id: `qa-add-${requestId()}`,
    expectedRevision: 0,
    teacher: originalTeacher,
    text: `Synthetic QA growth candidate ${index + 1}.`,
    visible: true,
  }))
  const submit = (client, body) => client.request('/api/admin/notes', { method: 'POST', body })
  const clients = [admin, secondAdmin]
  const responses = await Promise.all(bodies.map((body, index) => submit(clients[index], body)))
  assert.ok(responses.some(isAccepted), 'At least one competing write makes progress')
  for (const [index, response] of responses.entries()) {
    if (!isAccepted(response)) {
      assert.equal(response.status, 409, 'Concurrent allocation may request an optimistic retry')
      assertAccepted(await submit(clients[index], bodies[index]), 'retry after unrelated note revision')
    }
  }
  const filled = (await board()).data
  assert.equal(filled.notes.length, 501)
  assert.equal(new Set(filled.notes.map(note => note.slot)).size, 501)
  additions.push(...bodies.map(body => noteById(filled, body.id)))
  assert.ok(additions.some(note => note.slot >= 500), 'At least one new note occupies an expansion slot')
  for (const note of filled.notes.filter(note => slots.has(note.id))) assert.equal(note.slot, slots.get(note.id), note.id)
  const beforeRetry = await adminState()
  assertAccepted(await submit(admin, bodies[0]), 'same request ID retry')
  const afterRetry = await adminState()
  assert.equal(afterRetry.revision, beforeRetry.revision)
  assert.equal(afterRetry.history.length, beforeRetry.history.length)
  assert.equal(afterRetry.notes.length, beforeRetry.notes.length)
})

await check('concurrent edits detect a stale revision and safely retry against the new revision', async () => {
  const current = noteById(await adminState(), thirdNote.id)
  const [first, second] = await Promise.all([
    writeNote(current, { text: 'Synthetic QA concurrent edit Alpha.' }),
    writeNote(current, { text: 'Synthetic QA concurrent edit Beta.' }),
  ])
  assert.equal([first, second].filter(isAccepted).length, 1)
  assertRejected([first, second].find(result => !isAccepted(result)), 'stale edit')
  const recent = noteById(await adminState(), thirdNote.id)
  assert.match(recent.text, /^Synthetic QA concurrent edit (Alpha|Beta)\.$/)
  assert.ok(recent.revision > current.revision)
  assertAccepted(await writeNote(recent, { text: current.text }), 'retry with current revision')
  assert.equal(noteById(await adminState(), thirdNote.id).text, current.text)
})

await check('revision restoration preserves notes and slots on the expanded board', async () => {
  const current = await adminState()
  const hidden = noteById(current, coverageNote.id)
  const history = current.history.find(record => record.noteId === coverageNote.id)
  assert.ok(history?.before?.visible && !history.after?.visible, 'Hide records both visibility states')
  const expanded = (await board()).data
  assertAccepted(await changed('/api/admin/revision', {
    requestId: requestId(), id: hidden.id, expectedRevision: hidden.revision, historyId: visibleRevision, side: 'before',
  }), 'restore onto a board already past 500 notes')
  const restored = (await board()).data
  const occupied = new Set(expanded.notes.map(note => note.slot))
  const restoreSlot = noteById(restored, hidden.id).slot
  assert.ok(!occupied.has(restoreSlot), 'Restoration uses an unoccupied slot')
  if (!occupied.has(slots.get(hidden.id))) assert.equal(restoreSlot, slots.get(hidden.id))
  assert.equal(restored.notes.length, 502)
  assert.equal(new Set(restored.notes.map(note => note.slot)).size, 502)
  for (const note of expanded.notes) assert.equal(noteById(restored, note.id).slot, note.slot, note.id)
  assertAccepted(await writeNote(noteById(await adminState(), secondNote.id), { visible: false }), 'hide a note for backup confirmation tests')
})

await check('backup dry-run requires explicit republish confirmation and restores exact visible data', async () => {
  const baseline = await adminState()
  const backupBody = { backup: originalBackup }
  const invalid = structuredClone(originalBackup)
  invalid.notes[1].slot = invalid.notes[0].slot
  assertRejected(await changed('/api/admin/restore/preview', { backup: invalid }), 'duplicate backup slot')
  const preview = await changed('/api/admin/restore/preview', backupBody, { status: 200 })
  assert.equal((await adminState()).revision, baseline.revision)
  assert.deepEqual(preview.data.republished, [secondNote.id])
  for (const addition of additions) assert.ok(preview.data.removed.includes(addition.id))
  const restoreBody = { ...backupBody, expectedRevision: baseline.revision, requestId: requestId() }
  assertRejected(await changed('/api/admin/restore', { ...restoreBody, expectedRevision: baseline.revision - 1, confirmRepublished: [secondNote.id] }), 'stale recovery preview')
  assertRejected(await changed('/api/admin/restore', { ...restoreBody, requestId: requestId(), confirmRepublished: [] }), 'restore without republish confirmation')
  assert.equal((await adminState()).revision, baseline.revision)
  assertAccepted(await changed('/api/admin/restore', {
    ...restoreBody, requestId: requestId(), confirmRepublished: [secondNote.id],
  }), 'restore after explicit confirmation')
  const restored = (await board()).data
  assert.equal(restored.notes.length, 500)
  for (const expected of initialBoard.data.notes) {
    const actual = noteById(restored, expected.id)
    assert.equal(actual.teacher, expected.teacher)
    assert.equal(actual.text, expected.text)
    assert.equal(actual.slot, expected.slot)
  }
})

await check('large recovery restores all 500 notes in one confirmed operation', async () => {
  const allChanged = structuredClone(originalBackup)
  for (const note of allChanged.notes) note.text = `QA recovery ${note.text}`
  for (const snapshot of [allChanged, originalBackup]) {
    const { data: impact } = await changed('/api/admin/restore/preview', { backup: snapshot }, { status: 200 })
    assert.equal(impact.changed.length, 500)
    assert.equal(impact.republished.length, 0)
    const body = { backup: snapshot, expectedRevision: impact.revision, confirmRepublished: [], requestId: requestId() }
    assertAccepted(await changed('/api/admin/restore', body), 'apply full-board recovery')
    assertAccepted(await changed('/api/admin/restore', body), 'retry full-board recovery')
    const restored = (await board()).data
    assert.equal(restored.revision, impact.revision + 1)
    const expected = new Map(snapshot.notes.map(note => [note.id, note]))
    for (const note of restored.notes) {
      assert.equal(note.text, expected.get(note.id).text)
      assert.equal(note.slot, expected.get(note.id).slot)
    }
  }
})

await check('sign-out and administrator revocation invalidate existing teacher sessions', async () => {
  const firstSession = teacher.cookie
  const logoutClient = new Client({ cookie: firstSession })
  assertAccepted(await logoutClient.request('/api/logout', { method: 'POST' }), 'teacher sign-out')
  assertRejected(await teacher.request('/api/board'), 'replayed signed-out cookie')
  assertAccepted(await teacher.request('/api/unlock', { method: 'POST', body: { passphrase: demoPassphrase } }), 'unlock after logout')
  const newTeacher = new Client()
  assertAccepted(await newTeacher.request('/api/unlock', { method: 'POST', body: { passphrase: demoPassphrase } }), 'second teacher session')
  await newTeacher.request('/api/board', { status: 200 })
  assertAccepted(await changed('/api/admin/sessions/revoke', { requestId: requestId() }), 'administrator revokes teacher sessions')
  assertRejected(await teacher.request('/api/board'), 'first revoked teacher cookie')
  assertRejected(await newTeacher.request('/api/board'), 'second revoked teacher cookie')
  await admin.request('/api/admin', { status: 200 })
  assertAccepted(await newTeacher.request('/api/unlock', { method: 'POST', body: { passphrase: demoPassphrase } }), 'fresh session after revocation')
  await newTeacher.request('/api/board', { status: 200 })
})

function adminCookie() {
  const split = admin.cookie.indexOf('=')
  return { name: admin.cookie.slice(0, split), value: admin.cookie.slice(split + 1), url: origin.href, httpOnly: true }
}

await check('desktop admin routes and editor survive failed and ambiguous writes', () => browserCheck(async browser => {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(new URL('/admin', origin).href, { waitUntil: 'networkidle0' })
  await visibleText(page, 'h2', 'Local demo')
  assert.equal(await page.$('.adm-slotmap'), null)
  await clickText(page, 'button', 'Enter demo admin')
  await visibleText(page, 'h1', 'Overview')
  await page.screenshot({ path: resolve(artifacts, 'overview-desktop.png') })
  await page.click('button[aria-label="Collapse sidebar"]')
  await page.waitForSelector('.adm-compact')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.adm-compact')
  const notesLink = '.adm-side nav a[aria-label="Notes"]'
  await page.focus(notesLink)
  assert.equal(await page.$eval(notesLink, node => getComputedStyle(node, '::after').content), '"Notes"')
  await page.click('button[aria-label="Expand sidebar"]')
  await page.waitForFunction(() => !document.querySelector('.adm-compact'))
  for (const route of ['Notes', 'Review', 'Teachers', 'Change history', 'Backup & restore', 'Access', 'Overview']) {
    await clickText(page, 'nav a, nav button', route)
    await visibleText(page, 'h1', route)
  }
  await clickText(page, 'nav a, nav button', 'Notes')
  await visibleText(page, 'h1', 'Notes')
  await page.type('input[aria-label="Search note, teacher or ID"]', coverageNote.id)
  const escapedId = coverageNote.id.replace(/["\\]/g, '\\$&')
  await page.click(`button[aria-label="Edit ${escapedId}"]`)
  await page.waitForSelector('dialog[open] textarea')
  const syntheticDraft = 'Synthetic QA draft that survives an interrupted write.'
  await page.focus('dialog[open] textarea')
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.type(syntheticDraft)
  await page.select('dialog[open] select', 'hidden')
  await visibleText(page, 'dialog[open]', 'fewer than three visible notes')
  const writes = []
  let serverReceipt
  await page.setRequestInterception(true)
  page.on('request', async request => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/admin/notes') {
      await request.continue()
      return
    }
    const body = JSON.parse(request.postData())
    writes.push(body)
    if (writes.length === 1) {
      await request.abort('failed')
    } else if (writes.length === 2) {
      serverReceipt = await changed('/api/admin/notes', body)
      await request.abort('failed')
    } else {
      await request.continue()
    }
  })
  await clickText(page, 'dialog[open] button', 'Save note')
  await visibleText(page, 'dialog[open] [role="alert"]', 'Connection lost')
  assert.equal(await page.$eval('dialog[open] textarea', element => element.value), syntheticDraft)
  assert.equal(noteById(await adminState(), coverageNote.id).visible, true)
  await page.screenshot({ path: resolve(artifacts, 'editor-write-failure.png') })
  await clickText(page, 'dialog[open] button', 'Retry save')
  await visibleText(page, 'dialog[open] [role="alert"]', 'Connection lost')
  assertAccepted(serverReceipt, 'intercepted write reached server before response was lost')
  assert.equal(await page.$eval('dialog[open] textarea', element => element.value), syntheticDraft)
  const committed = await adminState()
  assert.equal(noteById(committed, coverageNote.id).visible, false)
  await clickText(page, 'dialog[open] button', 'Retry save')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  assert.equal(writes.length, 3)
  assert.ok(writes.every(body => body.requestId === writes[0].requestId))
  assert.equal((await adminState()).revision, committed.revision)
  await clickText(page, 'nav a, nav button', 'Overview')
  await visibleText(page, 'button', 'Review 1 hidden note')
  await visibleText(page, 'button', 'Below three')
  await clickText(page, '.adm-rowlink strong', 'Review 1 hidden note')
  await page.waitForFunction(() => document.querySelector('select[aria-label="Filter by status"]')?.value === 'hidden')
  await visibleText(page, 'tbody', syntheticDraft)

  const hide = committed.history.find(record => record.noteId === coverageNote.id)
  assertAccepted(await changed('/api/admin/revision', {
    requestId: requestId(), id: coverageNote.id, expectedRevision: hide.after.revision, historyId: hide.id, side: 'before',
  }), 'clean up browser moderation change')
  await clickText(page, 'button', 'Add note')
  await page.waitForSelector('dialog[open] input[list="adm-teachers"]')
  await page.type('dialog[open] input[list="adm-teachers"]', originalTeacher)
  const expansionText = 'Synthetic QA note added from the expanded council editor.'
  await page.type('dialog[open] textarea', expansionText)
  await clickText(page, 'dialog[open] button', 'Save note')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  const grown = (await admin.request('/api/admin/board', { status: 200 })).data
  assert.equal(grown.notes.length, 501)
  assert.ok(grown.notes.some(note => note.slot >= 500 && note.text === expansionText))
  assertAccepted(await changed('/api/admin/restore', {
    backup: originalBackup, expectedRevision: grown.revision, confirmRepublished: [], requestId: requestId(),
  }), 'clean up browser expansion note')
  await page.close()
}))

await check('390 px council drawer opens, navigates and closes without horizontal overflow', () => browserCheck(async browser => {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await page.setCookie(adminCookie())
  await page.goto(new URL('/admin', origin).href, { waitUntil: 'networkidle0' })
  await visibleText(page, 'h1', 'Overview')
  await page.tap('button[aria-label="Open navigation"]')
  await visibleText(page, 'dialog[open] h2', 'Council navigation')
  await page.screenshot({ path: resolve(artifacts, 'navigation-phone.png') })
  await page.tap('dialog[open] nav a[aria-label="Access"]')
  await visibleText(page, 'h1', 'Access')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  const dimensions = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
  assert.ok(dimensions[0] <= dimensions[1], `Mobile page width: ${dimensions.join(' vs ')}`)
  await page.close()
}))

await check('browser refresh evicts a hidden open note and removes it from teacher export', () => browserCheck(async browser => {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(new URL('/teacher', origin).href, { waitUntil: 'networkidle0' })
  await page.type('input[type="password"]', demoPassphrase)
  await clickText(page, 'button', 'Unlock the wall')
  await clickText(page, 'button', 'Open the wall')
  await page.waitForFunction(() => document.querySelectorAll('.paper-board button[data-id]').length === 500)
  const cookies = await page.cookies()
  const wallCookie = cookies.find(cookie => cookie.name === 'wall_session')
  assert.ok(wallCookie?.httpOnly && !wallCookie.session)
  assert.ok(Math.abs(wallCookie.expires - Date.now() / 1000 - 30 * 24 * 60 * 60) < 15)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelectorAll('.paper-board button[data-id]').length === 500)
  const current = noteById(await adminState(), coverageNote.id)
  const card = await page.waitForFunction(id => [...document.querySelectorAll('.paper-board button[data-id]')].find(node => node.dataset.id === id), {}, current.id)
  const cardElement = card.asElement()
  assert.ok(cardElement, 'Find the note by stable ID on the wall')
  await cardElement.click()
  await visibleText(page, 'dialog[open], [role="dialog"]', current.text)
  assertAccepted(await writeNote(current, { visible: false }), 'hide active reader note')
  const hidden = [current]
  try {
    const refresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/board' && response.status() === 200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await refresh
    await page.waitForFunction((id, text) => ![...document.querySelectorAll('.paper-board button[data-id]')].some(node => node.dataset.id === id)
      && ![...document.querySelectorAll('dialog[open], [role="dialog"]')].some(dialog => dialog.textContent.includes(text)), {}, current.id, current.text)
    await page.screenshot({ path: resolve(artifacts, 'active-wall-after-hide.png') })
    await page.type('input[aria-label="Find my notes"]', current.teacher)
    await visibleText(page, '#wall-profiles [role="option"]', current.teacher)
    await page.keyboard.press('Enter')
    await clickText(page, '.spot-bar button', 'View my notes')
    await visibleText(page, 'dialog[open] h2, [role="dialog"] h2', current.teacher)
    await clickText(page, 'dialog[open] button, [role="dialog"] button', 'Save my notes')
    await page.waitForSelector('.ks-dialog[open] .ks-list input[type="checkbox"]')
    assert.equal(await page.$$eval('.ks-list input[type="checkbox"]', inputs => inputs.length), 2)
    assert.ok(!await page.$eval('.ks-list', (list, text) => list.textContent.includes(text), current.text))
    await page.screenshot({ path: resolve(artifacts, 'export-after-hide.png') })
    const inExport = (await adminState()).notes.find(note => note.visible && note.teacher === current.teacher)
    assertAccepted(await writeNote(inExport, { visible: false }), 'hide a note while its export is open')
    hidden.push(inExport)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(() => document.querySelectorAll('.ks-dialog[open] .ks-list input[type="checkbox"]').length === 1)
    assert.ok(!await page.$eval('.ks-list', (list, text) => list.textContent.includes(text), inExport.text))
  } finally {
    const state = await adminState()
    for (const note of hidden) {
      const hide = state.history.find(record => record.noteId === note.id)
      assertAccepted(await changed('/api/admin/revision', {
        requestId: requestId(), id: note.id, expectedRevision: hide.after.revision, historyId: hide.id, side: 'before',
      }), 'restore the note after browser propagation test')
    }
  }
  await page.close()
}))
