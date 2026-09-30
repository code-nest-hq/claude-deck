import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { LOG_DAY_RE, type LogEntry } from '@ccui/shared';
import { DATA_DIR } from './store';

// Daily error log: <data dir>/logs/YYYY-MM-DD.jsonl (local date), one JSON entry per line, created on the first error
// of the day and appended to after that. Every entry is also pushed live to the Logs page (see index.ts).
const LOG_DIR = path.join(DATA_DIR, 'logs');
const pad = (n: number) => String(n).padStart(2, '0');
export const logDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fileOf = (day: string) => path.join(LOG_DIR, `${day}.jsonl`);

let listener: (e: LogEntry) => void = () => {};
export const onLog = (fn: (e: LogEntry) => void) => { listener = fn; };

let chain: Promise<void> = Promise.resolve(); // appends in order
export type LogInput = Omit<LogEntry, 'id' | 'ts'> & { id?: string };

const entryOf = (e: LogInput): LogEntry => ({ ...e, id: e.id ?? randomUUID(), ts: new Date().toISOString() });

/** records the entry and returns its id (the "error ID" shown to the user) */
export function logError(e: LogInput): string {
  const entry = entryOf(e);
  const line = JSON.stringify(entry) + '\n';
  chain = chain
    .then(async () => {
      await fs.mkdir(LOG_DIR, { recursive: true, mode: 0o700 });
      await fs.appendFile(fileOf(logDay(new Date(entry.ts))), line, { mode: 0o600 });
    })
    .catch((err) => console.error(`[logs] could not write the error log: ${(err as Error).message}`));
  try { listener(entry); } catch { /* a broken listener never loses the entry */ }
  return entry.id;
}

/** synchronous variant for a process that is about to die (uncaught exception) */
export function logErrorSync(e: LogInput): string {
  const entry = entryOf(e);
  try {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    appendFileSync(fileOf(logDay(new Date(entry.ts))), JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch { /* nothing left to report to */ }
  return entry.id;
}

export const errInfo = (err: unknown) => ({ message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });

/** entries of one day, oldest first; a torn last line (crash mid-write) is skipped */
export async function readLogs(day: string): Promise<LogEntry[]> {
  if (!LOG_DAY_RE.test(day)) return [];
  const text = await fs.readFile(fileOf(day), 'utf8').catch(() => '');
  return text.split('\n').flatMap((l) => { try { return l ? [JSON.parse(l) as LogEntry] : []; } catch { return []; } });
}

/** days that have a log file, newest first */
export async function logDays(): Promise<string[]> {
  const names = await fs.readdir(LOG_DIR).catch(() => [] as string[]);
  return names.map((n) => n.replace(/\.jsonl$/, '')).filter((d) => LOG_DAY_RE.test(d)).sort().reverse();
}
