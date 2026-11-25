import { purgeTrash } from '../server/submissions'

export default {
  async scheduled(_event, env) {
    await purgeTrash(env.DB)
  },
} satisfies ExportedHandler<{ DB: D1Database }>
