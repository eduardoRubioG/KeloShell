export type StreakKey = 'creatine' | 'bodyweight' | 'workouts';

export interface StreakSummary {
  key: StreakKey;
  count: number;
  unit: 'day' | 'week';
  active: boolean;
  todayComplete: boolean;
}

export interface BodyweightPrompt {
  date: string;
}

export interface StreaksResponse {
  today: string;
  streaks: StreakSummary[];
  bodyweightPrompt: BodyweightPrompt | null;
}

export interface CreatineLogRequest {
  operation: 'log' | 'unlog';
  date: string;
}
