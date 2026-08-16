/**
 * electron-builder afterPack hook: place the staged Harness runtime next to
 * the app bundle. electron-builder's file matcher drops node_modules from
 * extraResources filters, so the copy happens here, verbatim.
 */
const { cp, readFile, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

/**
 * Embed the app icon and version metadata into the Windows executable.
 * Cross-builds pass --config.win.signAndEditExecutable=false because rcedit
 * needs wine off Windows, and that flag skips icon/metadata embedding too —
 * so do it here with resedit, a pure-JS PE resource editor.
 *
 * @param context - electron-builder AfterPackContext.
 */
async function embedWindowsExecutableMetadata(context) {
  const ResEdit = await require('resedit/cjs').load()
  const { appInfo } = context.packager
  const exePath = join(context.appOutDir, `${appInfo.productFilename}.exe`)
  const exe = ResEdit.NtExecutable.from(await readFile(exePath), { ignoreCert: true })
  const res = ResEdit.NtExecutableResource.from(exe)

  const iconFile = ResEdit.Data.IconFile.from(await readFile(join(__dirname, '..', 'build', 'icon.ico')))
  const icons = iconFile.icons.map(item => item.data)
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icons)
  }

  const version = appInfo.version
  const [major = 0, minor = 0, patch = 0] = version.split(/[.-]/).map(Number)
  for (const vi of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
    const lang = typeof vi.lang === 'number' ? vi.lang : 1033
    vi.setFileVersion(major, minor, patch, 0, lang)
    vi.setProductVersion(major, minor, patch, 0, lang)
    vi.setStringValues(
      { lang, codepage: 1200 },
      {
        FileDescription: appInfo.productName,
        ProductName: appInfo.productName,
        FileVersion: version,
        ProductVersion: version,
      },
    )
    vi.outputToResourceEntries(res.entries)
  }

  res.outputResource(exe)
  await writeFile(exePath, Buffer.from(exe.generate()))
  console.log(`after-pack: embedded icon.ico and version ${version} into ${appInfo.productFilename}.exe`)
}

/** @param context - electron-builder AfterPackContext. */
exports.default = async context => {
  const staging = join(tmpdir(), 'dsh-desktop-staging')
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const destination = join(resourcesDir, 'dsh-runtime')
  await cp(staging, destination, { recursive: true, dereference: false, verbatimSymlinks: true })
  console.log(`after-pack: staged Harness runtime copied to ${destination}`)

  if (context.electronPlatformName === 'win32' && process.platform !== 'win32') {
    await embedWindowsExecutableMetadata(context)
  }

  if (context.electronPlatformName === 'darwin' && process.env.CSC_LINK === undefined) {
    // Without a Developer ID identity electron-builder skips signing entirely,
    // leaving Electron's stock ad-hoc signature with a stale resource seal
    // (app.asar and dsh-runtime changed after it was created). Re-seal so the
    // bundle passes codesign --verify. When CI provides a certificate
    // (CSC_LINK), electron-builder's own signing runs after this hook.
    const execFile = require('node:util').promisify(require('node:child_process').execFile)
    const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    await execFile('codesign', ['--force', '--deep', '--sign', '-', appPath])
    console.log(`after-pack: re-sealed ${context.packager.appInfo.productFilename}.app with an ad-hoc signature`)
  }
}
