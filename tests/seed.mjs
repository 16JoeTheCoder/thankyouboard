import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fixture } from '../scripts/fixture.mjs'

const dir = mkdtempSync(join(tmpdir(), 'stjbs-seed-check-'))
const input = join(dir, 'synthetic.json')
const cfg = join(dir, 'wrangler.json')
const database = 'seed-check'
const target = [database, '--local', '--persist-to', dir, '--config', cfg]
const dataset = fixture()

function run(args, success = true) {
  const child = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(dir, 'wrangler.log') },
  })
  assert.equal(child.status === 0, success, child.stderr || 'Unexpected command status')
  return child.stdout
}

function importData(data, success = true) {
  writeFileSync(input, JSON.stringify(data), { mode: 0o600 })
  run(['scripts/seed.mjs', '--file', input, '--database', database, '--local', '--state', dir, '--config', cfg], success)
}

function sql(statement) {
  const output = run(['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', ...target, '--command', statement, '--json'])
  return JSON.parse(output)[0].results
}

try {
  writeFileSync(cfg, JSON.stringify({
    name: database, compatibility_date: '2025-10-01',
    d1_databases: [{ binding: 'DB', database_name: database, database_id: '00000000-0000-4000-9000-000000000002', migrations_dir: resolve('migrations') }],
  }))
  run(['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', ...target])
  importData({ notes: dataset.notes.slice(1) }, false)
  const duplicate = structuredClone(dataset)
  duplicate.notes[0].id = duplicate.notes[1].id
  importData(duplicate, false)
  const lowCoverage = structuredClone(dataset)
  lowCoverage.notes[55].teacher = lowCoverage.notes[0].teacher
  importData(lowCoverage, false)
  assert.equal(sql('SELECT count(*) AS n FROM notes')[0].n, 0)
  importData(dataset)
  const first = dataset.notes[0]
  assert.deepEqual(sql("SELECT teacher, text FROM notes WHERE id='demo-001'")[0], { teacher: first.teacher, text: first.text })
  sql("UPDATE notes SET text='A moderated message', visible=0, slot=NULL WHERE id='demo-001'")
  importData({ notes: [...dataset.notes].reverse() })
  const changed = structuredClone(dataset)
  changed.notes[0].text += ' Changed input.'
  importData(changed, false)
  assert.deepEqual(sql("SELECT text, visible, slot FROM notes WHERE id='demo-001'")[0], {text:'A moderated message',visible:0,slot:null})
  assert.deepEqual(sql('SELECT count(*) AS notes, count(DISTINCT teacher) AS teachers, count(DISTINCT preferredSlot) AS slots FROM notes')[0], {notes:500,teachers:41,slots:500})
  console.log('PASS private seed validation, atomic first publication, exact text and idempotent moderation preservation')
} finally {
  rmSync(dir, { recursive:true, force:true })
}
