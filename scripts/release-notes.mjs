#!/usr/bin/env node
// Turns the changelog entry of one version into the body of its GitHub release.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Reads the command line: a version, and the optional asset facts to pin under `Verify`.
 * @param {string[]} argv
 */
function optionsOf(argv) {
  const options = { version: '', asset: '', sha256: '', output: '' }
  const rest = [...argv]
  while (rest.length > 0) {
    const argument = rest.shift() ?? ''
    if (argument === '--asset') options.asset = rest.shift() ?? ''
    else if (argument === '--sha256') options.sha256 = rest.shift() ?? ''
    else if (argument === '--out') options.output = rest.shift() ?? ''
    else if (!argument.startsWith('--')) options.version = argument
  }
  return options
}

/**
 * The `## [<version>]` section of the changelog, without the version heading itself.
 * @param {string} changelog @param {string} version
 */
export function sectionOf(changelog, version) {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`))
  if (start < 0) throw new Error(`CHANGELOG.md has no "## [${version}]" section`)
  const date = /## \[[^\]]+\] - (\d{4}-\d{2}-\d{2})/.exec(lines[start] ?? '')?.[1] ?? ''
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    // The section ends at the next version heading; the link definitions below the last one are not prose.
    if (lines[index]?.startsWith('## ') || /^\[[^\]]+\]:\s/.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
  return { date, body }
}

/**
 * @param {{version: string, date: string, body: string, asset: string, sha256: string}} parts
 */
export function notesOf(parts) {
  const blocks = [`# v${parts.version}`, parts.date === '' ? '' : `Released ${parts.date}.`, parts.body]
  if (parts.asset !== '') {
    blocks.push(
      '## Install',
      [
        `1. Download \`${parts.asset}\` below and unpack it somewhere stable.`,
        '2. Install that folder as a profile bundle:',
        '   ```text',
        '   plugin_manager  action=install_bundle  target="<the unpacked folder>"',
        '   ```',
        '3. Restart the Harness: an **MCP** entry appears in the sidebar and `mcp_workbench` becomes a tool.',
      ].join('\n'),
    )
  }
  if (parts.sha256 !== '') {
    blocks.push('## Verify', `\`sha256\` of \`${parts.asset}\`: \`${parts.sha256}\``)
  }
  return `${blocks.filter((block) => block !== '').join('\n\n')}\n`
}

async function main() {
  const options = optionsOf(process.argv.slice(2))
  if (options.version === '')
    throw new Error('usage: node scripts/release-notes.mjs <version> [--asset <file>] [--sha256 <hash>]')
  const changelog = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const { date, body } = sectionOf(changelog, options.version)
  const notes = notesOf({ version: options.version, date, body, asset: options.asset, sha256: options.sha256 })
  if (options.output === '') process.stdout.write(notes)
  else await writeFile(options.output, notes, 'utf8')
}

await main()
