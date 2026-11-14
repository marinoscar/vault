// =============================================================================
// A small 5-field cron parser and next-run calculator (no dependency)
// =============================================================================
//
// Enough of Vixie cron to validate what `vault backup schedule` installs and to
// show when it runs next: `*`, numbers, ranges (`1-5`), lists (`1,15`), steps
// (`*/6`, `0-12/3`), month and weekday names (`jan`, `mon`), weekday 7 = Sunday,
// and the `@hourly` / `@daily` / `@weekly` / `@monthly` / `@yearly` shorthands.
// Day of month and day of week follow cron's rule: when both are restricted, a
// day matches if EITHER matches. Times are the machine's local time, like cron.
// Everything here is pure.
// =============================================================================

export interface CronSchedule {
  /** The normalised 5-field expression. */
  expression: string;
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek: number[];
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: string[];
  /** Offset of names[0] (months start at 1). */
  nameBase?: number;
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  { name: 'day of week', min: 0, max: 7, names: DAY_NAMES, nameBase: 0 },
];

function parseValue(raw: string, spec: FieldSpec): number {
  const lower = raw.toLowerCase();
  if (spec.names) {
    const idx = spec.names.indexOf(lower);
    if (idx >= 0) return idx + (spec.nameBase ?? 0);
  }
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${spec.name} value "${raw}"`);
  const n = Number(raw);
  if (n < spec.min || n > spec.max) throw new Error(`${spec.name} must be ${spec.min}-${spec.max} (got ${raw})`);
  return n;
}

function parseField(text: string, spec: FieldSpec): { values: number[]; restricted: boolean } {
  const out = new Set<number>();
  let restricted = true;
  for (const part of text.split(',')) {
    if (part === '') throw new Error(`Empty item in the ${spec.name} field`);
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) throw new Error(`Invalid ${spec.name} "${part}"`);
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) throw new Error(`Invalid step "${stepPart}" in the ${spec.name} field`);
      step = Number(stepPart);
    }
    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = spec.min;
      hi = spec.name === 'day of week' ? 6 : spec.max;
      if (stepPart === undefined && text === '*') restricted = false;
    } else if (rangePart!.includes('-')) {
      const [a, b, more] = rangePart!.split('-');
      if (more !== undefined || !a || !b) throw new Error(`Invalid range "${rangePart}" in the ${spec.name} field`);
      lo = parseValue(a, spec);
      hi = parseValue(b, spec);
      if (lo > hi) throw new Error(`Range ${rangePart} in the ${spec.name} field goes backwards`);
    } else {
      lo = parseValue(rangePart!, spec);
      hi = stepPart === undefined ? lo : spec.name === 'day of week' ? 6 : spec.max;
    }
    for (let v = lo; v <= hi; v += step) out.add(spec.name === 'day of week' && v === 7 ? 0 : v);
  }
  return { values: [...out].sort((a, b) => a - b), restricted };
}

/**
 * Parse and validate a cron expression (5 fields, or an `@` shorthand).
 * Throws an Error that says what is wrong.
 */
export function parseCron(expression: string): CronSchedule {
  const trimmed = expression.trim().replace(/\s+/g, ' ');
  const expanded = MACROS[trimmed.toLowerCase()] ?? trimmed;
  if (expanded.startsWith('@')) throw new Error(`Unsupported shorthand "${trimmed}" (use 5 fields, e.g. "30 2 * * *")`);
  const parts = expanded.split(' ');
  if (parts.length !== 5 || parts.some((p) => p === '')) {
    throw new Error(`A cron expression has 5 fields: minute hour day-of-month month day-of-week (got ${parts.filter(Boolean).length})`);
  }
  const [mi, ho, dom, mo, dow] = parts.map((p, i) => parseField(p, FIELDS[i]!));
  return {
    expression: expanded,
    minutes: mi!.values,
    hours: ho!.values,
    daysOfMonth: dom!.values,
    months: mo!.values,
    daysOfWeek: dow!.values,
    domRestricted: dom!.restricted,
    dowRestricted: dow!.restricted,
  };
}

/** Whether an expression is valid; the error message otherwise. */
export function validateCron(expression: string): { ok: true; schedule: CronSchedule } | { ok: false; error: string } {
  try {
    return { ok: true, schedule: parseCron(expression) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function dayMatches(s: CronSchedule, date: Date): boolean {
  if (!s.months.includes(date.getMonth() + 1)) return false;
  const domOk = s.daysOfMonth.includes(date.getDate());
  const dowOk = s.daysOfWeek.includes(date.getDay());
  if (s.domRestricted && s.dowRestricted) return domOk || dowOk;
  if (s.domRestricted) return domOk;
  if (s.dowRestricted) return dowOk;
  return true;
}

/** How far ahead to look before giving up (e.g. "0 0 30 2 *" never runs). */
const SEARCH_DAYS = 366 * 5;

/**
 * The next `count` run times strictly after `from`, in local time. Returns
 * fewer when the expression never fires within five years.
 */
export function nextRuns(schedule: CronSchedule | string, from: Date, count = 1): Date[] {
  const s = typeof schedule === 'string' ? parseCron(schedule) : schedule;
  const out: Date[] = [];
  const start = from.getTime();
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < SEARCH_DAYS && out.length < count; i++) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i);
    if (!dayMatches(s, d)) continue;
    for (const h of s.hours) {
      for (const m of s.minutes) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
        // A time skipped by a DST change lands in another hour; skip it.
        if (t.getHours() !== h || t.getMinutes() !== m) continue;
        if (t.getTime() <= start) continue;
        out.push(t);
        if (out.length >= count) return out;
      }
    }
  }
  return out;
}

/** The next run after `from`, or undefined. */
export function nextRun(schedule: CronSchedule | string, from: Date): Date | undefined {
  return nextRuns(schedule, from, 1)[0];
}

export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Parse a weekday given as a name (`mon`, `Monday`) or a number 0-7. */
export function parseWeekday(raw: string): number {
  const v = raw.trim().toLowerCase();
  if (/^\d$/.test(v) && Number(v) <= 7) return Number(v) % 7;
  let idx = DAY_NAMES.indexOf(v);
  if (idx < 0) idx = WEEKDAY_LONG.findIndex((d) => d.toLowerCase() === v);
  if (idx < 0) throw new Error(`Unknown day "${raw}" (use sun, mon, tue, wed, thu, fri, sat or 0-6)`);
  return idx;
}

/**
 * A sentence for the common shapes ("Every day at 02:30", "Every 6 hours",
 * "Every Monday at 03:00"), else "cron: <expr>". Pure.
 */
export function describeCron(expression: string): string {
  const v = validateCron(expression);
  if (!v.ok) return `cron: ${expression}`;
  const s = v.schedule;
  const [mi, ho, dom, mo, dow] = s.expression.split(' ');
  const single = (f: string | undefined) => f !== undefined && /^\d+$/.test(f);
  const anyDay = dom === '*' && mo === '*';
  if (single(mi) && single(ho) && anyDay && dow === '*') return `Every day at ${pad2(Number(ho))}:${pad2(Number(mi))}`;
  if (single(mi) && single(ho) && anyDay && s.dowRestricted && s.daysOfWeek.length === 1) {
    return `Every ${WEEKDAY_LONG[s.daysOfWeek[0]!]} at ${pad2(Number(ho))}:${pad2(Number(mi))}`;
  }
  if (single(mi) && anyDay && dow === '*') {
    if (ho === '*') return Number(mi) === 0 ? 'Every hour' : `Every hour at :${pad2(Number(mi))}`;
    const step = /^\*\/(\d+)$/.exec(ho ?? '');
    if (step) return `Every ${step[1]} hours${Number(mi) ? ` at :${pad2(Number(mi))}` : ''}`;
  }
  return `cron: ${s.expression}`;
}
