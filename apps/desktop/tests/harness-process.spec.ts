import { describe, expect, it } from 'vitest'
import { HarnessProcess } from '../src/main/harness-process.ts'

/** Node one-liners standing in for the Harness child. */
const FAKE_HARNESS = {
  ready: 'console.log("boot noise"); console.log("dsh web: http://127.0.0.1:59999"); setInterval(() => {}, 1000)',
  silent: 'setInterval(() => {}, 1000)',
  crashing: 'console.error("boom"); process.exit(3)',
}

function launchFor(script: string) {
  return {
    command: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    env: { ...process.env },
  } as const
}

describe('HarnessProcess', () => {
  it('resolves with the URL from the ready line', async () => {
    const lines: string[] = []
    const harness = new HarnessProcess({ onLine: line => lines.push(line.text) })
    const url = await harness.start(launchFor(FAKE_HARNESS.ready))
    expect(url).toBe('http://127.0.0.1:59999')
    expect(lines).toContain('boot noise')
    await harness.stop()
  })

  it('rejects when the child exits before readiness', async () => {
    const harness = new HarnessProcess()
    await expect(harness.start(launchFor(FAKE_HARNESS.crashing))).rejects.toThrow('code 3')
  })

  it('rejects when the ready timeout elapses', async () => {
    const harness = new HarnessProcess({ readyTimeoutMs: 200 })
    await expect(harness.start(launchFor(FAKE_HARNESS.silent))).rejects.toThrow('no ready line')
    await harness.stop()
  })

  it('stop() terminates a running child', async () => {
    let exited = false
    const harness = new HarnessProcess({ onExit: () => { exited = true } })
    await harness.start(launchFor(FAKE_HARNESS.ready))
    await harness.stop()
    expect(exited).toBe(true)
  })

  it('stop() is a no-op before start', async () => {
    await expect(new HarnessProcess().stop()).resolves.toBeUndefined()
  })

  it('start() refuses a second call while running', async () => {
    const harness = new HarnessProcess()
    await harness.start(launchFor(FAKE_HARNESS.ready))
    expect(() => harness.start(launchFor(FAKE_HARNESS.ready))).toThrow('already running')
    await harness.stop()
  })
})
