import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Rule 6 guard, added with the Supabase foundation (rollout step 3, #49).
 *
 * Isolation rule 6 in #8: "the service role is used only by reminder
 * dispatch, the Sheet Health sweep and operator scripts". This test is the
 * code-side proof. It scans every tracked file for the service-role key name
 * and fails when the name appears outside ALLOWLIST. It also covers the
 * private-alpha checklist item "the service-role key is not in the browser
 * bundle": any match under `src/` (the PWA) fails whatever the allowlist says.
 *
 * Adding an entry to ALLOWLIST is a reviewed one-line change. Expected
 * additions: the enrol and import operator scripts (sign-in and tenancy,
 * step 4), reminder dispatch (step 5) and the Sheet Health sweep (step 8).
 * Never add anything under `src/`.
 */
const KEY_NAME = 'SUPABASE_SERVICE_ROLE_KEY';

/** Paths where the key name is expected. Globs: `*` in a segment, `**` across. */
const ALLOWLIST: string[] = [
  // The isolation suite builds a service-role client for fixtures.
  'supabase/tests/**',
  // This guard names the key in order to search for it (exact path, not a glob).
  'scripts/service-role-key-guard.test.ts',
  // Documentation may describe the key.
  '**/*.md',
];

/** The PWA ships to browsers; the key must never appear here. */
const FORBIDDEN_PREFIX = 'src/';

interface ScannedFile {
  path: string;
  lines: string[];
}

interface Violation {
  path: string;
  line: number;
}

const globToRegExp = (glob: string): RegExp => {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      source += '[^/]*';
    } else {
      source += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
};

const isAllowlisted = (path: string, allowlist: string[]): boolean =>
  allowlist.some((glob) => globToRegExp(glob).test(path));

const findViolations = (
  files: ScannedFile[],
  allowlist: string[]
): Violation[] => {
  const violations: Violation[] = [];
  for (const { path, lines } of files) {
    const forbidden = path.startsWith(FORBIDDEN_PREFIX);
    if (!forbidden && isAllowlisted(path, allowlist)) continue;
    lines.forEach((text, index) => {
      if (text.includes(KEY_NAME)) violations.push({ path, line: index + 1 });
    });
  }
  return violations;
};

const formatViolations = (violations: Violation[]): string =>
  [
    `${KEY_NAME} found outside the allowlist (isolation rule 6, #8):`,
    ...violations.map((v) => `  ${v.path}:${v.line}`),
  ].join('\n');

const repoRoot = resolve(__dirname, '..');

const scanTrackedFiles = (): ScannedFile[] => {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const files: ScannedFile[] = [];
  for (const path of listed) {
    let buffer: Buffer;
    try {
      buffer = readFileSync(resolve(repoRoot, path));
    } catch (error) {
      // Deleted in the working tree, or a submodule directory. Anything else
      // must fail loudly rather than hide a match.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') continue;
      throw error;
    }
    // Binary or UTF-16 files are still searched: a NUL byte must not hide the
    // key. Latin-1 keeps every byte, so an ASCII name is always found.
    const text = buffer.includes(0)
      ? buffer.toString('latin1').replace(/\0/g, '')
      : buffer.toString('utf8');
    files.push({ path, lines: text.split(/\r?\n/) });
  }
  return files;
};

describe('service-role key guard (isolation rule 6)', () => {
  const file = (path: string, ...lines: string[]): ScannedFile => ({
    path,
    lines,
  });

  it('flags a match outside the allowlist with path and line', () => {
    const violations = findViolations(
      [file('functions/api/x.ts', 'ok', `const k = env.${KEY_NAME};`)],
      ALLOWLIST
    );
    expect(violations).toEqual([{ path: 'functions/api/x.ts', line: 2 }]);
  });

  it('accepts an allowlisted match', () => {
    const files = [
      file('supabase/tests/support/env.ts', KEY_NAME),
      file('docs/agents/notes.md', KEY_NAME),
      file('README.md', KEY_NAME),
    ];
    expect(findViolations(files, ALLOWLIST)).toEqual([]);
  });

  it('flags the PWA even when the allowlist includes src/**', () => {
    const violations = findViolations(
      [file('src/lib/client.ts', 'a', 'b', KEY_NAME)],
      [...ALLOWLIST, 'src/**']
    );
    expect(violations).toEqual([{ path: 'src/lib/client.ts', line: 3 }]);
  });

  it('flags Markdown under src/ too', () => {
    expect(
      findViolations([file('src/notes.md', KEY_NAME)], ALLOWLIST)
    ).toHaveLength(1);
  });

  it('allowlists the guard by exact path only', () => {
    const files = [file('scripts/other.test.ts', KEY_NAME)];
    expect(findViolations(files, ALLOWLIST)).toHaveLength(1);
  });

  it('does not match a different variable name', () => {
    expect(
      findViolations([file('functions/a.ts', 'SUPABASE_ANON_KEY')], ALLOWLIST)
    ).toEqual([]);
  });

  it('lists path:line for every violation in the failure message', () => {
    const message = formatViolations([
      { path: 'functions/a.ts', line: 4 },
      { path: 'src/b.ts', line: 9 },
    ]);
    expect(message).toContain('functions/a.ts:4');
    expect(message).toContain('src/b.ts:9');
  });

  it('passes on the tracked files in this repository', () => {
    const violations = findViolations(scanTrackedFiles(), ALLOWLIST);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
