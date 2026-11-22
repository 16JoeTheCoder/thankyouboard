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
export async function adminIdentity(request: Request, env: Env) {
  deployment(request, env)
  if (isDemo(request, env)) {
    if (
      env.SESSION_SECRET &&
      cookie(request, 'demo_admin') ===
        (await digest('demo-admin:' + env.SESSION_SECRET))
    )
      return 'council@example.invalid'
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
    if (
      typeof payload.email === 'string' &&
      env.ADMIN_EMAILS.split(',')
        .map((e) => e.trim().toLowerCase())
        .includes(payload.email.toLowerCase())
    )
      return payload.email.toLowerCase()
  } catch {
    /* Present the same public error for all invalid assertions. */
  }
  throw new Failure(403, 'This account does not have council access.')
}
async function sessionKey(request: Request, env: Env, token: string) {
  deployment(request, env)
  if (!env.SESSION_SECRET || !env.TEACHER_PASSPHRASE)
    throw new Failure(503, 'Teacher access is not configured.')
  return digest(
    JSON.stringify([env.SESSION_SECRET, env.TEACHER_PASSPHRASE, token]),
  )
}
export async function teacher(request: Request, env: Env) {
  deployment(request, env)
  const token = cookie(request, 'wall_session')
  if (!token) return false
  return !!(await env.DB.prepare(
    'SELECT 1 FROM sessions WHERE token=? AND expires>?',
  )
    .bind(await sessionKey(request, env, token), now())
    .first())
}
export async function unlock(request: Request, env: Env, passphrase: unknown) {
  const token = crypto.randomUUID() + crypto.randomUUID(),
    key = await sessionKey(request, env, token)
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
    (await digest(passphrase)) !== (await digest(env.TEACHER_PASSPHRASE!))
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
    .bind(await sessionKey(request, env, cookie(request, 'wall_session')))
    .run()
  return makeCookie(request, env, 'wall_session', '', 0)
}
