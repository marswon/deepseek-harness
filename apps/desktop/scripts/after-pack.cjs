/**
 * electron-builder afterPack hook: place the staged Harness runtime next to
 * the app bundle. electron-builder's file matcher drops node_modules from
 * extraResources filters, so the copy happens here, verbatim.
 */
const { cp } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

/** @param context - electron-builder AfterPackContext. */
exports.default = async context => {
  const staging = join(tmpdir(), 'dsh-desktop-staging')
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const destination = join(resourcesDir, 'dsh-runtime')
  await cp(staging, destination, { recursive: true, dereference: true })
  console.log(`after-pack: staged Harness runtime copied to ${destination}`)
}
