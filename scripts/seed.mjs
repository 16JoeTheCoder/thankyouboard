import { readFileSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { seed } from './seed-lib.mjs'

try {
  const args = process.argv.slice(2)
  function required(flag) {
    const i = args.indexOf(flag)
    if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error('Specify ' + flag)
    return args[i + 1]
  }
  if (args.includes('--local') === args.includes('--remote'))
    throw new Error('Choose exactly one explicit --local or --remote target.')
  const file = realpathSync(required('--file')),
    db = required('--database'),
    loc = relative(realpathSync(process.cwd()), file)
  if (
    !loc.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
    !isAbsolute(loc)
  )
    throw new Error('Keep approved private inputs outside the repository.')
  const target = [
    db,
    args.includes('--local') ? '--local' : '--remote',
    '--config',
    resolve(required('--config')),
  ]
  if (args.includes('--state'))
    target.push('--persist-to', resolve(required('--state')))
  let dataset
  try {
    dataset = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error('Private input was not readable JSON.')
  }
  seed(dataset, target)
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
}
