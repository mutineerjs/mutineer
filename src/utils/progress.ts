import sliceAnsi from 'slice-ansi'
import chalk from 'chalk'
import type { MutantStatus } from '../types/mutant.js'

export type ProgressMode = 'bar' | 'list'

export interface ProgressOptions {
  readonly mode?: ProgressMode
  readonly stream?: 'stdout' | 'stderr'
}

export class Progress {
  private total: number
  private done = 0
  private killed = 0
  private escaped = 0
  private skipped = 0
  private errors = 0
  private timeouts = 0
  private readonly mode: ProgressMode
  private readonly useTTY: boolean
  private readonly stream: NodeJS.WriteStream
  private started = false
  private finished = false

  constructor(total: number, opts: ProgressOptions = {}) {
    this.total = Math.max(0, total)
    this.mode = opts.mode ?? 'bar'
    this.stream = opts.stream === 'stdout' ? process.stdout : process.stderr
    this.useTTY = Boolean(this.stream.isTTY) && this.mode === 'bar'
  }

  start(): void {
    if (this.started || this.finished) return
    this.started = true
    if (this.useTTY) {
      this.stream.write('\x1b[?25l') // hide cursor
      this.writeBar()
    } else {
      console.log(`mutineer: running ${this.total} mutants`)
    }
  }

  update(status: MutantStatus): void {
    if (!this.started || this.finished) return
    this.done++
    if (status === 'killed') this.killed++
    else if (status === 'escaped') this.escaped++
    else if (status === 'error') this.errors++
    else if (status === 'timeout') this.timeouts++
    else this.skipped++

    if (this.useTTY) {
      this.writeBar()
    } else {
      console.log(`mutant ${this.done}/${this.total} ${status}`)
    }
  }

  finish(): void {
    if (!this.started || this.finished) return
    this.finished = true
    if (this.useTTY) {
      this.stream.write('\r\x1b[2K') // clear the bar line
      this.stream.write('\x1b[?25h') // show cursor
    }
    console.log(
      `mutineer: killed=${this.killed} escaped=${this.escaped} ` +
        `errors=${this.errors} timeouts=${this.timeouts} skipped=${this.skipped}`,
    )
  }

  private writeBar(): void {
    const cols = this.stream.columns || 80
    const ratio = this.total === 0 ? 1 : Math.min(this.done / this.total, 1)
    const pct = Math.round(ratio * 100)

    // Calculate visible widths to ensure the line fits in one terminal row
    const prefix = `mutants ${this.done}/${this.total} [`
    const suffix = `] ${pct}% `
    const stats =
      `killed=${this.killed} ` +
      `escaped=${this.escaped} ` +
      `errors=${this.errors} ` +
      `timeouts=${this.timeouts} ` +
      `skipped=${this.skipped}`

    const barWidth = Math.max(
      0,
      cols - prefix.length - suffix.length - stats.length - 1,
    )
    const filled = Math.round(ratio * barWidth)
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled)

    const line =
      prefix +
      bar +
      suffix +
      chalk.green(`killed=${this.killed}`) +
      ' ' +
      chalk.red(`escaped=${this.escaped}`) +
      ' ' +
      chalk.yellow(`errors=${this.errors}`) +
      ' ' +
      chalk.yellow(`timeouts=${this.timeouts}`) +
      ' ' +
      chalk.dim(`skipped=${this.skipped}`)

    this.stream.write('\r\x1b[2K' + sliceAnsi(line, 0, cols))
  }
}
