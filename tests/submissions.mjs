import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { fixture } from '../scripts/fixture.mjs'

const origin = new URL(process.env.SUBMISSION_QA_URL ?? 'http://127.0.0.1:8798')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'Use an isolated local demo URL')
const state = resolve(process.env.SUBMISSION_QA_STATE ?? '/tmp/stjbs-submission-qa')
const stateMarker = join(state, 'teacher-wall-local-demo')
assert.ok(existsSync(stateMarker), 'Set SUBMISSION_QA_STATE to the isolated npm run demo --state directory')
const temporary = mkdtempSync(join(tmpdir(), 'stjbs-student-qa-'))
process.on('exit', () => rmSync(temporary, { recursive: true, force: true }))
const config = join(temporary, 'wrangler.json')
const persist = join(state, 'd1-state')
writeFileSync(config, JSON.stringify({
  name: 'stjbs-student-qa', compatibility_date: '2025-10-01',
  d1_databases: [{ binding: 'DB', database_name: 'local-synthetic-wall', database_id: '00000000-0000-4000-9000-000000000001' }],
}))
const demoTarget = ['local-synthetic-wall', '--local', '--persist-to', persist, '--config', config]
const marker = 'Synthetic QA student note, unique to the isolated suite.'

class Client {
  cookie = ''

  constructor(headers = {}) {
    this.headers = headers
  }

  async request(path, options = {}) {
    const { body, method = body === undefined ? 'GET' : 'POST', headers } = options
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
    const raw = await response.text()
    return { status: response.status, headers: response.headers, data: raw ? JSON.parse(raw) : null }
  }
}

const anonymous = new Client()
const teacher = new Client()
const manager = new Client()
const secondManager = new Client()
const student = new Client({ 'cf-connecting-ip': '192.0.2.101' })
const ok = (result, label) => {
  assert.ok(result.status >= 200 && result.status < 300, `${label}: ${result.status} ${result.data?.error ?? ''}`)
  return result.data
}
const denied = (result, label) => {
  assert.ok(result.status >= 400 && result.status < 500, `${label}: ${result.status}`)
}
const submit = (client, note) => client.request('/api/student/submit', { body: note })
const act = (client, id, action, revision = 1) => client.request('/api/admin/review', { body: { id, action, revision } })
const publishedId = id => `student-${id}`
const review = async () => ok(await manager.request('/api/admin/review'), 'council review')
const board = async () => ok(await teacher.request('/api/board'), 'teacher board')
const meaningfulText = `${marker}\n謝謝老師 🌷\nA second line with exact punctuation.`

async function check(label, run) {
  await run()
  console.log(`PASS ${label}`)
}

function wrangler(args) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(temporary, 'wrangler.log') },
  })
  assert.equal(result.status, 0, result.stderr || 'Local D1 command did not complete')
  return result.stdout
}

function sql(statement, target = demoTarget) {
  return JSON.parse(wrangler(['d1', 'execute', ...target, '--command', statement, '--json']))[0].results
}

const original = fixture().notes
const selectedTeacher = original[0].teacher
const makeNote = (text = meaningfulText) => ({ id: randomUUID(), teacher: selectedTeacher, text })
let baseline

await check('public student data contains only teacher names; wall and review remain protected', async () => {
  const directory = await anonymous.request('/api/student/teachers')
  const data = ok(directory, 'public teacher directory')
  assert.deepEqual(Object.keys(data), ['teachers'])
  assert.deepEqual([...data.teachers].sort(), [...new Set(original.map(note => note.teacher))].sort())
  denied(await anonymous.request('/api/board'), 'anonymous wall read')
  denied(await anonymous.request('/api/admin/review'), 'anonymous queue read')
  denied(await act(anonymous, randomUUID(), 'approve'), 'anonymous approve')
  ok(await teacher.request('/api/unlock', { body: { passphrase: 'paper-garden' } }), 'teacher unlock')
  denied(await teacher.request('/api/admin/review'), 'teacher queue read')
  denied(await act(teacher, randomUUID(), 'reject'), 'teacher reject')
  for (const client of [manager, secondManager]) ok(await client.request('/api/demo/admin', { method: 'POST' }), 'local council sign-in')
  const queues = await review()
  assert.deepEqual(queues.pending, [])
  assert.deepEqual(queues.trash, [])
  baseline = await board()
  assert.equal(baseline.notes.length, 500)
})

