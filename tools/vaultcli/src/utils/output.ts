import chalk from 'chalk';
import type { OutputMode, CliResult } from './types.js';

export function info(message: string): void {
  console.log(chalk.cyan(message));
}

export function success(message: string): void {
  console.log(chalk.green(message));
}

export function warn(message: string): void {
  console.error(chalk.yellow(message));
}

export function error(message: string): void {
  console.error(chalk.red(message));
}

export function dim(message: string): void {
  console.log(chalk.dim(message));
}

export function bold(message: string): void {
  console.log(chalk.bold(message));
}

export function header(title: string): void {
  console.log('');
  console.log(chalk.bold.cyan(title));
  console.log(chalk.dim('\u2500'.repeat(title.length)));
}

export function section(title: string): void {
  console.log('');
  console.log(chalk.bold.cyan(`  \u250C\u2500 ${title} ${'\u2500'.repeat(Math.max(0, 60 - title.length))}\u2510`));
}

export function keyValue(key: string, value: string): void {
  console.log(`  ${chalk.dim(key + ':')} ${value}`);
}

export function tableRow(columns: string[], widths: number[]): void {
  const formatted = columns.map((col, i) =>
    String(col ?? '').padEnd(widths[i] || 20),
  );
  console.log('  ' + formatted.join('  '));
}

export function tableHeader(columns: string[], widths: number[]): void {
  tableRow(columns, widths);
  console.log('  ' + chalk.dim('\u2500'.repeat(widths.reduce((a, b) => a + b + 2, 0))));
}

export function blank(): void {
  console.log('');
}

export function statusBadge(status: string): string {
  const map: Record<string, (s: string) => string> = {
    ready: chalk.green,
    active: chalk.green,
    current: chalk.green,
    pending: chalk.yellow,
    uploading: chalk.yellow,
    processing: chalk.blue,
    failed: chalk.red,
    revoked: chalk.red,
    expired: chalk.red,
  };
  const fn = map[status.toLowerCase()] || chalk.white;
  return fn(`[${status.toUpperCase()}]`);
}

export class OutputManager {
  constructor(public readonly mode: OutputMode) {}

  get isMachine(): boolean {
    return this.mode === 'json' || this.mode === 'quiet';
  }

  result<T>(
    data: T,
    humanFormat: (data: T) => void,
    quietFormat?: (data: T) => void,
  ): void {
    switch (this.mode) {
      case 'json': {
        const envelope: CliResult<T> = { success: true, data };
        process.stdout.write(JSON.stringify(envelope) + '\n');
        break;
      }
      case 'quiet':
        if (quietFormat) quietFormat(data);
        break;
      case 'human':
      default:
        humanFormat(data);
        break;
    }
  }

  fail(msg: string, code?: string): void {
    if (this.mode === 'json') {
      const envelope: CliResult<never> = { success: false, error: msg, ...(code ? { code } : {}) };
      process.stderr.write(JSON.stringify(envelope) + '\n');
    } else {
      error(msg);
    }
  }

  humanOnly(fn: () => void): void {
    if (this.mode === 'human') fn();
  }

  verbose(message: string): void {
    if (this.mode === 'human') {
      console.error(chalk.gray(`[verbose] ${message}`));
    }
  }
}
