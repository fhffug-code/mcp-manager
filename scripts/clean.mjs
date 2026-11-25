#!/usr/bin/env node
// Removes what a build and a pack leave behind, so neither a stale artifact nor an old zip is
// mistaken for the current one: `lib/` is what gets shipped and `dist/` is what gets uploaded.
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
// Both are build outputs and both are ignored by git.
const OUTPUTS = ['lib', 'dist']

for (const name of OUTPUTS) {
  await rm(join(ROOT, name), { recursive: true, force: true })
  console.log(`cleared ${name}`)
}
