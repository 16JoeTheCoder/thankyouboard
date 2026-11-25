import { cookie, digest, Failure, type Env } from './types'

// Reads enforce the deadline even between scheduled maintenance runs.
const lifetime = 30 * 24 * 60 * 60
export async function purgeTrash(db: D1Database) {
  await db
    .prepare(
      "DELETE FROM student_submissions WHERE status='rejected' AND reviewedAt<=unixepoch()-?",
    )
    .bind(lifetime)
    .run()
}

export async function submit(
  env: Env,
  request: Request,
  input: Record<string, unknown>,
) {
  const { id, teacher, text } = input
  if (
    typeof id !== 'string' ||
    !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
  )
    throw new Failure(400, 'Start a new note and try again.')
  if (
    typeof teacher !== 'string' ||
    !teacher.trim() ||
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > 4000
  )
    throw new Failure(
      400,
      'Choose a teacher and write a note of up to 4,000 characters.',
    )
  if (!env.SESSION_SECRET)
    throw new Failure(503, 'Student submissions are temporarily unavailable.')
  const network = await digest(
    JSON.stringify([
      env.SESSION_SECRET,
      'student',
      request.headers.get('CF-Connecting-IP') || 'local',
    ]),
  )
  // A school may put hundreds of student browsers behind a single IP.
  const browser = cookie(request, 'student_device')
  const sender =
    network + '.' + (/^[a-f0-9-]{36}$/i.test(browser) ? browser : 'unknown')
  const fingerprint = await digest(JSON.stringify([teacher, text]))
  const result = await env.DB.prepare(
    `INSERT INTO student_submissions(id,teacher,text,fingerprint,sender)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM notes WHERE teacher=?)
    AND (SELECT COUNT(*) FROM student_submissions WHERE sender=? AND submittedAt>unixepoch()-600)<12
    AND (SELECT COUNT(*) FROM student_submissions WHERE sender>=? AND sender<? AND submittedAt>unixepoch()-600)<300
    ON CONFLICT(id) DO NOTHING`,
  )
    .bind(
      id,
      teacher,
      text,
      fingerprint,
      sender,
      teacher,
      sender,
      network + '.',
      network + '/',
    )
    .run()
  if (result.meta.changes) return
  const prior = await env.DB.prepare(
    'SELECT fingerprint FROM student_submissions WHERE id=?',
  )
    .bind(id)
    .first('fingerprint')
  if (prior === fingerprint) return
  if (prior)
    throw new Failure(409, 'Start a new note before changing this submission.')
  if (
    !(await env.DB.prepare('SELECT 1 FROM notes WHERE teacher=? LIMIT 1')
      .bind(teacher)
      .first())
  )
    throw new Failure(400, 'Choose a teacher from the current list.')
  throw new Failure(
    429,
    'Too many notes from this connection. Try again in ten minutes.',
  )
}

export async function reviewQueue(db: D1Database) {
  await purgeTrash(db)
  const rows = await db
    .prepare(
      `SELECT id,teacher,text,status,revision,submittedAt,reviewedAt,reviewer,
    reviewedAt+? AS expiresAt FROM student_submissions
    WHERE status='pending' OR (status='rejected' AND reviewedAt>unixepoch()-?)
    ORDER BY CASE WHEN status='pending' THEN submittedAt ELSE -reviewedAt END,id`,
    )
    .bind(lifetime, lifetime)
    .all()
  return {
    pending: rows.results.filter((r) => r.status === 'pending'),
    trash: rows.results.filter((r) => r.status === 'rejected'),
  }
}

export async function review(
  db: D1Database,
  actor: string,
  data: Record<string, unknown>,
) {
  const { id, action, revision } = data
  if (
    typeof id !== 'string' ||
    !Number.isSafeInteger(revision) ||
    typeof action !== 'string' ||
    !['approve', 'reject', 'restore'].includes(action)
  )
    throw new Failure(400, 'Select a current submission and review action.')
  const source = action === 'restore' ? 'rejected' : 'pending'
  const target =
    action === 'approve'
      ? 'approved'
      : action === 'reject'
        ? 'rejected'
        : 'pending'
  const match =
    "id=? AND revision=? AND status=? AND (status<>'rejected' OR reviewedAt>unixepoch()-" +
    lifetime +
    ')'
  const guard = [id, Number(revision), source]
  const writes: D1PreparedStatement[] = []
  if (action === 'approve') {
    const noteId = 'student-' + id
    // All statements share one D1 transaction; a concurrent decision changes the guard.
    writes.push(
      db
        .prepare(
          `WITH free(slot) AS (
      SELECT CASE WHEN EXISTS(SELECT 1 FROM notes WHERE slot=0) THEN
        (SELECT MIN(n.slot+1) FROM notes n WHERE n.slot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notes occupied WHERE occupied.slot=n.slot+1))
        ELSE 0 END)
      INSERT INTO notes(id,teacher,text,slot,preferredSlot,visible,revision)
      SELECT ?,s.teacher,s.text,f.slot,f.slot,1,(SELECT revision+1 FROM state WHERE id=1)
      FROM (SELECT * FROM student_submissions WHERE ${match}) s CROSS JOIN free f`,
        )
        .bind(noteId, ...guard),
      db
        .prepare(
          `INSERT INTO history(noteId,actor,action,at,before,after)
        SELECT n.id,?,'Approve student note',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NULL,
        json_object('id',n.id,'teacher',n.teacher,'text',n.text,'slot',n.slot,'preferredSlot',n.preferredSlot,'visible',json('true'),'revision',n.revision)
        FROM notes n WHERE n.id=? AND EXISTS(SELECT 1 FROM student_submissions WHERE ${match})`,
        )
        .bind(actor, noteId, ...guard),
      db
        .prepare(
          `UPDATE state SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM student_submissions WHERE ${match})`,
        )
        .bind(...guard),
    )
  }
  writes.push(
    db
      .prepare(
        `UPDATE student_submissions SET status=?,reviewer=?,reviewedAt=unixepoch(),revision=revision+1,
    text=CASE WHEN ?='approved' THEN '' ELSE text END WHERE ${match}`,
      )
      .bind(target, actor, target, ...guard),
  )
  const result = await db.batch(writes)
  if (result[result.length - 1].meta.changes) return
  const current = await db
    .prepare(
      'SELECT status,revision,reviewer FROM student_submissions WHERE id=?',
    )
    .bind(id)
    .first()
  if (
    current?.status === target &&
    current.revision === Number(revision) + 1 &&
    current.reviewer === actor
  )
    return
  throw new Failure(
    409,
    'This submission changed or expired. Refresh the review list.',
  )
}
