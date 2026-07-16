export interface DailyStepsEntry {
  date: string;
  steps: string | null;
  hasValue: boolean;
  revision: string;
}

export interface StepsResponse {
  tabAvailable: boolean;
  today: string;
  entries: DailyStepsEntry[];
}

export type DailyStepsRequest =
  | { operation: 'save'; date: string; steps: number; revision: string }
  | { operation: 'clear'; date: string; revision: string };
