import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
  readdirSync,
  symlinkSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixture } from './fixture.mjs'
import { seed, wrangler } from './seed-lib.mjs'
const args = process.argv.slice(2)
const value = (flag, fallback) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback
const state = resolve(value('--state', '.wrangler/synthetic-demo')),
  port = value('--port', '8788')
if (!/^\d+$/.test(port) || +port < 1 || +port > 65535)
  throw new Error('Choose a valid local port.')
mkdirSync(state, { recursive: true, mode: 0o700 })
const marker = join(state, 'teacher-wall-local-demo'),
  persist = join(state, 'd1-state')
if (!existsSync(marker) && readdirSync(state).length)
  throw new Error(
    'Choose an empty directory or an existing wall demo directory.',
  )
if (!existsSync(marker))
  writeFileSync(marker, randomBytes(32).toString('hex'), { mode: 0o600 })
if (args.includes('--reset')) rmSync(persist, { recursive: true, force: true })
process.env.WRANGLER_LOG_PATH = join(state, 'wrangler.log')
process.env.WRANGLER_SEND_METRICS = 'false'
process.env.XDG_CONFIG_HOME = join(state, 'config')
// Pages discovers its project configuration from ancestor paths. Keep the launcher
// outside the production checkout, even when persistent D1 state lives inside it.
const project = mkdtempSync(
  join(realpathSync.native(tmpdir()), 'stjbs-demo-project-'),
)
process.on('exit', () => rmSync(project, { recursive: true, force: true }))
const config = join(project, 'wrangler.jsonc')
// Windows needs a junction because directory symlinks require elevated rights.
symlinkSync(
  realpathSync('functions'),
  join(project, 'functions'),
  process.platform === 'win32' ? 'junction' : 'dir',
)
writeFileSync(
  config,
  JSON.stringify({
    name: 'stjbs-wall-local-demo',
    pages_build_output_dir: realpathSync('dist'),
    compatibility_date: '2025-10-01',
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'local-synthetic-wall',
        database_id: '00000000-0000-4000-9000-000000000001',
        migrations_dir: realpathSync('migrations'),
      },
    ],
  }),
)
const db = [
  'local-synthetic-wall',
  '--local',
  '--persist-to',
  persist,
  '--config',
  config,
]
wrangler(['d1', 'migrations', 'apply', ...db], {
  env: { ...process.env, CI: 'true' },
})
seed(fixture(), db)
if (args.includes('--reset')) {
  console.log('Synthetic demo reset.')
  process.exit(0)
}
console.log(
  'Synthetic local demo at http://127.0.0.1:' +
    port +
    ' · Passphrase: paper-garden',
)
wrangler(
  [
    'pages',
    'dev',
    realpathSync('dist'),
    '--port',
    port,
    '--inspector-port',
    '0',
    '--ip',
    '127.0.0.1',
    '--persist-to',
    persist,
    '--binding',
    'LOCAL_DEMO=isolated-loopback',
    '--binding',
    'TEACHER_PASSPHRASE=paper-garden',
    '--binding',
    'SESSION_SECRET=' + readFileSync(marker, 'utf8'),
  ],
  { cwd: project },
)
