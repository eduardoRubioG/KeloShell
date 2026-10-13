import type { CoachTemplate } from '../coach-templates/types';
import type { FormatProblem } from '../lib/format-problems';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

/**
 * Everything a Coach Template found when reading a Source Spreadsheet: the
 * discovered Workout Sessions and Tracking tabs, and every format problem.
 * Template-agnostic: callers never see tab names, labels or cell layout beyond
 * what the adapter reports.
 */
export interface ValidationReport {
  /** The Local Calendar Date the current Tracking tab was chosen for. */
  date: string;
  /** Workout Session names in Session Order. */
  sessions: string[];
  /** Tracking tab titles in spreadsheet order. */
  trackingTabs: string[];
  /** The Tracking tab holding `date`, or null. */
  currentTrackingTab: string | null;
  /** Every problem, from Training, Tracking and Measurement Check-Ins. */
  problems: FormatProblem[];
}

/**
 * Reads (never writes) a Source Spreadsheet through its Coach Template and
 * reports what was discovered and every problem. Shared by the validate
 * script and, later, the enrol script and the Sheet Health sweep.
 * `today` is a Local Calendar Date, YYYY-MM-DD.
 */
export async function validateSourceSpreadsheet(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  today: string
): Promise<ValidationReport> {
  const training = await template.training.readTraining(gateway);
  const tracking = await template.tracking.readTracking(gateway, today);
  const measurements = await template.tracking.readMeasurements(gateway);
  const tabs = await template.tracking.listTrackingTabs(gateway, today);

  return {
    date: today,
    sessions: training.sessions,
    trackingTabs: tabs.tabs,
    currentTrackingTab: tabs.currentTab,
    problems: uniqueProblems([
      ...training.problems,
      ...tracking.problems,
      ...measurements.problems,
    ]),
  };
}

// Tracking and Measurement reads can report the same problem (no Tracking tab).
function uniqueProblems(problems: readonly FormatProblem[]): FormatProblem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = JSON.stringify([problem.code, problem.tab, problem.cell, problem.message]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
