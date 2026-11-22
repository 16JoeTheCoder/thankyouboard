export interface Env {
  DB: D1Database
  TEACHER_PASSPHRASE?: string
  SESSION_SECRET?: string
  ADMIN_HOST?: string
  ACCESS_ISSUER?: string
  ACCESS_AUD?: string
  ADMIN_EMAILS?: string
  /** Comma-separated emails (a subset of ADMIN_EMAILS) who may manage council members and the passphrase. */
  ACCESS_MANAGERS?: string
  /** Optional: lets the Access view keep the Cloudflare Access allow policy in step with council members. */
  CF_API_TOKEN?: string
  CF_ACCOUNT_ID?: string
  ACCESS_APP_ID?: string
  ACCESS_POLICY_ID?: string
  LOCAL_DEMO?: string
  DEDICATION?: string
}
export interface Note {
  id: string
  teacher: string
  text: string
  slot: number | null
  preferredSlot: number | null
  visible: boolean
  revision: number
}
export class Failure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}
export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: { ...privateHeaders, ...headers },
  })
}
export function isDemo(request: Request, env: Env) {
  return (
    env.LOCAL_DEMO === 'isolated-loopback' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)
  )
}
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
export function cookie(request: Request, key: string) {
  return (
    (request.headers.get('Cookie') || '')
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(key + '='))
      ?.slice(key.length + 1) || ''
  )
}
export function makeCookie(
  request: Request,
  env: Env,
  name: string,
  value: string,
  age: number,
) {
  return (
    name +
    '=' +
    value +
    '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
    age +
    (isDemo(request, env) ? '' : '; Secure')
  )
}
