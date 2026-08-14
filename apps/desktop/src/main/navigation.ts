/**
 * Navigation policy for the hardened main window. The window may display the
 * loopback Harness UI and local shell pages (recovery/splash) only; anything
 * else is pushed to the system browser so a compromised or confused renderer
 * can never steer the window at an arbitrary origin.
 *
 * @param target - the URL the renderer wants to navigate to or open.
 * @param harnessUrl - the running Harness loopback URL, null before readiness.
 * @returns 'allow' to navigate in-place, 'external' to hand to the system
 * browser, 'deny' to drop.
 */
export function navigationAction(target: string, harnessUrl: string | null): 'allow' | 'external' | 'deny' {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return 'deny'
  }
  if (harnessUrl !== null && url.origin === new URL(harnessUrl).origin) return 'allow'
  if (url.protocol === 'file:' || url.protocol === 'about:') return 'allow'
  if (url.protocol === 'https:' || url.protocol === 'http:') return 'external'
  return 'deny'
}
