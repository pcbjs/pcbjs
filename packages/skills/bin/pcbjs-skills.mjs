#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { describe, install, installLine, skillNames, skillsDir } from '../index.mjs'

const usage = `usage: pcbjs-skills <command>

  install [--to <dir>] [--no-claude]  link every skill from .agents/skills and .claude/skills of the current folder
                                      into node_modules/@pcbjs/skills, or from <dir> alone; copy outside a project
  list                                each skill with its description
  path                                the folder the skills ship in`

let args
try {
  args = parseArgs({ allowPositionals: true, allowNegative: true, options: { to: { type: 'string' }, claude: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } })
} catch (e) {
  console.error(`${e.message}\n\n${usage}`)
  process.exit(1)
}
const {
  values,
  positionals: [cmd, ...more],
} = args
const cwd = process.cwd()

if (values.help) console.log(usage)
else if (more.length || ((values.to !== undefined || values.claude !== undefined) && cmd !== 'install')) {
  console.error(usage)
  process.exitCode = 1
} else if (cmd === 'install') for (const s of install(cwd, { to: values.to, claude: values.claude })) console.log(installLine(s, cwd))
else if (cmd === 'list') for (const n of skillNames()) console.log(`${n.padEnd(32)}  ${describe(n)}`)
else if (cmd === 'path') console.log(skillsDir)
else {
  console.error(usage)
  process.exitCode = 1
}
