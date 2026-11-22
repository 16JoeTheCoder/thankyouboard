import { adminSession, logout, teacher, unlock } from '../../server/auth'
import {
  accessState,
  addMember,
  removeMember,
  requireEditor,
  resetPassphrase,
  setPassphrase,
} from '../../server/access'
import { backup, mutate, overview, preview } from '../../server/moderation'
import {
  digest,
  Failure,
  isDemo,
  json,
  makeCookie,
  privateHeaders,
  type Env,
} from '../../server/types'

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '')
  const demo = isDemo(request, env)
  try {
    const post = request.method === 'POST'
    if (!post && request.method !== 'GET')
      throw new Failure(405, 'Method unavailable.')
    if (
      post &&
      ((request.headers.has('origin') &&
        request.headers.get('origin') !== url.origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site')
    )
      throw new Failure(403, 'Submit from the wall itself.')
    async function body(): Promise<Record<string, unknown>> {
      if (
        !request.headers
          .get('content-type')
          ?.toLowerCase()
          .startsWith('application/json')
      )
        throw new Failure(415, 'Send a JSON request.')
      try {
        const obj = await request.json()
        if (!obj || typeof obj !== 'object' || Array.isArray(obj))
          throw new Error()
        return obj as Record<string, unknown>
      } catch {
        throw new Failure(400, 'The request did not contain a JSON object.')
      }
    }
    const dedication =
      env.DEDICATION ||
      'For the teachers who see us, encourage us, and help us grow. These are the words we wanted you to keep.'
    async function board() {
      const revision = Number(
        await env.DB.prepare('SELECT revision FROM state WHERE id=1').first(
          'revision',
        ),
      )
      if (request.headers.get('if-none-match') === '"' + revision + '"')
        return new Response(null, {
          status: 304,
          headers: { ...privateHeaders, ETag: '"' + revision + '"' },
        })
      const [current, notes] = await env.DB.batch<Record<string, unknown>>([
        env.DB.prepare('SELECT revision FROM state WHERE id=1'),
        env.DB.prepare(
          'SELECT id,teacher,text,slot,revision FROM notes WHERE visible=1 ORDER BY slot',
        ),
      ])
      return json(
        { revision: current.results[0].revision, notes: notes.results },
        200,
        { ETag: '"' + current.results[0].revision + '"' },
      )
    }
    if (path === 'session' && !post)
      return json({
        authenticated: await teacher(request, env),
        demo,
        ...(demo ? { demoPassphrase: env.TEACHER_PASSPHRASE } : {}),
        dedication,
      })
    if (path === 'unlock' && post)
      return json({ ok: true }, 200, {
        'Set-Cookie': await unlock(request, env, (await body()).passphrase),
      })
    if (path === 'logout' && post)
      return json({ ok: true }, 200, {
        'Set-Cookie': await logout(request, env),
      })
    if (path === 'demo/admin' && post && demo && env.SESSION_SECRET)
      return json({ ok: true }, 200, {
        'Set-Cookie': makeCookie(
          request,
          env,
          'demo_admin',
          await digest('demo-admin:' + env.SESSION_SECRET),
          28800,
        ),
      })
    if (path === 'board' && !post) {
      if (!(await teacher(request, env)))
        throw new Failure(401, 'Unlock the wall to read its notes.')
      return board()
    }
    if (path === 'admin' || path.startsWith('admin/')) {
      const session = await adminSession(request, env),
        identity = session.email
      if (!post && path === 'admin')
        return json({
          identity,
          role: session.role,
          demo,
          ...(await overview(env.DB)),
        })
      if (!post && path === 'admin/access')
        return json(await accessState(env, session))
      if (!post && path === 'admin/board') return board()
      if (!post && path === 'admin/wall-session')
        return json({ authenticated: true, demo, council: true, dedication })
      if (post && path === 'admin/members/add') {
        await addMember(env, session, await body(), demo)
        return json({ ok: true })
      }
      if (post && path === 'admin/members/remove') {
        await removeMember(env, session, await body(), demo)
        return json({ ok: true })
      }
      if (post && path === 'admin/passphrase') {
        await setPassphrase(env, session, await body())
        return json({ ok: true })
      }
      if (post && path === 'admin/passphrase/reset') {
        await resetPassphrase(env, session)
        return json({ ok: true })
      }
      if (!post && path === 'admin/backup') return json(await backup(env.DB))
      if (post && path === 'admin/restore/preview')
        return json(await preview(env.DB, (await body()).backup))
      if (
        post &&
        [
          'admin/notes',
          'admin/revision',
          'admin/restore',
          'admin/sessions/revoke',
        ].includes(path)
      ) {
        requireEditor(session)
        await mutate(env, identity, path.slice(6), await body())
        return json({ ok: true })
      }
    }
    throw new Failure(404, 'Route unavailable.')
  } catch (e) {
    return json(
      {
        error:
          e instanceof Failure
            ? e.message
            : 'Could not complete the request. Please retry.',
        demo,
      },
      e instanceof Failure ? e.status : 503,
    )
  }
}
