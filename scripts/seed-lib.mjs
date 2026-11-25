import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

export function wrangler(args, options = {}) {
  const child = spawnSync(
    process.execPath,
    [resolve('node_modules/wrangler/bin/wrangler.js'), ...args],
    { stdio: 'inherit', ...options },
  )
  if (child.error || child.status !== 0)
    throw new Error('Wrangler did not complete the requested operation.')
}

export function seed(input, dbArgs) {
  const rows = input?.notes
  if (!Array.isArray(rows) || rows.length < 500)
    throw new Error('At least 500 notes are required.')
  const ids = new Set(),
    counts = new Map()
  const notes = rows
    .map((n) => {
      if (
        !n ||
        !['id', 'teacher', 'text'].every(
          (k) =>
            typeof n[k] === 'string' && n[k].trim() && !n[k].includes('\0'),
        )
      )
        throw new Error(
          'Each note needs a nonempty ID, display name and message.',
        )
      if (ids.has(n.id)) throw new Error('Note IDs must be unique.')
      ids.add(n.id)
      counts.set(n.teacher, (counts.get(n.teacher) || 0) + 1)
      return { id: n.id, teacher: n.teacher, text: n.text }
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (counts.size !== 41 || [...counts.values()].some((n) => n < 3))
    throw new Error(
      'Expected 41 teachers and at least three notes per teacher.',
    )
  const hash = createHash('sha256').update(JSON.stringify(notes)).digest('hex')
  const quote = (s) => "'" + s.replaceAll("'", "''") + "'"
  const sql =
    notes
      .map(
        (n, i) =>
          'INSERT OR IGNORE INTO seed_stage VALUES (' +
          [quote(hash), i, quote(n.id), quote(n.teacher), quote(n.text)].join(
            ',',
          ) +
          ');',
      )
      .join('\n') +
    '\nINSERT INTO seed_publish VALUES (' +
    quote(hash) +
    ');\n'
  const dir = mkdtempSync(join(tmpdir(), 'wall-seed-'))
  try {
    const file = join(dir, 'seed.sql')
    writeFileSync(file, sql, { mode: 0o600 })
    // Wrangler error diagnostics may quote failing SQL. Never inherit private import output.
    wrangler(['d1', 'execute', ...dbArgs, '--file', file, '--yes'], {
      stdio: 'ignore',
      env: {
        ...process.env,
        WRANGLER_LOG: 'none',
        WRANGLER_LOG_PATH: join(dir, 'wrangler.log'),
        WRANGLER_SEND_METRICS: 'false',
      },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`Seed verified: ${rows.length} distinct notes, 41 teachers.`)
}
