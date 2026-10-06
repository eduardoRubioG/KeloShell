import { describe, expect, it } from 'vitest';

import { resolveCoachTemplate } from '../coach-templates/registry';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';
import { readTrainingWeeks } from '../services/training';
import {
  FakeSpreadsheet,
  fakeSpreadsheetOf,
  workoutSessionGrids,
} from '../testing/fake-spreadsheet';
import { handleLiftLogRequest } from './lift-log';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

const emilyEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  EMILY_GOOGLE_SPREADSHEET_ID: 'emily-sheet-id',
  EMILY_EMAIL: 'emily@example.com',
  LOCAL_AUTH_BYPASS: 'true',
};

describe('PUT /api/lift-log', () => {
  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleLiftLogRequest(
      new Request('https://example.com/api/lift-log', { method: 'PUT' }),
      configuredEnv
    );
    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods and malformed logs', async () => {
    const methodResponse = await handleLiftLogRequest(
      new Request('http://localhost/api/lift-log'),
      configuredEnv
    );
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('allow')).toBe('PUT');

    const invalidResponse = await handleLiftLogRequest(
      jsonRequest({
        operation: 'save',
        weekId: '2026-06-28',
        session: 'Upper A',
        liftId: 'test-lift',
        revision: 'revision',
        weight: 100,
        setResults: [8, null, 7],
      }),
      configuredEnv
    );
    expect(invalidResponse.status).toBe(400);
  });

  it('returns a conflict when the loaded lift revision is stale', async () => {
    const response = await handleLiftLogRequest(
      jsonRequest({
        operation: 'clear',
        weekId: WEEK_ID,
        session: 'Upper A',
        liftId: 'test-lift',
        revision: 'stale',
      }),
      configuredEnv,
      () => fourSessionSheet()
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'The Lift Log changed since it was loaded.',
    });
  });

  it('writes into the discovered tab of the requested Workout Session', async () => {
    const sheet = fourSessionSheet();
    const revision = await revisionFor(sheet, 'Lower A');

    const response = await handleLiftLogRequest(
      saveRequest('Lower A', revision),
      configuredEnv,
      () => sheet
    );

    expect(response.status).toBe(200);
    expect(await weightCell(sheet, 'Lower A')).toBe(135);
    expect(await weightCell(sheet, 'Upper A')).toBe('');
    expect(await weightCell(sheet, 'Upper B')).toBe('');
    expect(await weightCell(sheet, 'Lower B')).toBe('');
  });

  it('follows a renamed and reordered Workout Session tab', async () => {
    const sheet = fourSessionSheet();
    sheet.rename('Lower A', 'Legs');
    sheet.reorder(['Legs', 'Upper A', 'Upper B', 'Lower B']);
    const revision = await revisionFor(sheet, 'Legs');

    const response = await handleLiftLogRequest(
      saveRequest('Legs', revision),
      configuredEnv,
      () => sheet
    );

    expect(response.status).toBe(200);
    expect(await weightCell(sheet, 'Legs')).toBe(135);
    expect(await weightCell(sheet, 'Upper A')).toBe('');
  });

  it('writes into the right tab of a 3-session sheet for Emily', async () => {
    const sheet = fakeSpreadsheetOf(
      [sessionGrids(), sessionGrids(), sessionGrids()],
      ['Full A', 'Full B', 'Full C']
    );
    const revision = await revisionFor(sheet, 'Full B');

    const response = await handleLiftLogRequest(
      saveRequest('Full B', revision, '?as=emily'),
      emilyEnv,
      () => sheet
    );

    expect(response.status).toBe(200);
    expect(await weightCell(sheet, 'Full B')).toBe(135);
    expect(await weightCell(sheet, 'Full A')).toBe('');
    expect(await weightCell(sheet, 'Full C')).toBe('');
  });

  it('rejects a Workout Session that was not discovered', async () => {
    const sheet = fourSessionSheet();
    const revision = await revisionFor(sheet, 'Lower A');

    const response = await handleLiftLogRequest(
      saveRequest('Full A', revision),
      configuredEnv,
      () => sheet
    );

    expect(response.status).toBe(400);
    expect(await weightCell(sheet, 'Lower A')).toBe('');
  });

  it('never writes into an unrelated tab', async () => {
    const sheet = new FakeSpreadsheet([
      { title: 'Notes', cells: [['Remember', 'to stretch'], ['hello']] },
      { title: 'Upper A', ...sessionGrids() },
    ]);
    const notes = JSON.stringify(
      await sheet.readRanges(["'Notes'!A:B"], 'UNFORMATTED_VALUE')
    );
    const revision = await revisionFor(sheet, 'Upper A');

    const unrelated = await handleLiftLogRequest(
      saveRequest('Notes', revision),
      configuredEnv,
      () => sheet
    );
    expect(unrelated.status).toBe(400);

    const ok = await handleLiftLogRequest(
      saveRequest('Upper A', revision),
      configuredEnv,
      () => sheet
    );
    expect(ok.status).toBe(200);
    expect(
      JSON.stringify(
        await sheet.readRanges(["'Notes'!A:B"], 'UNFORMATTED_VALUE')
      )
    ).toBe(notes);
  });
});

const WEEK_ID = '2026-06-28';

function sessionGrids() {
  return workoutSessionGrids([
    { weeks: [{ displayDate: '6/28', rawDate: WEEK_ID }] },
  ]);
}

function fourSessionSheet(): FakeSpreadsheet {
  return fakeSpreadsheetOf([
    sessionGrids(),
    sessionGrids(),
    sessionGrids(),
    sessionGrids(),
  ]);
}

function saveRequest(session: string, revision: string, query = ''): Request {
  return jsonRequest(
    {
      operation: 'save',
      weekId: WEEK_ID,
      session,
      liftId: 'test-lift',
      revision,
      weight: 135,
      setResults: [8, 8, 7],
    },
    query
  );
}

async function revisionFor(
  sheet: SpreadsheetGateway,
  session: string
): Promise<string> {
  const weeks = await readTrainingWeeks(sheet, resolveCoachTemplate('eduardo'));
  const lift = weeks.weeks[0].sessions
    .find((candidate) => candidate.name === session)!
    .lifts.find((candidate) => candidate.id === 'test-lift')!;
  return lift.revision;
}

/** Weight cell (column B) of the single logged week row, 8th row of the tab. */
async function weightCell(
  sheet: SpreadsheetGateway,
  tab: string
): Promise<unknown> {
  const [grid] = await sheet.readRanges([`'${tab}'!B7`], 'UNFORMATTED_VALUE');
  return grid[0]?.[0] ?? '';
}

function jsonRequest(body: unknown, query = ''): Request {
  return new Request(`http://localhost/api/lift-log${query}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
