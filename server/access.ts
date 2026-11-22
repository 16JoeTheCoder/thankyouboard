import { appPassphrase, hashPassphrase, type AdminSession } from './auth'
import { Failure, type Env } from './types'

const emailPattern = /^[^\s@,]{1,64}@[^\s@,]{1,190}\.[^\s@,]{2,}$/
const list = (value?: string) =>
  (value || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
async function viewKey(env: Env) {
  if (!env.SESSION_SECRET) throw new Failure(503, 'Teacher access is not configured.')
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('passphrase-view:' + env.SESSION_SECRET),
    ),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  )
}
async function seal(env: Env, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await viewKey(env),
    new TextEncoder().encode(value),
  )
  return { enc: b64(new Uint8Array(enc)), iv: b64(iv) }
}
/** Lets access managers read the active teacher passphrase. */
export async function viewPassphrase(env: Env, session: AdminSession) {
  requireManager(session)
  const stored = await appPassphrase(env)
  if (!stored) {
    if (!env.TEACHER_PASSPHRASE)
      throw new Failure(404, 'No teacher passphrase is set.')
    return { passphrase: env.TEACHER_PASSPHRASE, source: 'deployment' }
  }
  if (!stored.enc || !stored.iv)
    throw new Failure(
      409,
      'This passphrase was saved before viewing was available. Set it again to view it.',
    )
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(stored.iv) },
      await viewKey(env),
      unb64(stored.enc),
    )
    return { passphrase: new TextDecoder().decode(plain), source: 'app' }
  } catch {
    throw new Failure(
      409,
      'The saved passphrase could not be read. Set a new one.',
    )
  }
}
export function requireManager(session: AdminSession) {
  if (session.role !== 'manager')
    throw new Failure(
      403,
      'Only access managers can change council members or the passphrase.',
    )
}
export function requireEditor(session: AdminSession) {
  if (session.role === 'viewer')
    throw new Failure(403, 'Your council access is read-only.')
}

export function syncConfigured(env: Env) {
  return !!(
    env.CF_API_TOKEN &&
    env.CF_ACCOUNT_ID &&
    env.ACCESS_APP_ID &&
    env.ACCESS_POLICY_ID
  )
}

export async function accessState(env: Env, session: AdminSession) {
  const base = { role: session.role, email: session.email }
  if (session.role !== 'manager') return base
  const [members, setting] = await Promise.all([
    env.DB.prepare(
      'SELECT email,addedBy,addedAt FROM council_members ORDER BY addedAt DESC,email',
    ).all<{ email: string; addedBy: string; addedAt: string }>(),
    env.DB.prepare(
      "SELECT updatedBy,updatedAt FROM settings WHERE key='teacher_passphrase'",
    ).first<{ updatedBy: string; updatedAt: string }>(),
  ])
  return {
    ...base,
    managers: list(env.ACCESS_MANAGERS),
    admins: list(env.ADMIN_EMAILS),
    members: members.results,
    passphrase: setting
      ? { source: 'app', ...setting }
      : { source: 'deployment' },
    sync: syncConfigured(env),
  }
}

/** Replaces the Cloudflare Access allow list so it always matches the app's allowlist. Required for every member change. */
async function syncPolicy(env: Env, members: string[]) {
  if (!syncConfigured(env))
    throw new Failure(
      503,
      'Cloudflare Access sync is not configured, so council members cannot be changed yet.',
    )
  const emails = Array.from(new Set([...list(env.ADMIN_EMAILS), ...members]))
  const url =
    'https://api.cloudflare.com/client/v4/accounts/' +
    env.CF_ACCOUNT_ID +
    '/access/apps/' +
    env.ACCESS_APP_ID +
    '/policies/' +
    env.ACCESS_POLICY_ID
  const headers = {
    Authorization: 'Bearer ' + env.CF_API_TOKEN,
    'Content-Type': 'application/json',
  }
  const fail = () =>
    new Failure(
      502,
      'Could not update Cloudflare Access. Nothing was changed. Please retry.',
    )
  try {
    const current = await fetch(url, { headers })
    if (!current.ok) throw fail()
    const policy = (await current.json()) as {
      result?: { name?: string; decision?: string }
    }
    if (!policy.result?.name || policy.result.decision !== 'allow') throw fail()
    const saved = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        name: policy.result.name,
        decision: 'allow',
        include: emails.map((email) => ({ email: { email } })),
      }),
    })
    if (!saved.ok) throw fail()
  } catch (e) {
    throw e instanceof Failure ? e : fail()
  }
}
async function currentMembers(env: Env) {
  return (
    await env.DB.prepare('SELECT email FROM council_members').all<{
      email: string
    }>()
  ).results.map((m) => m.email)
}

export async function addMember(
  env: Env,
  session: AdminSession,
  data: Record<string, unknown>,
  demo: boolean,
) {
  requireManager(session)
  const email =
    typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  if (!emailPattern.test(email))
    throw new Failure(400, 'Enter a full Google email address.')
  if (list(env.ADMIN_EMAILS).includes(email))
    throw new Failure(409, 'That address is already a full administrator.')
  const existing = await currentMembers(env)
  if (existing.length >= 100 && !existing.includes(email))
    throw new Failure(400, 'The council list is full. Remove someone first.')
  if (!demo) await syncPolicy(env, [...existing, email])
  await env.DB.prepare(
    'INSERT OR IGNORE INTO council_members(email,addedBy,addedAt) VALUES (?,?,?)',
  )
    .bind(email, session.email, new Date().toISOString())
    .run()
}
export async function removeMember(
  env: Env,
  session: AdminSession,
  data: Record<string, unknown>,
  demo: boolean,
) {
  requireManager(session)
  const email =
    typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  if (!email) throw new Failure(400, 'Choose a member to remove.')
  if (!demo)
    await syncPolicy(
      env,
      (await currentMembers(env)).filter((m) => m !== email),
    )
  await env.DB.prepare('DELETE FROM council_members WHERE email=?')
    .bind(email)
    .run()
}

export async function setPassphrase(
  env: Env,
  session: AdminSession,
  data: Record<string, unknown>,
) {
  requireManager(session)
  const value = data.passphrase
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 100 ||
    !value.trim() ||
    value !== value.trim()
  )
    throw new Failure(
      400,
      'Use 8 to 100 characters with no spaces at the start or end.',
    )
  const salt = crypto.randomUUID(),
    iter = 100000,
    hash = await hashPassphrase(value, salt, iter)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO settings(key,value,updatedBy,updatedAt) VALUES ('teacher_passphrase',?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`,
    ).bind(
      JSON.stringify({ salt, hash, iter, ...(await seal(env, value)) }),
      session.email,
      new Date().toISOString(),
    ),
    env.DB.prepare('DELETE FROM sessions'),
  ])
}
export async function resetPassphrase(env: Env, session: AdminSession) {
  requireManager(session)
  if (!env.TEACHER_PASSPHRASE)
    throw new Failure(
      409,
      'There is no deployment passphrase to return to. Set a new one instead.',
    )
  await env.DB.batch([
    env.DB.prepare("DELETE FROM settings WHERE key='teacher_passphrase'"),
    env.DB.prepare('DELETE FROM sessions'),
  ])
}
export { appPassphrase }
