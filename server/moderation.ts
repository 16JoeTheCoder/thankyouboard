import { Failure, digest, type Env, type Note } from './types'
interface RawNote extends Omit<Note, 'visible'> {
  visible: number
}
interface EventRow {
  id: number
  noteId: string
  before: string | null
  after: string | null
  actor: string
  action: string
  at: string
}
const convert = (n: RawNote): Note => ({ ...n, visible: !!n.visible })
const assert = (ok: unknown, message: string): void => {
  if (!ok) throw new Failure(400, message)
}
function cleanInput(data: Record<string, unknown>) {
  for (const key of ['id', 'teacher', 'text'] as const)
    assert(
      typeof data[key] === 'string' && (data[key] as string).trim().length > 0,
      'A note needs an ID, teacher and message.',
    )
  assert(typeof data.visible === 'boolean', 'Choose a visibility setting.')
  return {
    id: data.id as string,
    teacher: data.teacher as string,
    text: data.text as string,
    visible: data.visible as boolean,
  }
}
async function readWall(db: D1Database) {
  const [state, notes, removedHidden] = await db.batch<Record<string, unknown>>(
    [
      db.prepare('SELECT revision FROM state WHERE id=1'),
      db.prepare('SELECT * FROM notes ORDER BY id'),
      db.prepare(`SELECT h.noteId FROM history h WHERE h.after IS NULL AND json_extract(h.before,'$.visible')=0
      AND h.id=(SELECT MAX(latest.id) FROM history latest WHERE latest.noteId=h.noteId)`),
    ],
  )
  return {
    archivedHidden: new Set(
      removedHidden.results.map((row) => String(row.noteId)),
    ),
    revision: Number(state.results[0].revision),
    notes: (notes.results as unknown as RawNote[]).map(convert),
  }
}
export async function overview(db: D1Database) {
  const [state, notes, events, sessions] = await db.batch<
    Record<string, unknown>
  >([
    db.prepare('SELECT revision FROM state WHERE id=1'),
    db.prepare('SELECT * FROM notes ORDER BY id'),
    db.prepare('SELECT * FROM history ORDER BY id DESC'),
    db.prepare(
      'SELECT COUNT(*) AS count FROM sessions WHERE expires>unixepoch()',
    ),
  ])
  return {
    revision: state.results[0].revision,
    notes: (notes.results as unknown as RawNote[]).map(convert),
    history: (events.results as unknown as EventRow[]).map((e) => ({
      ...e,
      before: e.before ? JSON.parse(e.before) : null,
      after: e.after ? JSON.parse(e.after) : null,
    })),
    sessions: sessions.results[0].count,
  }
}
export async function backup(db: D1Database) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    notes: (await readWall(db)).notes,
  }
}
function freeSlot(notes: Note[], id: string, preferred: number | null) {
  const occupied = new Set(
    notes.filter((n) => n.id !== id && n.visible).map((n) => n.slot),
  )
  if (preferred !== null && !occupied.has(preferred)) return preferred
  for (let i = 0; i < 500; i++) if (!occupied.has(i)) return i
  throw new Failure(
    409,
    'The wall is full. Hide a note to free a slot, then try again.',
  )
}
interface Change {
  before: Note | null
  after: Note | null
  action: string
}
function same(a: Note, b: Note) {
  return (
    a.teacher === b.teacher &&
    a.text === b.text &&
    a.visible === b.visible &&
    a.slot === b.slot &&
    a.preferredSlot === b.preferredSlot
  )
}
const validSlot = (s: unknown) =>
  Number.isInteger(s) && Number(s) >= 0 && Number(s) < 500
