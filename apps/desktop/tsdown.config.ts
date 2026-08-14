import { defineConfig } from 'tsdown'

/**
 * The desktop shell ships two bundles off the tsc emit: the ESM main entry
 * referenced by package.json `main`, and the CJS preload that a sandboxed
 * renderer requires. electron and electron-updater stay external — Electron
 * resolves both at runtime.
 */
export default defineConfig([
  {
    entry: ['lib/types/main/index.js'],
    outDir: 'lib/main',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
    deps: { neverBundle: ['electron', 'electron-updater'] },
  },
  {
    entry: ['lib/types/preload/index.js'],
    outDir: 'lib/preload',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
])
