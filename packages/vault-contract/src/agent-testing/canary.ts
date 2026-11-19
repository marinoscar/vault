import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Canary values: distinctive invented strings seeded as secret values, then searched for in
 * everything a runtime writes (logs, traces, screenshots' metadata, model transcripts, files). A hit
 * means a value leaked. Vault runs the same kind of scan over its own logs, audit and notifications.
 */

/** Shortest canary {@link findCanaries} accepts: shorter strings match by chance. @stability beta */
export const MIN_CANARY_LENGTH = 12;

/**
 * A new canary: `cnry-<label>-<20 random hex>`, unique per call and invented.
 *
 * @stability beta
 */
export function createCanary(label = 'value'): string {
  const clean = label.replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'value';
  return `cnry-${clean}-${randomBytes(10).toString('hex')}`;
}

/**
 * Canaries for each label (or `count` canaries labelled `value1`, `value2`, ...), to seed as
 * passwords, codes or card security codes in a fake Vault and to scan for afterwards.
 *
 * @stability beta
 */
export function seedCanaries(labels: readonly string[] | number): string[] {
  const list = typeof labels === 'number' ? Array.from({ length: labels }, (_, i) => `value${i + 1}`) : labels;
  return list.map((label) => createCanary(label));
}

/** One place to scan. A bare string or bytes is content; `{ file }` / `{ files }` are paths (a folder is walked). @stability beta */
export type CanarySource =
  | string
  | Uint8Array
  | ArrayBuffer
  | { label: string; content: string | Uint8Array }
  | { file: string }
  | { files: readonly string[] }
  | readonly CanarySource[];

/** A canary found in a source. `canaryIndex` points into the list passed; the value is never repeated here. @stability beta */
export interface CanaryHit {
  canaryIndex: number;
  /** `text #n`, `bytes #n`, the label or the file path. */
  where: string;
  /** How it was written: `raw`, `json`, `url`, `base64`, `base64url`, `hex`, `utf16le`. */
  encoding: string;
}

/** Thrown by {@link assertNoCanary}. Its message names where and how, never the canary itself. @stability beta */
export class CanaryLeakError extends Error {
  constructor(readonly hits: readonly CanaryHit[]) {
    super(
      `A canary value leaked: ${hits
        .slice(0, 10)
        .map((h) => `canary #${h.canaryIndex} in ${h.where} (${h.encoding})`)
        .join('; ')}${hits.length > 10 ? `; and ${hits.length - 10} more` : ''}`,
    );
    this.name = 'CanaryLeakError';
  }
}

/** The base64 text that encodes `bytes` wherever they sit in a longer stream (three alignments). */
function base64Needles(bytes: Buffer): string[] {
  const out: string[] = [];
  for (let k = 0; k < 3; k += 1) {
    const encoded = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
    const start = Math.ceil((8 * k) / 6);
    const end = Math.floor((8 * (k + bytes.length)) / 6);
    if (end - start >= 8) out.push(encoded.slice(start, end));
  }
  return out;
}

interface Needle {
  canaryIndex: number;
  encoding: string;
  bytes: Buffer;
}

function needlesFor(canaries: readonly string[]): Needle[] {
  const needles: Needle[] = [];
  canaries.forEach((canary, canaryIndex) => {
    if (typeof canary !== 'string' || canary.length < MIN_CANARY_LENGTH) {
      throw new RangeError(`Canary #${canaryIndex} is shorter than ${MIN_CANARY_LENGTH} characters`);
    }
    const raw = Buffer.from(canary, 'utf8');
    const add = (encoding: string, text: string | Buffer) =>
      needles.push({ canaryIndex, encoding, bytes: typeof text === 'string' ? Buffer.from(text, 'utf8') : text });
    add('raw', raw);
    const json = JSON.stringify(canary).slice(1, -1);
    if (json !== canary) add('json', json);
    const url = encodeURIComponent(canary);
    if (url !== canary) add('url', url);
    add('hex', raw.toString('hex'));
    add('utf16le', Buffer.from(canary, 'utf16le'));
    for (const b64 of base64Needles(raw)) {
      add('base64', b64);
      const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_');
      if (b64url !== b64) add('base64url', b64url);
    }
  });
  return needles;
}

function walk(path: string, out: string[]): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry), out);
  } else if (stat.isFile()) {
    out.push(path);
  }
}

function collect(source: CanarySource, out: Array<{ where: string; bytes: Buffer }>, counter: { text: number; bytes: number }): void {
  if (typeof source === 'string') {
    counter.text += 1;
    out.push({ where: `text #${counter.text}`, bytes: Buffer.from(source, 'utf8') });
  } else if (source instanceof Uint8Array) {
    counter.bytes += 1;
    out.push({ where: `bytes #${counter.bytes}`, bytes: Buffer.from(source.buffer, source.byteOffset, source.byteLength) });
  } else if (source instanceof ArrayBuffer) {
    counter.bytes += 1;
    out.push({ where: `bytes #${counter.bytes}`, bytes: Buffer.from(source) });
  } else if (Array.isArray(source)) {
    for (const item of source) collect(item as CanarySource, out, counter);
  } else if ('content' in source) {
    out.push({ where: source.label, bytes: typeof source.content === 'string' ? Buffer.from(source.content, 'utf8') : Buffer.from(source.content) });
  } else {
    const paths: string[] = [];
    const list = 'file' in source ? [source.file] : (source as { files: readonly string[] }).files;
    for (const path of list) walk(path, paths);
    for (const path of paths) out.push({ where: path, bytes: readFileSync(path) });
  }
}

/**
 * Every place a canary appears in the sources, in any of the encodings a value usually takes on
 * its way into a log or an artifact (raw, JSON-escaped, URL-encoded, hex, UTF-16LE, base64 and
 * base64url at any alignment). Lower-case and upper-case variants of hex are both matched.
 *
 * @stability beta
 */
export function findCanaries(canaries: readonly string[], ...sources: CanarySource[]): CanaryHit[] {
  const needles = needlesFor(canaries);
  const haystacks: Array<{ where: string; bytes: Buffer }> = [];
  const counter = { text: 0, bytes: 0 };
  for (const source of sources) collect(source, haystacks, counter);
  const hits: CanaryHit[] = [];
  for (const { where, bytes } of haystacks) {
    const lowered = Buffer.from(bytes.toString('latin1').toLowerCase(), 'latin1');
    const seen = new Set<string>();
    for (const needle of needles) {
      const found = needle.encoding === 'hex' ? lowered.includes(needle.bytes) : bytes.includes(needle.bytes);
      const key = `${needle.canaryIndex}:${needle.encoding}`;
      if (found && !seen.has(key)) {
        seen.add(key);
        hits.push({ canaryIndex: needle.canaryIndex, where, encoding: needle.encoding });
      }
    }
  }
  return hits;
}

/**
 * Throws {@link CanaryLeakError} when any canary appears in any source (see {@link findCanaries}).
 * Pass a runtime's log text, trace exports, model transcripts, screenshot bytes or `{ files }`.
 *
 * @stability beta
 */
export function assertNoCanary(canaries: readonly string[], ...sources: CanarySource[]): void {
  const hits = findCanaries(canaries, ...sources);
  if (hits.length > 0) throw new CanaryLeakError(hits);
}