const first = makeNote()
await check('student submission validates input, preserves exact text and safely replays', async () => {
  denied(await submit(student, { ...first, id: 'not-a-uuid' }), 'non-UUID submission')
  denied(await submit(student, { ...first, teacher: 'Unlisted QA teacher' }), 'unknown teacher')
  denied(await submit(student, { ...first, text: '   \n ' }), 'empty student note')
  denied(await submit(student, { ...first, text: 'x'.repeat(100_000) }), 'oversize student note')
  denied(await student.request('/api/student/submit', {
    body: first, headers: { origin: 'https://unrelated.invalid', 'sec-fetch-site': 'cross-site' },
  }), 'cross-origin student submission')
  const sent = await submit(student, first)
  ok(sent, 'submit anonymously')
  assert.equal(sent.status, 202)
  assert.match(sent.headers.get('cache-control') ?? '', /no-store/i)
  assert.ok(!JSON.stringify(sent.data).includes(marker), 'Submission response does not echo note content')
  ok(await submit(student, first), 'repeat identical submission')
  denied(await submit(student, { ...first, text: 'Synthetic QA conflicting replay.' }), 'reuse an ID with different content')
  const pending = (await review()).pending.filter(item => item.id === first.id)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].teacher, first.teacher)
  assert.equal(pending[0].text, first.text)
  assert.ok(!JSON.stringify(pending[0]).includes('192.0.2.101'), 'Queue contains no raw client IP')
  const beforeApproval = await board()
  assert.equal(beforeApproval.revision, baseline.revision)
  assert.ok(!beforeApproval.notes.some(note => note.id === publishedId(first.id) || note.text.includes(marker)))
  const archive = ok(await manager.request('/api/admin/backup'), 'approved-note backup')
  assert.ok(!JSON.stringify(archive).includes(marker), 'Pending note is absent from board backup')
})

await check('competing approval and rejection apply one decision; approval publishes once', async () => {
  const settled = await Promise.all([act(manager, first.id, 'approve'), act(secondManager, first.id, 'reject')])
  assert.equal(settled.filter(result => result.status >= 200 && result.status < 300).length, 1)
  const published = await board()
  const winnerApproved = settled[0].status < 300
  assert.equal(published.notes.some(note => note.id === publishedId(first.id)), winnerApproved)
  const queues = await review()
  assert.ok(!queues.pending.some(note => note.id === first.id))
  assert.equal(queues.trash.some(note => note.id === first.id), !winnerApproved)
  if (!winnerApproved) {
    ok(await act(manager, first.id, 'restore', 2), 'move first rejected note back to pending')
    ok(await act(manager, first.id, 'approve', 3), 'approve restored first note')
  }
  const beforeReplay = await board()
  ok(await act(manager, first.id, 'approve', winnerApproved ? 1 : 3), 'retry the successful approval')
  const afterReplay = await board()
  assert.equal(afterReplay.revision, beforeReplay.revision)
  const approvedNotes = afterReplay.notes.filter(note => note.id === publishedId(first.id))
  assert.equal(approvedNotes.length, 1)
  assert.equal(approvedNotes[0].text, first.text)
  assert.ok(approvedNotes[0].slot >= 500)
  const council = ok(await manager.request('/api/admin'), 'council history')
  assert.equal(council.history.filter(event => event.noteId === publishedId(first.id) && event.after?.visible).length, 1)
})

await check('trash restores to pending and removes entries older than 30 days', async () => {
  const restored = makeNote('Synthetic QA note for temporary trash restore.')
  const expired = makeNote('Synthetic QA note for expired trash removal.')
  for (const note of [restored, expired]) {
    ok(await submit(student, note), 'submit trash candidate')
    ok(await act(manager, note.id, 'reject'), 'reject trash candidate')
  }
  const before = await review()
  assert.ok(before.trash.some(note => note.id === restored.id))
  assert.ok(before.trash.some(note => note.id === expired.id))
  assert.ok(!(await board()).notes.some(note => [restored.id, expired.id].map(publishedId).includes(note.id)))
  sql(`UPDATE student_submissions SET reviewedAt=unixepoch()-30*86400+60 WHERE id='${restored.id}'; UPDATE student_submissions SET reviewedAt=unixepoch()-30*86400-60 WHERE id='${expired.id}'`)
  // Probe the restore endpoint before reading the queue so expiry is enforced on actions as well as reads.
  denied(await act(manager, expired.id, 'restore', 2), 'restore expired submission')
  const cleaned = await review()
  assert.ok(cleaned.trash.some(note => note.id === restored.id))
  assert.ok(!cleaned.trash.some(note => note.id === expired.id))
  assert.deepEqual(sql(`SELECT count(*) AS count FROM student_submissions WHERE id='${expired.id}'`), [{ count: 0 }])
  ok(await act(manager, restored.id, 'restore', 2), 'restore just inside the retention window')
  const current = await review()
  assert.ok(current.pending.some(note => note.id === restored.id && note.text === restored.text))
  assert.ok(!current.trash.some(note => note.id === restored.id))
  assert.ok(!(await board()).notes.some(note => note.id === publishedId(restored.id)))
})

