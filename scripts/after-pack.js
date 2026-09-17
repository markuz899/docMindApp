// Re-signs the macOS bundle with an ad-hoc signature.
//
// There is no Apple Developer ID, so electron-builder skips signing and leaves
// the bundle carrying Electron's own linker signature. Its resource seal no
// longer matches once the executable is renamed and app.asar is added, which is
// what produces "DocMind is damaged and can't be opened" on Apple Silicon.
//
// An ad-hoc signature does not make the app trusted - Gatekeeper still warns,
// and the download still needs its quarantine flag cleared - but it does make
// the bundle internally valid, so it launches once the user allows it.
const { spawnSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const result = spawnSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--identifier', context.packager.appInfo.id, app],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) {
    throw new Error(`ad-hoc codesign failed for ${app}`)
  }
  console.log(`  • ad-hoc signed  ${path.basename(app)}`)
}
