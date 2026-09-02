/**
 * Self-contained tsdown config for the standalone dsh-custom-plugin bundle.
 *
 * The browser half emits a closure-factory artifact that calls
 * window.__ModuleLoader__.load({id, factory}) and resolves externals through
 * the loader's module table (react, cordis, ui-slots, ui-primitives); the
 * node half stays a plain ESM library.
 * @module dsh-custom-plugin/tsdown.config
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { UserConfig } from 'tsdown'

/** Plugin id (package name), stamped into the __ModuleLoader__.load handoff. */
const ID = '@alexpeng/dsh-custom-plugin'

/** Browser platform modules the loader module table answers (mirrors the shell seed table). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/**
 * Build the standalone package configs: the node-half library plus the
 * browser client bundle.
 * @returns tsdown config array for the current build.
 */
export default (): UserConfig[] => {
  const configs: UserConfig[] = [{
    name: ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The cordis framework and the dsh tool SDK resolve at runtime from the
    // dsh profile tree (both are peerDependencies — harness convention).
    deps: {
      neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', 'keytar'],
    },
  }]

  if (existsSync(resolve(process.cwd(), 'src/client/index.ts'))) {
    configs.push({
      name: `${ID}/client`,
      entry: { client: 'src/client/index.ts' },
      outDir: 'lib',
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      dts: false,
      sourcemap: true,
      clean: false,
      deps: {
        neverBundle: [...PLATFORM_MODULES],
        alwaysBundle: (id: string) => (PLATFORM_MODULES.includes(id as never) ? undefined : true),
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
        'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
        'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
      },
      // tsdown auto-externalizes package dependencies; anything NOT in the
      // loader module table must inline instead (wire layers, zod, etc.).
      outputOptions: {
        entryFileNames: 'client.js',
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
        footer: 'return module.exports; } });',
        intro: 'var module = { exports: {} }; var exports = module.exports;',
      },
    })
  }

  return configs
}