await check('the published board grows above 520 while all 500 seeded slots stay stable', async () => {
  const senders = Array.from({ length: 3 }, (_, index) => new Client({ 'cf-connecting-ip': `192.0.2.${120 + index}` }))
  const notes = Array.from({ length: 21 }, (_, index) => makeNote(`Synthetic QA expansion note ${index + 1}.`))
  for (const [index, note] of notes.entries()) {
    ok(await submit(senders[index % senders.length], note), 'submit expansion candidate')
    ok(await act(manager, note.id, 'approve'), 'approve expansion candidate')
  }
  const expanded = await board()
  assert.equal(expanded.notes.length, 522)
  assert.equal(new Set(expanded.notes.map(note => note.slot)).size, 522)
  const originals = new Map(baseline.notes.map(note => [note.id, note.slot]))
  for (const note of expanded.notes.filter(note => originals.has(note.id))) assert.equal(note.slot, originals.get(note.id), note.id)
  for (const expected of notes) assert.ok(expanded.notes.some(note => note.id === publishedId(expected.id) && note.text === expected.text && note.slot >= 500))
  const archive = ok(await manager.request('/api/admin/backup'), 'expanded-wall backup')
  assert.equal(archive.notes.length, 522)
  const diff = ok(await manager.request('/api/admin/restore/preview', { body: { backup: archive } }), 'expanded-wall backup preview')
  assert.deepEqual(diff.changed, [])
})

await check('submission throttle counts browsers independently on the same school network', async () => {
  const schoolNetwork = { 'cf-connecting-ip': '192.0.2.140' }
  const limited = new Client(schoolNetwork)
  const schoolmate = new Client(schoolNetwork)
  for (const client of [limited, schoolmate]) {
    const directory = await client.request('/api/student/teachers')
    ok(directory, 'obtain the student browser cookie with the roster')
    assert.match(directory.headers.get('set-cookie') ?? '', /student_device=.+;.*HttpOnly.*SameSite=Strict/i)
  }
  assert.notEqual(limited.cookie, schoolmate.cookie)
  const notes = Array.from({ length: 12 }, (_, index) => makeNote(`Synthetic QA throttling note ${index + 1}.`))
  for (const note of notes) ok(await submit(limited, note), 'within quota')
  assert.equal((await submit(limited, makeNote('Synthetic QA over quota.'))).status, 429)
  ok(await submit(limited, notes[0]), 'safe replay does not consume quota')
  ok(await submit(schoolmate, makeNote('Synthetic QA other browser on the same school network.')), 'second browser has an independent quota')
  sql(`WITH RECURSIVE quota(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM quota WHERE n<287)
    INSERT INTO student_submissions(id,teacher,text,fingerprint,sender)
    SELECT 'qa-school-'||n,'Ada Chen','Synthetic QA school network cap.','qa', substr(sender,1,65)||'qa-'||n
    FROM quota CROSS JOIN (SELECT sender FROM student_submissions WHERE id='${notes[0].id}')`)
  assert.equal((await submit(schoolmate, makeNote('Synthetic QA over school network quota.'))).status, 429)
  const separateNetwork = new Client({ 'cf-connecting-ip': '192.0.2.141' })
  ok(await submit(separateNetwork, makeNote('Synthetic QA separate network.')), 'separate network retains its quota')
})

