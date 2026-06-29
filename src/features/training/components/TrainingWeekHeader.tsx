import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';

import type { TrainingWeekSummary } from '../../../contracts/training';

interface TrainingWeekHeaderProps {
  week: TrainingWeekSummary;
  previousWeekId?: string;
  nextWeekId?: string;
  onSelectWeek: (weekId: string) => void;
}

export function TrainingWeekHeader({
  week,
  previousWeekId,
  nextWeekId,
  onSelectWeek,
}: TrainingWeekHeaderProps) {
  const completionPercent =
    week.availability === 'available' ? week.completedSessions * 25 : 0;
  const dateLabel = formatWeekDateRange(week.startDate, week.endDate);
  const ringStyle = {
    background: `conic-gradient(var(--color-complete) 0 ${completionPercent}%, var(--color-track) ${completionPercent}% 100%)`,
  } satisfies CSSProperties;

  return (
    <header className="px-1.5">
      <div className="flex items-center gap-5">
        <div
          className="grid size-24 shrink-0 place-items-center rounded-full"
          style={ringStyle}
          role="img"
          aria-label={
            week.availability === 'available'
              ? `${week.completedSessions} of 4 Workout Sessions complete`
              : 'Training Week unavailable'
          }
        >
          <div className="grid size-[4.625rem] place-items-center rounded-full bg-canvas text-center">
            <div>
              <p className="font-sans text-[1.75rem] font-black leading-none">
                {week.availability === 'available'
                  ? week.completedSessions
                  : '—'}
                <span className="text-base text-text-faint">/4</span>
              </p>
              <p className="mt-1 font-mono text-[0.5625rem] font-semibold uppercase tracking-label text-text-muted">
                {week.availability === 'available' ? 'Complete' : 'Pending'}
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
            Training Week
          </p>
          <h1 className="mt-1 whitespace-nowrap text-[2.25rem] font-black leading-none tracking-display">
            Week {week.weekNumber}
          </h1>
          <time
            dateTime={week.startDate}
            className="mt-2 block text-xs font-medium text-text-muted"
          >
            {dateLabel}
          </time>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-y border-border-subtle py-2">
        <WeekControl
          direction="previous"
          weekId={previousWeekId}
          onSelectWeek={onSelectWeek}
        />
        <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">
          Browse weeks
        </span>
        <WeekControl
          direction="next"
          weekId={nextWeekId}
          onSelectWeek={onSelectWeek}
        />
      </div>
    </header>
  );
}

interface WeekControlProps {
  direction: 'previous' | 'next';
  weekId?: string;
  onSelectWeek: (weekId: string) => void;
}

function WeekControl({ direction, weekId, onSelectWeek }: WeekControlProps) {
  const label = direction === 'previous' ? 'Previous week' : 'Next week';
  const DirectionIcon = direction === 'previous' ? CaretLeft : CaretRight;
  return (
    <button
      type="button"
      className="grid size-9 place-items-center rounded-control border border-border-subtle bg-surface text-xl font-bold text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      disabled={!weekId}
      aria-label={label}
      onClick={() => weekId && onSelectWeek(weekId)}
    >
      <DirectionIcon aria-hidden="true" size={18} weight="bold" />
    </button>
  );
}

function formatWeekDateRange(startDate: string, endDate: string): string {
  const start = dateParts(startDate);
  const end = dateParts(endDate);
  const startYear = startDate.slice(0, 4);
  const endYear = endDate.slice(0, 4);
  const range =
    start.month === end.month
      ? `${start.month} ${start.day}–${end.day}`
      : `${start.month} ${start.day}–${end.month} ${end.day}`;
  const years =
    startYear === endYear ? startYear : `${startYear}–${endYear.slice(2)}`;
  return `${range} · ${years}`;
}

function dateParts(isoDate: string): { month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(`${isoDate}T00:00:00Z`));
  return {
    month: parts.find((part) => part.type === 'month')?.value ?? '',
    day: parts.find((part) => part.type === 'day')?.value ?? '',
  };
}
