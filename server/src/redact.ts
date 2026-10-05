// Best-effort secret masking for the session export. A safety net for patterns we know, not a guarantee.
export type RedactionCounts = Record<string, number>;

const SECRET_NAME = /(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|credential|authorization)/i;

// [type, regex, template]: $1/$2 re-insert the regex's capture groups, TAG is the [REDACTED:type] marker; order matters (specific before generic)
const PATTERNS: Array<[string, RegExp, string]> = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, 'TAG'],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g, 'TAG'],
  ['api-key', /\bsk-[A-Za-z0-9_-]{20,}/g, 'TAG'],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, 'TAG'],
  ['aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'TAG'],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, 'TAG'],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 'TAG'],
  ['bearer', /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, '$1TAG'],
  ['url-credentials', /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi, '$1TAG$2'],
  // KEY=value / KEY: value in env files and shell output (upper-case names only: lower-case prose like "token: x" stays)
  ['env-secret', /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*\s*[=:]\s*["']?)[^\s"']{6,}/g, '$1TAG'],
  // "someKey": "value" inside JSON text
  ['json-secret', /("[A-Za-z0-9_-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_-]*"\s*:\s*")[^"]{6,}(")/gi, '$1TAG$2'],
];

/** masks the known secret shapes in a string; counts each hit by type */
export function redactString(s: string, counts: RedactionCounts): string {
  let out = s;
  for (const [type, re, template] of PATTERNS) {
    out = out.replace(re, (...args: unknown[]) => {
      counts[type] = (counts[type] ?? 0) + 1;
      const caps = args.slice(1, -2) as Array<string | undefined>; // match, ...groups, offset, input
      return template.replace(/\$(\d)/g, (_m, n: string) => caps[Number(n) - 1] ?? '').replace('TAG', `[REDACTED:${type}]`);
    });
  }
  return out;
}

/** deep copy of `v` with every string masked; a string under a secret-looking key is masked whole */
export function redactDeep<T>(v: T, counts: RedactionCounts): T {
  const walk = (x: unknown, key?: string): unknown => {
    if (typeof x === 'string') {
      if (key && SECRET_NAME.test(key) && x.length >= 6) { counts['secret-field'] = (counts['secret-field'] ?? 0) + 1; return '[REDACTED:secret-field]'; }
      return redactString(x, counts);
    }
    if (Array.isArray(x)) return x.map((i) => walk(i));
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, walk(val, k)]));
    return x;
  };
  return walk(v) as T;
}
