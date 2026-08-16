import { describe, expect, it } from 'vitest'
import { renderShellPage } from '../src/main/shell-page.ts'

describe('renderShellPage', () => {
  it('renders the starting variant without actions', () => {
    const html = renderShellPage({ status: 'starting' }, '0.0.0-test')
    expect(html).toContain('Starting DeepSeek Harness')
    expect(html).not.toContain('<button')
  })

  it('shows the desktop version in the footer', () => {
    const html = renderShellPage({ status: 'starting' }, '0.1.0-rc.14')
    expect(html).toContain('DeepSeek Harness 0.1.0-rc.14')
  })

  it('renders the failed variant with message, log tail, and actions', () => {
    const html = renderShellPage({
      status: 'failed',
      message: 'child exited with code 1',
      logTail: ['line one', 'line two'],
    }, '0.0.0-test')
    expect(html).toContain('Harness failed to start')
    expect(html).toContain('child exited with code 1')
    expect(html).toContain('line one\nline two')
    for (const action of ['retry', 'view-logs', 'quit']) {
      expect(html).toContain(`data-action="${action}"`)
    }
  })

  it('escapes HTML in message and log tail', () => {
    const html = renderShellPage({
      status: 'failed',
      message: '<script>alert(1)</script>',
      logTail: ['<img src=x>'],
    }, '0.0.0-test')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x&gt;')
  })

  it('omits the log block when the tail is empty', () => {
    const html = renderShellPage({ status: 'failed', message: 'boom', logTail: [] }, '0.0.0-test')
    expect(html).not.toContain('<pre>')
  })
})
