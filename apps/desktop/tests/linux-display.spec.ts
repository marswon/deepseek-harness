import { describe, expect, it } from 'vitest'
import { ozonePlatformHint } from '../src/main/linux-display.ts'

/**
 * The Ozone hint decides whether a Wayland session runs natively or through
 * XWayland. It is a pure function of platform, environment, and argv so the
 * "never override a deliberate choice" rules are checkable without Electron.
 */

describe('ozonePlatformHint', () => {
  it('opts a Linux session into native Wayland when nothing else chose', () => {
    expect(ozonePlatformHint('linux', {}, ['/usr/bin/DeepSeek-Harness'])).toBe('auto')
  })

  it('leaves other platforms on their own default', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(ozonePlatformHint(platform, {}, [])).toBeNull()
    }
  })

  it('defers to ELECTRON_OZONE_PLATFORM_HINT, including an empty value', () => {
    expect(ozonePlatformHint('linux', { ELECTRON_OZONE_PLATFORM_HINT: 'x11' }, [])).toBeNull()
    // An explicitly empty value is still a choice Electron 37 acts on.
    expect(ozonePlatformHint('linux', { ELECTRON_OZONE_PLATFORM_HINT: '' }, [])).toBeNull()
  })

  it('defers to an explicit --ozone-platform argument in either form', () => {
    expect(ozonePlatformHint('linux', {}, ['app', '--ozone-platform=x11'])).toBeNull()
    expect(ozonePlatformHint('linux', {}, ['app', '--ozone-platform', 'x11'])).toBeNull()
  })

  it('defers to an explicit --ozone-platform-hint argument in either form', () => {
    expect(ozonePlatformHint('linux', {}, ['app', '--ozone-platform-hint=x11'])).toBeNull()
    expect(ozonePlatformHint('linux', {}, ['app', '--ozone-platform-hint', 'auto'])).toBeNull()
  })

  it('ignores an unrelated flag that merely starts with the same prefix', () => {
    expect(ozonePlatformHint('linux', {}, ['app', '--ozone-platform-other=1'])).toBe('auto')
  })
})
