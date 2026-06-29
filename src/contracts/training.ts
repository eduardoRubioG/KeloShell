export type SessionName = 'Upper A' | 'Lower A' | 'Upper B' | 'Lower B';

export type SessionStatus = 'complete' | 'partial' | 'not-started';

export type TrainingWeekStatus = SessionStatus;

export interface LiftLogSnapshot {
  weekId: string;
  weekNumber: number;
  weight: string;
  setResults: string[];
}

export interface ProgressionPrompt {
  message: string;
  recommendedWeight: string | null;
  sourceWeekNumber: number;
}

export interface ProgressionAchievement {
  message: string;
}

export interface LiftDetail {
  id: string;
  revision: string;
  name: string;
  status: SessionStatus;
  progression: string;
  setCount: number;
  repTarget: string;
  proximityToFailure: string;
  cue: string;
  weight: string | null;
  setResults: Array<string | null>;
  previousLog: LiftLogSnapshot | null;
  progressionPrompt: ProgressionPrompt | null;
  progressionAchievement: ProgressionAchievement | null;
}

export interface SessionSummary {
  name: SessionName;
  status: SessionStatus;
  completedLifts: number;
  totalLifts: number;
  lifts: LiftDetail[];
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

export type LiftLogRequest =
  | {
      operation: 'save';
      weekId: string;
      session: SessionName;
      liftId: string;
      revision: string;
      weight: number;
      setResults: number[];
    }
  | {
      operation: 'clear';
      weekId: string;
      session: SessionName;
      liftId: string;
      revision: string;
    };
