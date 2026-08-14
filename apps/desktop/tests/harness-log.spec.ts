import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HarnessLog, LOG_TAIL_LINES } from '../src/main/harness-log.ts'

describe('HarnessLog', () => {
  let dir = ''
  let logFile = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-desktop-log-'))
    logFile = join(dir, 'harness.log')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('appends lines to the log file', async () => {
    const log = new HarnessLog()
    log.open(logFile)
    log.write('first')
    log.write('second')
    await log.close()
    expect(await readFile(logFile, 'utf8')).toBe('first\nsecond\n')
  })

  it('retains only the bounded tail', async () => {
    const log = new HarnessLog()
    for (let i = 0; i < LOG_TAIL_LINES + 10; i += 1) log.write(`line-${String(i)}`)
    const tail = log.recentLines()
    expect(tail).toHaveLength(LOG_TAIL_LINES)
    expect(tail[0]).toBe(`line-${String(10)}`)
    await log.close()
  })

  it('tolerates writes and close without open', async () => {
    const log = new HarnessLog()
    log.write('buffered only')
    expect(log.recentLines()).toEqual(['buffered only'])
    await log.close()
  })
})
