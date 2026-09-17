// Swaps the better-sqlite3 prebuilt binary between the Node and Electron ABIs.
// better-sqlite3 is a classic V8 addon (not Node-API), so the same .node file
// cannot be loaded by both `vitest` (plain Node) and Electron.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const target = process.argv[2] === 'electron' ? 'electron' : 'node'

const pkgDir = path.dirname(require.resolve('better-sqlite3/package.json'))
const binary = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node')
const cacheDir = path.join(root, 'node_modules', '.cache', 'docmind-native')
const cached = path.join(cacheDir, `better_sqlite3.${target}.node`)
const stamp = path.join(cacheDir, 'current')

if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === target && fs.existsSync(binary)) {
  process.exit(0)
}

fs.mkdirSync(cacheDir, { recursive: true })

if (!fs.existsSync(cached)) {
  const electronVersion = require(path.join(root, 'node_modules/electron/package.json')).version
  const args =
    target === 'electron'
      ? ['prebuild-install', '-r', 'electron', '-t', electronVersion, '--tag-prefix', 'v']
      : ['prebuild-install', '-r', 'node', '-t', process.versions.node, '--tag-prefix', 'v']
  const res = spawnSync('npx', args, { cwd: pkgDir, stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.status !== 0 || !fs.existsSync(binary)) {
    // ponytail: no prebuild for this ABI -> compile once, then cache like the rest.
    const build = spawnSync(
      'npx',
      target === 'electron'
        ? ['electron-rebuild', '-f', '-w', 'better-sqlite3', '-m', root]
        : ['node-gyp', 'rebuild'],
      { cwd: target === 'electron' ? root : pkgDir, stdio: 'inherit' }
    )
    if (build.status !== 0) {
      console.error(`native: could not produce a better-sqlite3 binary for ${target}`)
      process.exit(1)
    }
  }
  fs.rmSync(cached, { force: true })
  fs.copyFileSync(binary, cached)
}

fs.mkdirSync(path.dirname(binary), { recursive: true })
// Replace, never overwrite in place. macOS caches a Mach-O's code signature
// against the inode, so writing different bytes into the same file makes the
// kernel SIGKILL anything that loads it (exit 137 on the first real call).
// Unlinking first means every swap lands on a fresh inode.
fs.rmSync(binary, { force: true })
fs.copyFileSync(cached, binary)
fs.writeFileSync(stamp, target)
console.log(`native: better-sqlite3 -> ${target} ABI`)
