#!/usr/bin/env node
// Stages the files a bundle needs and zips them, so a release asset can be uploaded by CI or by hand.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, appendFile, cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
// Everything the profile needs at run time; `lib/` is prebuilt so the zip installs without npm.
const SHIPPED = [
  'package.json',
  'cordis.patch.yml',
  'icon.svg',
  'README.md',
  'README.zh.md',
  'LICENSE',
  'locale',
  'lib',
]

/** @param {string} directory */
async function countFiles(directory) {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    total += entry.isDirectory() ? await countFiles(join(directory, entry.name)) : 1
  }
  return total
}

/**
 * Zips a staged directory. Git ships `zip` on the Linux runners; Windows only has Compress-Archive.
 * @param {string} source @param {string} target
 */
function zip(source, target) {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Compress-Archive -Path '${join(source, '*')}' -DestinationPath '${target}' -Force`,
          ],
          { stdio: 'inherit' },
        )
      : spawnSync('zip', ['-qr', target, '.'], { cwd: source, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`the zip command exited with ${String(result.status)}`)
}

async function main() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const version = String(manifest.version)
  // `npm run pack` without a build would ship a zip that cannot load, so fail before staging.
  for (const entry of ['lib/index.js', 'lib/client.js']) {
    try {
      await access(join(ROOT, entry))
    } catch {
      throw new Error(`${entry} is missing; run "npm run build" before packing`)
    }
  }
  const stage = join(DIST, `mcp-workbench-${version}`)
  const asset = `dsh-mcp-workbench-${version}.zip`
  const archive = join(DIST, asset)

  await rm(stage, { recursive: true, force: true })
  await rm(archive, { force: true })
  await mkdir(stage, { recursive: true })
  for (const name of SHIPPED) {
    await cp(join(ROOT, name), join(stage, name), { recursive: true })
  }
  zip(stage, archive)

  const bytes = (await stat(archive)).size
  const sha256 = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')
    .toUpperCase()
  const files = await countFiles(stage)

  const outputs = { version, asset, path: archive, bytes: String(bytes), sha256, files: String(files) }
  console.log(`${asset}: ${String(files)} files, ${String(bytes)} bytes, sha256 ${sha256}`)
  const sink = process.env.GITHUB_OUTPUT
  if (sink !== undefined && sink !== '') {
    await appendFile(
      sink,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
    )
  }
}

await main()
