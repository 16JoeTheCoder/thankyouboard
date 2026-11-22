// Unit checks for council roles and the mandatory Cloudflare Access sync. Uses fakes only; no network or live data.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = await mkdtemp(join(tmpdir(), 'stjbs-access-'))
try {
  const out = join(dir, 'access.mjs')
  await build({
    entryPoints: ['server/access.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: out,
    logLevel: 'silent',
  })
  const access = await import(pathToFileURL(out).href)

  const members = new Map()
  const db = {
    prepare(sql) {
      return {
        bind: (...args) => ({
          run: async () => {
            if (sql.startsWith('INSERT OR IGNORE INTO council_members'))
              members.set(args[0], { email: args[0], addedBy: args[1], addedAt: args[2] })
            if (sql.startsWith('DELETE FROM council_members')) members.delete(args[0])
          },
        }),
        all: async () => ({ results: [...members.values()] }),
        first: async () => null,
        run: async () => {},
      }
    },
  }
  const env = {
    DB: db,
    ADMIN_EMAILS: 'boss@example.org,helper@example.org',
    ACCESS_MANAGERS: 'boss@example.org',
    CF_API_TOKEN: 'token',
    CF_ACCOUNT_ID: 'acct',
    ACCESS_APP_ID: 'app',
    ACCESS_POLICY_ID: 'policy',
  }
  const manager = { email: 'boss@example.org', role: 'manager' }
  const admin = { email: 'helper@example.org', role: 'admin' }
  const viewer = { email: 'view@example.org', role: 'viewer' }
  const rejects = (promise, status, label) =>
    assert.rejects(promise, (e) => e.status === status, label)

  // Role gates
  assert.throws(() => access.requireManager(admin), (e) => e.status === 403)
  assert.throws(() => access.requireManager(viewer), (e) => e.status === 403)
  assert.doesNotThrow(() => access.requireManager(manager))
  assert.throws(() => access.requireEditor(viewer), (e) => e.status === 403)
  assert.doesNotThrow(() => access.requireEditor(admin))
  assert.doesNotThrow(() => access.requireEditor(manager))
  console.log('PASS role gates')

  // Only managers can change members or the passphrase
  await rejects(access.addMember(env, admin, { email: 'a@b.co' }, false), 403, 'admin add')
  await rejects(access.addMember(env, viewer, { email: 'a@b.co' }, false), 403, 'viewer add')
  await rejects(access.removeMember(env, viewer, { email: 'a@b.co' }, false), 403, 'viewer remove')
  await rejects(access.setPassphrase(env, viewer, { passphrase: 'long-enough-1' }), 403, 'viewer passphrase')
  await rejects(access.resetPassphrase(env, admin), 403, 'admin reset')
  console.log('PASS non-managers cannot manage access')

  // Validation
  await rejects(access.addMember(env, manager, { email: 'not-an-email' }, true), 400, 'bad email')
  await rejects(access.addMember(env, manager, { email: 'boss@example.org' }, true), 409, 'existing admin')
  await rejects(access.setPassphrase(env, manager, { passphrase: 'short' }), 400, 'short passphrase')
  await rejects(access.setPassphrase(env, manager, { passphrase: ' padded-pass ' }), 400, 'padded passphrase')
  console.log('PASS input validation')

  // Cloudflare sync is mandatory outside the demo
  const calls = []
  const realFetch = globalThis.fetch
  let mode = 'ok'
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body })
    if (mode === 'down') return new Response('{}', { status: 500 })
    if ((init.method || 'GET') === 'GET')
      return Response.json({ result: { name: 'Named council admins', decision: 'allow' } })
    return Response.json({ success: true })
  }
  try {
    const bare = { ...env, CF_API_TOKEN: undefined }
    await rejects(access.addMember(bare, manager, { email: 'new@example.org' }, false), 503, 'unconfigured')
    assert.equal(members.size, 0, 'nothing saved when sync is unconfigured')

    mode = 'down'
    await rejects(access.addMember(env, manager, { email: 'new@example.org' }, false), 502, 'sync failure')
    assert.equal(members.size, 0, 'nothing saved when Cloudflare rejects the update')

    mode = 'ok'
    calls.length = 0
    await access.addMember(env, manager, { email: ' New@Example.org ' }, false)
    assert.ok(members.has('new@example.org'), 'member stored lowercase')
    const put = calls.find((c) => c.method === 'PUT')
    assert.ok(put?.url.endsWith('/accounts/acct/access/apps/app/policies/policy'))
    const emails = JSON.parse(put.body).include.map((i) => i.email.email).sort()
    assert.deepEqual(emails, ['boss@example.org', 'helper@example.org', 'new@example.org'])
    assert.equal(JSON.parse(put.body).decision, 'allow')

    mode = 'down'
    await rejects(access.removeMember(env, manager, { email: 'new@example.org' }, false), 502, 'remove failure')
    assert.ok(members.has('new@example.org'), 'member kept when Cloudflare rejects removal')

    mode = 'ok'
    calls.length = 0
    await access.removeMember(env, manager, { email: 'new@example.org' }, false)
    assert.equal(members.size, 0)
    const after = JSON.parse(calls.find((c) => c.method === 'PUT').body).include.map((i) => i.email.email).sort()
    assert.deepEqual(after, ['boss@example.org', 'helper@example.org'], 'administrators always stay on the policy')

    calls.length = 0
    await access.addMember(env, manager, { email: 'demo@example.org' }, true)
    assert.equal(calls.length, 0, 'the local demo never calls Cloudflare')
  } finally {
    globalThis.fetch = realFetch
  }
  console.log('PASS Cloudflare sync is mandatory and fail-safe')
} finally {
  await rm(dir, { recursive: true, force: true })
}
