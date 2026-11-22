import { adminIdentity } from '../../server/auth'
import { Failure, isDemo, privateHeaders, type Env } from '../../server/types'
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!isDemo(request, env)) await adminIdentity(request, env)
    const asset = await (env as Env & { ASSETS: Fetcher }).ASSETS.fetch(
      new URL('/index.html', request.url),
    )
    return new Response(asset.body, {
      status: asset.status,
      headers: { ...Object.fromEntries(asset.headers), ...privateHeaders },
    })
  } catch (e) {
    return new Response(
      e instanceof Failure ? e.message : 'Council access unavailable.',
      {
        status: e instanceof Failure ? e.status : 503,
        headers: privateHeaders,
      },
    )
  }
}
