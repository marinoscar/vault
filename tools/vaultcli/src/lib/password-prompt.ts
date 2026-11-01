import { createInterface } from 'readline';
import { Writable } from 'stream';

/**
 * Prompt for a secret on the terminal without echoing what is typed.
 *
 * Uses readline with a muted output stream (no extra dependencies): the prompt
 * text is written to stderr, keystrokes are swallowed. Ctrl+C rejects with an
 * "Aborted" error instead of leaving the terminal in a muted state.
 */
export function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let muted = false;
    const mutedOut = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stderr.write(chunk);
        callback();
      },
    });

    const rl = createInterface({
      input: process.stdin,
      output: mutedOut,
      terminal: true,
    });

    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      muted = false;
      rl.close();
      process.stderr.write('\n');
      fn();
    };

    rl.on('SIGINT', () => finish(() => reject(new Error('Aborted'))));
    rl.on('close', () => finish(() => reject(new Error('Aborted'))));

    rl.question(prompt, (answer) => finish(() => resolve(answer)));
    muted = true;
  });
}

/**
 * Prompt twice (entry + confirmation) and return the password once both match
 * and `validate` accepts it. Re-asks up to `attempts` times, then throws.
 */
export async function promptNewPassword(
  validate: (pw: string) => string | null,
  attempts = 3,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const pw = await promptHidden('Backup password: ');
    const problem = validate(pw);
    if (problem) {
      process.stderr.write(`${problem}\n`);
      continue;
    }
    const confirm = await promptHidden('Confirm password: ');
    if (confirm !== pw) {
      process.stderr.write('Passwords do not match. Try again.\n');
      continue;
    }
    return pw;
  }
  throw new Error('No valid password entered');
}

/** Ask a yes/no question on the terminal (stderr); only "y"/"yes" is yes. */
export function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    let answered = false;
    rl.on('close', () => {
      if (!answered) resolve(false);
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(/^(y|yes)$/i.test(answer.trim()));
    });
  });
}
