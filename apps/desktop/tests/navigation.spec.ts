import { describe, expect, it } from 'vitest'
import { navigationAction } from '../src/main/navigation.ts'

const harness = 'http://127.0.0.1:51234'

describe('navigationAction', () => {
  it('allows in-place navigation on the harness origin', () => {
    expect(navigationAction('http://127.0.0.1:51234/session/abc', harness)).toBe('allow')
    expect(navigationAction('http://127.0.0.1:51234/', harness)).toBe('allow')
  })

  it('allows local shell pages', () => {
    expect(navigationAction('file:///Applications/app/resources/shell.html', harness)).toBe('allow')
    expect(navigationAction('about:blank', harness)).toBe('allow')
  })

  it('sends other http(s) origins to the system browser', () => {
    expect(navigationAction('https://github.com/deepseek-ai', harness)).toBe('external')
    expect(navigationAction('http://example.com', harness)).toBe('external')
    // A different loopback port is NOT the harness origin.
    expect(navigationAction('http://127.0.0.1:9999/', harness)).toBe('external')
  })

  it('denies everything else', () => {
    expect(navigationAction('not a url', harness)).toBe('deny')
    expect(navigationAction('javascript:alert(1)', harness)).toBe('deny')
    expect(navigationAction('custom-scheme://open', harness)).toBe('deny')
  })

  it('denies loopback http before the harness is ready', () => {
    expect(navigationAction('http://127.0.0.1:51234/', null)).toBe('external')
    expect(navigationAction('file:///shell.html', null)).toBe('allow')
  })
})
