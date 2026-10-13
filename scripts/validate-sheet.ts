import { existsSync, readFileSync } from 'node:fs';

import { resolveCoachTemplate } from '../functions/coach-templates/registry';
import { GoogleSheetsClient } from '../functions/lib/google-sheets';
import { todayLocalCalendarDate } from '../functions/lib/local-date';
import { parseValidateSheetArgs, runValidateSheet } from './validate-sheet-core';

/** Reads KEY="value" lines from .dev.vars; comments and blank lines are skipped. */
function loadDevVars(path = '.dev.vars'): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) {
      continue;
    }
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    let value = match[2];
    if (/^(".*"|'.*')$/.test(value)) {
      value = value.slice(1, -1);
    }
    vars[match[1]] = value;
  }
  return vars;
}

/** Returns the process exit code. Read-only against the spreadsheet. */
export async function main(argv: readonly string[]): Promise<number> {
  const { spreadsheetId, date } = parseValidateSheetArgs(argv);
  // Real environment variables win over .dev.vars.
  const env = { ...loadDevVars(), ...process.env } as Record<string, string | undefined>;
  const clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set in the environment or .dev.vars.'
    );
  }

  const gateway = new GoogleSheetsClient({ clientEmail, privateKey, spreadsheetId });
  const result = await runValidateSheet(
    gateway,
    resolveCoachTemplate(),
    date ?? todayLocalCalendarDate(env)
  );
  console.log(result.output);
  return result.exitCode;
}
