#!/usr/bin/env node
/**
 * Guard against packaging artifacts that look successful but lack
 * platform-specific native dependencies: node-pty prebuilds and the
 * landlock-run launcher ship per platform/arch, so a package must be built on
 * a matching host. Usage: node scripts/verify-target.mjs <platform> [arch].
 */
const [, , expectedPlatform, expectedArch] = process.argv

if (!expectedPlatform || !['darwin', 'win32', 'linux'].includes(expectedPlatform)) {
  console.error(`verify-target: expected platform darwin|win32|linux, got ${String(expectedPlatform)}.`)
  process.exit(1)
}
if (process.platform !== expectedPlatform) {
  console.error(`verify-target: packaging for ${expectedPlatform} requires a ${expectedPlatform} host (current: ${process.platform}).`)
  process.exit(1)
}
if (expectedArch && process.arch !== expectedArch) {
  console.error(`verify-target: packaging for ${expectedArch} requires a ${expectedArch} host (current: ${process.arch}).`)
  process.exit(1)
}
console.log(`verify-target: host ${process.platform}/${process.arch} matches target.`)
