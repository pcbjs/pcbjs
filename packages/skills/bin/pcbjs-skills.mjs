#!/usr/bin/env node
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { describe, install, skillNames, skillsDir } from '../index.mjs'

const usage = `usage: pcbjs-skills <command>

  install [--to <dir>]  copy every skill into <dir>, default .claude/skills of the current folder
  list                  each skill with its description
  path                  the folder the skills ship in`

let args
try {
  args = parseArgs({ allowPositionals: true, options: { to: { type: 'string' }, help: { type: 'boolean', short: 'h' } } })
} catch (e) {
  console.error(`${e.message}\n\n${usage}`)
  process.exit(1)
}
const { values, positionals: [cmd, ...more] } = args

if (values.help) console.log(usage)
else if (more.length || (values.to !== undefined && cmd !== 'install')) { console.error(usage); process.exitCode = 1 }
else if (cmd === 'install') {
  for (const s of install(resolve(values.to ?? join('.claude', 'skills')))) console.log(`${s.updated ? 'updated  ' : 'installed'}  ${s.name}  ${relative(process.cwd(), s.dest)}`)
}
else if (cmd === 'list') for (const n of skillNames()) console.log(`${n.padEnd(32)}  ${describe(n)}`)
else if (cmd === 'path') console.log(skillsDir)
else { console.error(usage); process.exitCode = 1 }