function recovery(
  notes: Note[],
  revision: number,
  input: unknown,
  archivedHidden: Set<string>,
) {
  const b = input as {
    version?: number
    notes?: Record<string, unknown>[]
  } | null
  if (b?.version !== 1 || !Array.isArray(b.notes))
    throw new Failure(400, 'Choose a version 1 wall backup.')
  const old = new Map(notes.map((n) => [n.id, n])),
    ids = new Set<string>(),
    slots = new Set<number>()
  const changes: Change[] = [],
    added: string[] = [],
    changed: string[] = [],
    removed: string[] = [],
    republished: string[] = []
  for (const row of b.notes) {
    if (!row || typeof row !== 'object')
      throw new Failure(400, 'Invalid backup note.')
    const basic = cleanInput(row),
      before = old.get(basic.id) || null
    assert(!ids.has(basic.id), 'Duplicate note ID in the backup.')
    assert(
      row.preferredSlot === null || validSlot(row.preferredSlot),
      'Invalid preferred slot.',
    )
    assert(
      basic.visible
        ? validSlot(row.slot) && !slots.has(Number(row.slot))
        : row.slot === null,
      'Duplicate or invalid occupied slot in the backup.',
    )
    ids.add(basic.id)
    if (basic.visible) slots.add(Number(row.slot))
    const after: Note = {
      ...basic,
      slot: row.slot as number | null,
      preferredSlot: row.preferredSlot as number | null,
      revision: revision + 1,
    }
    if (before && same(before, after)) continue
    if (before) changed.push(after.id)
    else added.push(after.id)
    if (
      after.visible &&
      (before ? !before.visible : archivedHidden.has(after.id))
    )
      republished.push(after.id)
    changes.push({ before, after, action: 'Backup restore' })
  }
  for (const before of notes)
    if (!ids.has(before.id)) {
      removed.push(before.id)
      changes.push({ before, after: null, action: 'Backup removal' })
    }
  return {
    changes,
    summary: { revision, added, changed, removed, republished },
  }
}
export async function preview(db: D1Database, input: unknown) {
  const wall = await readWall(db)
  return recovery(wall.notes, wall.revision, input, wall.archivedHidden).summary
}
async function replay(
  db: D1Database,
  id: string,
  actor: string,
  fingerprint: string,
) {
  const old = await db
    .prepare('SELECT actor,fingerprint FROM operations WHERE id=?')
    .bind(id)
    .first<{ actor: string; fingerprint: string }>()
  if (old && (old.actor !== actor || old.fingerprint !== fingerprint))
    throw new Failure(
      409,
      'This retry identifier was already used for a different operation.',
    )
  return !!old
}
function changeChunks(changes: Change[]) {
  const chunks: string[] = []
  let rows: string[] = [],
    length = 0
  for (const change of changes) {
    const row = JSON.stringify(change)
    if (rows.length && length + row.length > 125000) {
      chunks.push('[' + rows.join(',') + ']')
      rows = []
      length = 0
    }
    rows.push(row)
    length += row.length
  }
  if (rows.length) chunks.push('[' + rows.join(',') + ']')
  return chunks
}
function writeChanges(db: D1Database, changes: Change[], actor: string) {
  const chunks = changeChunks(changes),
    at = new Date().toISOString()
  // Vacate changed slots before reinserting. Each group shares one statement and the batch is atomic.
  const statements = chunks.map((chunk) =>
    db
      .prepare(
        "DELETE FROM notes WHERE id IN (SELECT json_extract(value,'$.before.id') FROM json_each(?))",
      )
      .bind(chunk),
  )
  for (const chunk of chunks) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notes(id,teacher,text,slot,preferredSlot,visible,revision)
      SELECT json_extract(value,'$.after.id'),json_extract(value,'$.after.teacher'),json_extract(value,'$.after.text'),
        json_extract(value,'$.after.slot'),json_extract(value,'$.after.preferredSlot'),json_extract(value,'$.after.visible'),
        json_extract(value,'$.after.revision') FROM json_each(?) WHERE json_type(value,'$.after')='object'`,
        )
        .bind(chunk),
    )
    statements.push(
      db
        .prepare(
          `INSERT INTO history(noteId,actor,action,at,before,after)
      SELECT COALESCE(json_extract(value,'$.after.id'),json_extract(value,'$.before.id')),?,json_extract(value,'$.action'),?,
        json_extract(value,'$.before'),json_extract(value,'$.after') FROM json_each(?)`,
        )
        .bind(actor, at, chunk),
    )
  }
  return statements
}
export async function mutate(
  env: Env,
  actor: string,
  path: string,
  data: Record<string, unknown>,
) {
  const db = env.DB,
    id = data.requestId
  if (typeof id !== 'string' || !id.trim() || id.length > 200)
    throw new Failure(400, 'A retry identifier is required.')
  const fingerprint = await digest(JSON.stringify([path, data]))
  if (await replay(db, id, actor, fingerprint)) return
  try {
    await applyChange(db, id, actor, path, data, fingerprint)
  } catch (error) {
    // A duplicate may complete between the initial lookup and any optimistic validation.
    if (await replay(db, id, actor, fingerprint)) return
    throw error
  }
}
async function applyChange(
  db: D1Database,
  id: string,
  actor: string,
  path: string,
  data: Record<string, unknown>,
  fingerprint: string,
) {
  const { revision, notes, archivedHidden } = await readWall(db)
  let changes: Change[] = []
  const extra: D1PreparedStatement[] = []
  if (path === 'sessions/revoke') extra.push(db.prepare('DELETE FROM sessions'))
  else if (path === 'restore') {
    if (data.expectedRevision !== revision)
      throw new Failure(409, 'The wall changed. Preview this backup again.')
    const plan = recovery(notes, revision, data.backup, archivedHidden)
    const confirmed = data.confirmRepublished
    if (
      !Array.isArray(confirmed) ||
      confirmed.length !== plan.summary.republished.length ||
      !plan.summary.republished.every((i) => confirmed.includes(i))
    )
      throw new Failure(
        400,
        'Confirm each hidden note that this restore would republish.',
      )
    changes = plan.changes
  } else {
    const before = notes.find((n) => n.id === data.id) || null
    if ((before?.revision || 0) !== data.expectedRevision)
      throw new Failure(
        409,
        'This note changed. Refresh its current revision before retrying.',
      )
    let next, action: string
    let preferred = before?.preferredSlot ?? null
    if (path === 'revision') {
      const event = await db
        .prepare('SELECT before,after FROM history WHERE id=? AND noteId=?')
        .bind(data.historyId, data.id)
        .first<{ before: string | null; after: string | null }>()
      const snapshot = event?.[data.side === 'before' ? 'before' : 'after']
      if (!snapshot)
        throw new Failure(400, 'Choose a revision containing a note.')
      const source = JSON.parse(snapshot) as Note
      next = cleanInput({ ...source })
      preferred = source.slot ?? source.preferredSlot
      action = 'Restore revision'
    } else {
      next = cleanInput(data)
      action = !before
        ? 'Add'
        : before.visible && !next.visible
          ? 'Hide'
          : !before.visible && next.visible
            ? 'Restore visibility'
            : before.teacher !== next.teacher
              ? 'Reassign'
              : 'Edit'
    }
    const slot = next.visible ? freeSlot(notes, next.id, preferred) : null
    const after = {
      ...next,
      slot,
      preferredSlot: slot ?? preferred,
      revision: revision + 1,
    }
    changes = [{ before, after, action }]
  }
  const statements = [
    db
      .prepare('INSERT INTO assertions SELECT revision=? FROM state WHERE id=1')
      .bind(revision),
    db.prepare('DELETE FROM assertions'),
    db
      .prepare('INSERT INTO operations VALUES (?,?,?)')
      .bind(id, actor, fingerprint),
    ...writeChanges(db, changes, actor),
    ...extra,
  ]
  statements.push(db.prepare('UPDATE state SET revision=revision+1 WHERE id=1'))
  try {
    await db.batch(statements)
  } catch {
    const latest = await db
      .prepare('SELECT revision FROM state WHERE id=1')
      .first<{ revision: number }>()
    if (latest?.revision !== revision)
      throw new Failure(
        409,
        'Another council member updated the wall. Refresh and retry.',
      )
    throw new Failure(
      503,
      'Could not verify this change. Keep your draft and retry with the same request.',
    )
  }
}
