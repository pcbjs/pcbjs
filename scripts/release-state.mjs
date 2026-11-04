import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/

export function releaseTarget({ pending, exiting, version, head, subject, resume = '', tag = null }) {
  if (!resume) {
    if (!pending && !exiting) throw new Error('No pending changesets. To recover a train, supply its exact resume_version.')
    return { mode: 'new', ref: head, publish: true, tagged: false }
  }
  if (!versionPattern.test(resume)) throw new Error('resume_version must be an exact package version.')
  const expected = `pcbjs ${resume}`
  if (tag) {
    if (tag.version !== resume || tag.subject !== expected || !tag.ancestor)
      throw new Error('The release tag must name a version commit on main with the requested package version.')
    return { mode: 'resume', ref: tag.ref, publish: false, tagged: true }
  }
  if (version !== resume || subject !== expected || pending || exiting) throw new Error('An untagged resume must name the version commit at main, with no pending changesets.')
  return { mode: 'resume', ref: head, publish: true, tagged: false }
}

const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function taggedTrain(version) {
  const found = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/@pcbjs/pcbjs@${version}^{commit}`], { encoding: 'utf8' })
  if (found.status === 1) return null
  if (found.status !== 0) throw new Error(found.stderr || 'Could not read the release tag.')
  const ref = found.stdout.trim()
  return {
    ref,
    version: JSON.parse(git(['show', `${ref}:packages/pcbjs/package.json`])).version,
    subject: git(['show', '-s', '--format=%s', ref]),
    ancestor: spawnSync('git', ['merge-base', '--is-ancestor', ref, 'HEAD']).status === 0,
  }
}

export function currentRelease(resume = '') {
  if (resume && !versionPattern.test(resume)) throw new Error('resume_version must be an exact package version.')
  const pending = readdirSync('.changeset').some(f => f.endsWith('.md') && !/^(README|AGENTS|CLAUDE|GEMINI)\.md$/i.test(f))
  const pre = existsSync('.changeset/pre.json') ? JSON.parse(readFileSync('.changeset/pre.json', 'utf8')) : null
  return releaseTarget({
    pending,
    exiting: pre?.mode === 'exit',
    version: JSON.parse(readFileSync('packages/pcbjs/package.json', 'utf8')).version,
    head: git(['rev-parse', 'HEAD']),
    subject: git(['show', '-s', '--format=%s', 'HEAD']),
    resume,
    tag: resume ? taggedTrain(resume) : null,
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const target = currentRelease(process.env.RESUME_VERSION ?? '')
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(target)
          .map(([k, v]) => `${k}=${v}\n`)
          .join(''),
      )
    console.log(JSON.stringify(target))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
