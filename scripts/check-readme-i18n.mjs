#!/usr/bin/env node
/**
 * Bilingual README consistency gate: recompute each README's git blob hash
 * (the same `git hash-object --path <file> <file>` the record file documents)
 * and compare it against the hashes recorded in README.i18n.yaml. Editing one
 * language without bringing the other along, or forgetting to re-record the
 * hashes, fails loud here instead of drifting silently.
 * @module dsh-custom-plugin/scripts/check-readme-i18n
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RECORD = 'README.i18n.yaml'
const FILES = ['README.md', 'README.zh.md']

let record
try {
  record = readFileSync(resolve(root, RECORD), 'utf8')
} catch (error) {
  console.error(`✗ ${RECORD} is not readable: ${error.message}`)
  process.exit(1)
}

// Strip a UTF-8 BOM so the leading comment line still parses; accept any
// present and future language suffix (README.md, README.zh.md, …).
const recorded = new Map()
for (const match of record.replace(/^\uFEFF/, '').matchAll(/^(README(?:\.[a-z]{2})?\.md):\s*([0-9a-f]{40})\s*$/gm)) {
  recorded.set(match[1], match[2])
}

const failures = []
for (const name of FILES.filter(name => !recorded.has(name))) {
  failures.push(`${RECORD}: no hash recorded for ${name}`)
}

for (const file of FILES) {
  if (!recorded.has(file)) continue
  const git = spawnSync('git', ['hash-object', '--path', file, file], { cwd: root, encoding: 'utf8' })
  if (git.status !== 0) {
    failures.push(`${file}: git hash-object failed: ${git.stderr.trim()}`)
    continue
  }
  const actual = git.stdout.trim()
  if (actual === recorded.get(file)) {
    console.log(`✓ ${file} ${actual}`)
  } else {
    failures.push([
      `${file}: working tree ${actual}`,
      `${RECORD} records      ${recorded.get(file)}`,
      `  → sync the other language, then re-record with:`,
      `    git hash-object --path ${file} ${file}`,
    ].join('\n'))
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`)
  process.exit(1)
}
console.log(`✓ ${RECORD}: ${FILES.length} README hash(es) consistent`)
