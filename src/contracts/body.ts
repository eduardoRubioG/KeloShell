export interface DailyBodyweightEntry {
  date: string;
  weight: string | null;
  hasValue: boolean;
  revision: string;
}

export interface BodyweightResponse {
  tabAvailable: boolean;
  entries: DailyBodyweightEntry[];
}

export type DailyBodyweightRequest =
  | { operation: 'save'; date: string; weight: number; revision: string }
  | { operation: 'clear'; date: string; revision: string };
