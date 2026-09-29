#!/usr/bin/env node
/**
 * Read the dsh version an INSTALLED dsh Desktop carries, and say whether this
 * package's peer range admits it.
 *
 * Desktop pins its shell and `@deepseek-ai/dsh` to one exact version and ships
 * the whole runtime inside `resources/app.asar`, so the only authority on "which
 * dsh does this Desktop run" is that archive — the repository's `master` branch
 * can be ahead of, or behind, whatever a user installed. dsh's compatibility gate
 * then decides activation from `peerDependencies` alone, and prerelease ordering
 * is not intuitive (`^0.1.7-rc.2` desugars to `<0.2.0-0`, which every `0.2.0-rc.N`
 * sorts above), so the verdict is printed here rather than reasoned out.
 *
 *   node scripts/desktop-runtime.mjs <path to app.asar or the installation dir>
 *
 * Read-only: it parses the asar header and reads bytes out of the archive, and
 * writes nothing.
 * @module dsh-custom-plugin/scripts/desktop-runtime
 */

import { openSync, readSync, closeSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Packages whose versions decide whether a Desktop install can run this plugin. */
const WATCHED = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-tools', '@deepseek-ai/cordis']

/**
 * Parse an asar header: a u32 header-block size at byte 4, a u32 JSON length at
 * byte 12, the JSON itself at byte 16, and file data at `8 + headerBlock_size`.
 * @param file - path to `app.asar`.
 * @returns the header tree plus the offset where file data begins.
 */
function readAsarHeader(file) {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const headerBlock = head.readUInt32LE(4)
    const jsonLength = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLength)
    readSync(fd, json, 0, jsonLength, 16)
    return { header: JSON.parse(json.toString('utf8')), baseOffset: 8 + headerBlock, fd: null }
  } finally {
    closeSync(fd)
  }
}

/**
 * Look up one path in an asar header tree.
 * @param node - current header node.
 * @param segments - slash-separated path from the archive root.
 * @returns the entry, or `undefined` when the archive holds no such path.
 */
function findEntry(node, segments) {
  let current = node
  for (const segment of segments) {
    current = current.files?.[segment]
    if (current === undefined) return undefined
  }
  return current
}

/**
 * Read one file out of an asar given a parsed header.
 * @param file - path to `app.asar`.
 * @param header - the parsed header tree.
 * @param baseOffset - where archive file data starts.
 * @param path - slash-separated path inside the archive.
 * @returns the file contents, or `undefined` when the path is absent or is a directory.
 */
function readAsarFile(file, header, baseOffset, path) {
  const entry = findEntry(header, path.split('/'))
  if (entry === undefined || entry.files !== undefined) return undefined
  const buffer = Buffer.alloc(Number(entry.size))
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, baseOffset + Number(entry.offset))
  } finally {
    closeSync(fd)
  }
  return buffer
}

/**
 * Resolve the argument to an `app.asar` path, accepting the installation directory.
 * @param argument - path to `app.asar`, or to a directory containing `resources/app.asar`.
 * @returns the asar path.
 * @throws when neither layout matches.
 */
function locateAsar(argument) {
  const path = resolve(argument)
  if (path.toLowerCase().endsWith('.asar')) return path
  return join(path, 'resources', 'app.asar')
}

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: node scripts/desktop-runtime.mjs <path to app.asar or the Desktop installation dir>')
  process.exit(1)
}

const asar = locateAsar(target)
let parsed
try {
  parsed = readAsarHeader(asar)
} catch (error) {
  console.error(`BAD: cannot read asar header from ${asar}: ${String(error)}`)
  process.exit(1)
}
const { header, baseOffset } = parsed

const runtimeJson = readAsarFile(asar, header, baseOffset, 'dsh/desktop-runtime.json')
if (runtimeJson === undefined) {
  console.error(`BAD: ${asar} has no dsh/desktop-runtime.json — is this a dsh Desktop archive?`)
  process.exit(1)
}
const runtime = JSON.parse(runtimeJson.toString('utf8'))

const manifestText = await readFile(join(root, 'package.json'), 'utf8')
const plugin = JSON.parse(manifestText)
const peer = plugin.peerDependencies?.['@deepseek-ai/dsh-tools'] ?? ''

console.log(`asar:                       ${asar}`)
console.log(`Desktop release:            ${runtime.release?.version} (host protocol ${runtime.release?.hostProtocolVersion}, node ${runtime.release?.nodeVersion}, pnpm ${runtime.release?.pnpmVersion})`)
console.log(`platform/arch:              ${runtime.platform} ${runtime.arch}, ${runtime.files?.length} recorded files`)
for (const name of WATCHED) {
  const shared = runtime.sharedPackages?.find((pkg) => pkg.name === name)
  console.log(`  ${name.padEnd(28)} ${shared === undefined ? 'NOT SHARED' : shared.version}`)
}

const dshTools = runtime.sharedPackages?.find((pkg) => pkg.name === '@deepseek-ai/dsh-tools')?.version
if (dshTools === undefined || peer === '') {
  console.log('verdict:                    UNKNOWN — no @deepseek-ai/dsh-tools in the archive, or no such peer declared')
  process.exit(1)
}
const admitted = semver.satisfies(dshTools, peer, { includePrerelease: true })
console.log(`peer (@deepseek-ai/dsh-tools): ${peer}`)
console.log(`verdict:                    ${admitted ? `ADMITTED — Desktop can install ${plugin.name}@${plugin.version} with no exemption`
  : `REFUSED — Desktop would need an exact-version exemption for ${plugin.name}@${plugin.version} on dsh ${dshTools}`}`)
if (!admitted) {
  console.log(`  ${plugin.name} releases verified against other dsh versions are listed in CHANGELOG.md;`)
  console.log('  widening this range requires a full round on the new version (see README "Checking a new dsh release").')
}
