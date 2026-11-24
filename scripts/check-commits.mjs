#!/usr/bin/env node
import { execFileSync } from 'node:child_process'

// The types this repository uses. A merge commit is never policed: Git Flow creates them.
const TYPES = 'feat|fix|test|ci|docs|chore|refactor|style|perf|revert'
const SUBJECT = new RegExp(`^(${TYPES})(\\([a-z0-9][a-z0-9./-]*\\))?: \\S`)
const MAX_LENGTH = 100
const FIELD = '\u001f'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const parse = (raw) => {
  if (raw === '') return []
  return raw.split('\n').map((line) => {
    const separator = line.indexOf(FIELD)
    return { sha: line.slice(0, separator), subject: line.slice(separator + 1) }
  })
}

const between = (from, to) => {
  try {
    return parse(git('log', '--no-merges', `--format=%H${FIELD}%s`, `${from}..${to}`))
  } catch {
    // A root commit or a shallow clone has no walkable range; check the tip alone.
    return parse(git('log', '--no-merges', '-1', `--format=%H${FIELD}%s`, to))
  }
}

const rangeOf = () => {
  const [baseArg, headArg] = process.argv.slice(2)
  const base = (baseArg ?? process.env['BASE_SHA'] ?? '').trim()
  const head = (headArg ?? process.env['HEAD_SHA'] ?? '').trim() || 'HEAD'
  if (base === '' || /^0+$/.test(base)) return { from: `${head}^`, to: head }
  try {
    return { from: git('merge-base', base, head), to: head }
  } catch {
    return { from: base, to: head }
  }
}

const { from, to } = rangeOf()
const commits = between(from, to)
const bad = commits.filter((commit) => !SUBJECT.test(commit.subject) || commit.subject.length > MAX_LENGTH)

if (bad.length > 0) {
  console.error(`${bad.length} of ${commits.length} commit messages do not follow Conventional Commits:`)
  for (const commit of bad) console.error(`  ${commit.sha.slice(0, 7)}  ${commit.subject}`)
  console.error('')
  console.error('Use <type>[(<scope>)]: <summary>, for example "fix(client): keep a masked secret out of the patch".')
  process.exit(1)
}

console.log(`${commits.length} commit message(s) follow Conventional Commits.`)
