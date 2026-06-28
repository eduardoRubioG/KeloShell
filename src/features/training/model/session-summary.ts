export type SessionStatus = 'complete' | 'partial' | 'not-started';

export interface SessionSummary {
  name: string;
  status: SessionStatus;
  statusLabel: string;
  completedLifts: number;
  totalLifts: number;
}

export const sessionSummaries: readonly SessionSummary[] = [
  {
    name: 'Upper A',
    status: 'complete',
    statusLabel: 'Complete',
    completedLifts: 6,
    totalLifts: 6,
  },
  {
    name: 'Lower A',
    status: 'complete',
    statusLabel: 'Complete',
    completedLifts: 5,
    totalLifts: 5,
  },
  {
    name: 'Upper B',
    status: 'partial',
    statusLabel: 'Partial · 3 logged',
    completedLifts: 3,
    totalLifts: 6,
  },
  {
    name: 'Lower B',
    status: 'not-started',
    statusLabel: 'Not started',
    completedLifts: 0,
    totalLifts: 5,
  },
] as const;
