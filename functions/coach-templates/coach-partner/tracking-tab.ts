import type { DailyBodyweightEntry } from '../../../src/contracts/body';

/** 0-based column of the Month header (column G) on a Tracking tab. */
export const MONTH_COLUMN = 6;

export interface TrackingEntry {
  entry: DailyBodyweightEntry;
  tab: string;
  cell: string;
  /** 1-based sheet row of the entry. */
  row: number;
}

/** A discovered Tracking tab: shared by Daily Bodyweight and Measurement Check-Ins. */
export interface TrackingTab {
  title: string;
  entries: TrackingEntry[];
  /** 0-based row of the Month header. */
  monthHeaderRow: number;
  rawRows: readonly unknown[][];
  formattedRows: readonly unknown[][];
}
