export type SessionName = 'Upper A' | 'Lower A' | 'Upper B' | 'Lower B';

export type SessionStatus = 'complete' | 'partial' | 'not-started';

export type TrainingWeekStatus = SessionStatus;

export interface SessionSummary {
  name: SessionName;
  status: SessionStatus;
  completedLifts: number;
  totalLifts: number;
}

export interface TrainingWeekSummary {
  id: string;
  weekNumber: number;
  startDate: string;
  endDate: string;
  availability: 'available' | 'unavailable';
  status: TrainingWeekStatus | null;
  completedSessions: number;
  sessions: SessionSummary[];
}

export interface TrainingWeeksResponse {
  defaultWeekId: string | null;
  weeks: TrainingWeekSummary[];
}

export interface ApiErrorResponse {
  error: string;
}
