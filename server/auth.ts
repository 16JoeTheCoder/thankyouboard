import { createRemoteJWKSet, jwtVerify } from 'jose'
import { Failure, cookie, digest, isDemo, makeCookie, type Env } from './types'
const day = 86400
const now = () => Math.floor(Date.now() / 1000)
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
function deployment(request: Request, env: Env) {
  if (
    !isDemo(request, env) &&
    (new URL(request.url).protocol !== 'https:' ||
      new URL(request.url).hostname !== env.ADMIN_HOST)
  )
    throw new Failure(403, 'Open the wall at its configured school address.')
}
export type Role = 'manager' | 'admin' | 'viewer'
export interface AdminSession {
  email: string
  role: Role
}
const list = (value?: string) =>
  (value || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
async function roleFor(env: Env, email: string): Promise<Role | null> {
  const mail = email.toLowerCase()
  const admins = list(env.ADMIN_EMAILS)
  if (admins.includes(mail))
    return list(env.ACCESS_MANAGERS).includes(mail) ? 'manager' : 'admin'
  try {
    if (
      await env.DB.prepare('SELECT 1 FROM council_members WHERE email=?')
        .bind(mail)
        .first()
    )
      return 'viewer'
  } catch {
    /* Before migration 0003 only the configured administrators have access. */
  }
  return null
}
export async function adminIdentity(request: Request, env: Env) {
  return (await adminSession(request, env)).email
}
export async function adminSession(
  request: Request,
  env: Env,
): Promise<AdminSession> {
  deployment(request, env)
  if (isDemo(request, env)) {
    if (
      env.SESSION_SECRET &&
      cookie(request, 'demo_admin') ===
        (await digest('demo-admin:' + env.SESSION_SECRET))
    )
      return { email: 'council@example.invalid', role: 'manager' }
    throw new Failure(401, 'Enter the local council demo to continue.')
  }
  const issuer = env.ACCESS_ISSUER
  if (
    !issuer ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
    !env.ACCESS_AUD ||
    !env.ADMIN_EMAILS
  )
    throw new Failure(403, 'Council access is not configured.')
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!jwt)
    throw new Failure(403, 'Sign in with your approved council Google account.')
  try {
    if (!keys.has(issuer))
      keys.set(
        issuer,
        createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs')),
      )
    const { payload } = await jwtVerify(jwt, keys.get(issuer)!, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'email', 'sub'],
    })
    if (typeof payload.email === 'string') {
      const role = await roleFor(env, payload.email)
      if (role) return { email: payload.email.toLowerCase(), role }
    }
  } catch {
    /* Present the same public error for all invalid assertions. */
  }
  throw new Failure(403, 'This account does not have council access.')
}
export interface StoredPassphrase {
  salt: string
  hash: string
  iter: number
  /** AES-GCM copy (base64) so access managers can view it; absent for passphrases saved before viewing existed. */
  enc?: string
  iv?: string
}
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  )
export async function hashPassphrase(
  passphrase: string,
  salt: string,
  iter: number,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: new TextEncoder().encode(salt),
        iterations: iter,
      },
      key,
      256,
    ),
  )
}
/** The passphrase chosen in the Access view, if any. Without one the deployment secret applies. */
export async function appPassphrase(
  env: Env,
): Promise<StoredPassphrase | null> {
  try {
    const value = await env.DB.prepare(
      "SELECT value FROM settings WHERE key='teacher_passphrase'",
    ).first<string>('value')
    return value ? (JSON.parse(value) as StoredPassphrase) : null
  } catch {
    return null // Before migration 0003 the deployment secret remains in force.
  }
}
async function sessionKey(
  request: Request,
  env: Env,
  token: string,
  stored: StoredPassphrase | null,
) {
  deployment(request, env)
  if (!env.SESSION_SECRET || (!stored && !env.TEACHER_PASSPHRASE))
    throw new Failure(503, 'Teacher access is not configured.')
  return digest(
    JSON.stringify([
      env.SESSION_SECRET,
      stored ? 'app:' + stored.hash : env.TEACHER_PASSPHRASE,
      token,
    ]),
  )
}
export async function teacher(request: Request, env: Env) {
  deployment(request, env)
  const token = cookie(request, 'wall_session')
  if (!token) return false
  return !!(await env.DB.prepare(
    'SELECT 1 FROM sessions WHERE token=? AND expires>?',
  )
    .bind(
      await sessionKey(request, env, token, await appPassphrase(env)),
      now(),
    )
    .first())
}
export async function unlock(request: Request, env: Env, passphrase: unknown) {
  const stored = await appPassphrase(env),
    token = crypto.randomUUID() + crypto.randomUUID(),
    key = await sessionKey(request, env, token, stored)
  const ip = await digest(
    env.SESSION_SECRET +
      ':' +
      (request.headers.get('CF-Connecting-IP') || 'local'),
  )
  const time = now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE until_time<=?').bind(time),
    env.DB.prepare('DELETE FROM sessions WHERE expires<=?').bind(time),
  ])
  const row = await env.DB.prepare(
    'INSERT INTO attempts VALUES (?,?,1) ON CONFLICT(ip) DO UPDATE SET attempts=attempts+1 RETURNING attempts',
  )
    .bind(ip, time + 600)
    .first<{ attempts: number }>()
  if (!row || row.attempts > 10)
    throw new Failure(429, 'Too many attempts. Try again in ten minutes.')
  if (
    typeof passphrase !== 'string' ||
    passphrase.length > 200 ||
    (stored
      ? (await hashPassphrase(passphrase, stored.salt, stored.iter)) !==
        stored.hash
      : (await digest(passphrase)) !== (await digest(env.TEACHER_PASSPHRASE!)))
  )
    throw new Failure(401, 'That passphrase did not match. Please try again.')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE ip=?').bind(ip),
    env.DB.prepare('INSERT INTO sessions VALUES (?,?)').bind(
      key,
      time + 30 * day,
    ),
  ])
  return makeCookie(request, env, 'wall_session', token, 30 * day)
}
export async function logout(request: Request, env: Env) {
  await env.DB.prepare('DELETE FROM sessions WHERE token=?')
    .bind(
      await sessionKey(
        request,
        env,
        cookie(request, 'wall_session'),
        await appPassphrase(env),
      ),
    )
    .run()
  return makeCookie(request, env, 'wall_session', '', 0)
}
