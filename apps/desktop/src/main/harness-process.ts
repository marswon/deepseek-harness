import { spawn } from 'node:child_process'
import type { HarnessLaunch } from './runtime.ts'
import { parseReadyUrl } from './runtime.ts'

/** One Harness child output line, stderr flagged for the log sink. */
export interface HarnessOutputLine {
  readonly text: string
  readonly stream: 'stdout' | 'stderr'
}

/** Options controlling Harness child supervision. */
export interface HarnessProcessOptions {
  /** Milliseconds to wait for the ready line before failing startup. */
  readonly readyTimeoutMs: number
  /** Milliseconds between SIGTERM and SIGKILL on shutdown. */
  readonly killGraceMs: number
  /** Sink receiving every child output line (log file, diagnostics). */
  readonly onLine: (line: HarnessOutputLine) => void
  /** Called when the child exits, whether before or after readiness. */
  readonly onExit: (code: number | null) => void
}

const DEFAULT_OPTIONS: HarnessProcessOptions = {
  readyTimeoutMs: 120_000,
  killGraceMs: 5_000,
  onLine: () => {},
  onExit: () => {},
}

/**
 * Supervisor for the `dsh web` child process. Startup resolves with the
 * loopback URL parsed from the child's ready line; it rejects when the child
 * exits or stays silent past the ready timeout. `stop()` terminates the child
 * gracefully first and escalates to SIGKILL after the grace period.
 */
export class HarnessProcess {
  private readonly options: HarnessProcessOptions
  private child: ReturnType<typeof spawn> | null = null
  /** Settled once the child is gone; null while running or never started. */
  private exited: Promise<number | null> | null = null

  constructor(options: Partial<HarnessProcessOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Spawn the child and wait for its ready line.
   * @param launch - the resolved invocation.
   * @returns the loopback URL the Harness web UI listens on.
   * @throws when the child exits before readiness or the ready timeout elapses.
   */
  start(launch: HarnessLaunch): Promise<string> {
    if (this.child) throw new Error('HarnessProcess: start() called while the child is already running.')
    const child = spawn(launch.command, [...launch.args], {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    this.exited = new Promise(resolve => child.once('exit', (code) => {
      this.options.onExit(code)
      resolve(code)
    }))

    return new Promise<string>((resolve, reject) => {
      let settled = false
      const settle = (action: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        action()
      }
      const timer = setTimeout(() => {
        settle(() => { reject(new Error(`HarnessProcess: no ready line within ${this.options.readyTimeoutMs}ms.`)) })
      }, this.options.readyTimeoutMs)

      this.pipeLines(child.stdout, 'stdout', (text) => {
        const url = parseReadyUrl(text)
        if (url !== null) settle(() => { resolve(url) })
      })
      this.pipeLines(child.stderr, 'stderr', () => {})
      child.once('error', (error) => { settle(() => { reject(error) }) })
      child.once('exit', (code) => {
        settle(() => { reject(new Error(`HarnessProcess: child exited with code ${String(code)} before signaling readiness.`)) })
      })
    })
  }

  /**
   * Terminate the child: SIGTERM, then SIGKILL once the grace period elapses.
   * A no-op when the child never started or already exited.
   */
  async stop(): Promise<void> {
    const child = this.child
    const exited = this.exited
    this.child = null
    this.exited = null
    if (!child || !exited || child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    const gone = await Promise.race([
      exited.then(() => true),
      new Promise<false>(resolve => setTimeout(() => { resolve(false) }, this.options.killGraceMs)),
    ])
    if (!gone) child.kill('SIGKILL')
    await exited
  }

  private pipeLines(
    stream: NodeJS.ReadableStream | null,
    name: HarnessOutputLine['stream'],
    onText: (text: string) => void,
  ): void {
    if (!stream) return
    let pending = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop() ?? ''
      for (const text of lines) {
        this.options.onLine({ text, stream: name })
        onText(text)
      }
    })
    stream.on('end', () => {
      if (pending.length === 0) return
      this.options.onLine({ text: pending, stream: name })
      onText(pending)
    })
  }
}
