import { createWriteStream } from 'node:fs'
import type { WriteStream } from 'node:fs'

/** Number of recent lines retained for the recovery page. */
export const LOG_TAIL_LINES = 50

/**
 * Harness log writer: appends every child output line to the log file and
 * retains a bounded in-memory tail for the recovery page.
 */
export class HarnessLog {
  private stream: WriteStream | null = null
  private tail: string[] = []

  /**
   * Open the log file for appending.
   * @param logFile - absolute path of the log file.
   */
  open(logFile: string): void {
    this.stream = createWriteStream(logFile, { flags: 'a', encoding: 'utf8' })
    // A broken log file must never take down the shell; report and continue
    // with the in-memory tail only.
    this.stream.on('error', (error) => { console.error(`HarnessLog: ${error.message}`) })
  }

  /**
   * Append one line to the file and the in-memory tail.
   * @param line - the line text (newline added).
   */
  write(line: string): void {
    this.stream?.write(line + '\n')
    this.tail.push(line)
    if (this.tail.length > LOG_TAIL_LINES) this.tail.splice(0, this.tail.length - LOG_TAIL_LINES)
  }

  /**
   * The bounded recent-history buffer.
   * @returns a copy of the retained lines, oldest first.
   */
  recentLines(): readonly string[] {
    return [...this.tail]
  }

  /** Flush and close the underlying stream. */
  async close(): Promise<void> {
    const stream = this.stream
    this.stream = null
    if (!stream) return
    await new Promise<void>(resolve => stream.end(resolve))
  }
}