await check('signed council access allows managers and editors to review; viewers are denied', async () => {
  const code = join(temporary, 'routes.mjs')
  await build({
    entryPoints: ['functions/api/[[path]].ts'], bundle: true, format: 'esm', platform: 'neutral', outfile: code, logLevel: 'silent',
  })
  const { onRequest } = await import(pathToFileURL(code).href)
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const key = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'isolated-student-qa' }
  const issuer = 'https://isolated-student-qa.cloudflareaccess.com'
  const audience = 'isolated-student-qa'
  const managerEmail = 'manager@example.invalid'
  const adminEmail = 'admin@example.invalid'
  const viewerEmail = 'viewer@example.invalid'
  const otherEmail = 'unlisted@example.invalid'
  const fakeDB = {
    prepare(statement) {
      return { bind(email) { return {
        first: async () => statement.includes('council_members') && email === viewerEmail ? 1 : null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      } } }
    },
    async batch() { return [{ meta: { changes: 1 } }] },
  }
  const env = {
    DB: fakeDB,
    ADMIN_HOST: 'wall.example.invalid',
    ACCESS_ISSUER: issuer,
    ACCESS_AUD: audience,
    ADMIN_EMAILS: `${managerEmail},${adminEmail}`,
    ACCESS_MANAGERS: managerEmail,
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    assert.equal(String(url), issuer + '/cdn-cgi/access/certs', 'Only the synthetic key endpoint may be requested')
    return Response.json({ keys: [key] })
  }
  try {
    for (const [email, expected] of [[managerEmail, 200], [adminEmail, 200], [viewerEmail, 403], [otherEmail, 403]]) {
      const token = await new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: key.kid })
        .setIssuer(issuer).setAudience(audience).setSubject(email).setExpirationTime('1m').sign(privateKey)
      for (const method of ['GET', 'POST']) {
        const init = { method, headers: { 'Cf-Access-Jwt-Assertion': token } }
        if (method === 'POST') {
          init.headers['Content-Type'] = 'application/json'
          init.body = JSON.stringify({ id: randomUUID(), action: 'approve', revision: 1 })
        }
        const result = await onRequest({ request: new Request('https://wall.example.invalid/api/admin/review', init), env })
        assert.equal(result.status, expected, `${email}: ${method} review`)
      }
    }
  } finally {
    globalThis.fetch = realFetch
  }
})

await check('upgrading a previously seeded D1 keeps exact IDs, slots, moderation and seed hash', async () => {
  const migrations = join(temporary, 'old-migrations')
  await mkdir(migrations)
  const paths = (await readdir('migrations')).filter(path => path.endsWith('.sql')).sort()
  for (const path of paths.filter(path => /^(0001|0002|0003)_/.test(path))) await copyFile(join('migrations', path), join(migrations, path))
  const upgradeConfig = join(temporary, 'upgrade-wrangler.json')
  const db = 'student-upgrade-qa'
  await writeFile(upgradeConfig, JSON.stringify({
    name: db, compatibility_date: '2025-10-01',
    d1_databases: [{ binding: 'DB', database_name: db, database_id: '00000000-0000-4000-9000-000000000007', migrations_dir: migrations }],
  }))
  const target = [db, '--local', '--persist-to', join(temporary, 'upgrade-d1'), '--config', upgradeConfig]
  wrangler(['d1', 'migrations', 'apply', ...target])
  const dataset = join(temporary, 'fixture.json')
  await writeFile(dataset, JSON.stringify({ notes: original }), { mode: 0o600 })
  function seed() {
    const launched = spawnSync(process.execPath, ['scripts/seed.mjs', '--file', dataset, '--database', db, '--local', '--state', join(temporary, 'upgrade-d1'), '--config', upgradeConfig], { encoding: 'utf8' })
    assert.equal(launched.status, 0, launched.stderr)
  }
  seed()
  sql("UPDATE notes SET text='Synthetic QA moderated before upgrade.', slot=NULL, visible=0, revision=2 WHERE id='demo-001'; UPDATE state SET revision=2 WHERE id=1", target)
  const snapshot = () => ({ notes: sql('SELECT * FROM notes ORDER BY id', target), state: sql('SELECT * FROM state', target) })
  const before = snapshot()
  for (const path of paths.filter(path => !/^(0001|0002|0003)_/.test(path))) await copyFile(join('migrations', path), join(migrations, path))
  wrangler(['d1', 'migrations', 'apply', ...target])
  assert.deepEqual(snapshot(), before)
  seed()
  assert.deepEqual(snapshot(), before)
  sql("INSERT INTO notes VALUES ('qa-expanded', 'Ada Chen', 'Synthetic QA migration expansion.', 520, 520, 1, 3)", target)
  assert.deepEqual(sql('SELECT count(*) AS count, max(slot) AS maxSlot FROM notes', target), [{ count: 501, maxSlot: 520 }])
})
