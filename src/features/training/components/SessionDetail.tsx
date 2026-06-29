import { Camera, CaretLeft, Sparkle } from '@phosphor-icons/react';

import type {
  LiftDetail,
  SessionStatus,
  SessionSummary,
  TrainingWeekSummary,
} from '../../../contracts/training';
import { isLiftScheduledForFilming } from '../filming-schedule';

const statusLabels: Record<SessionStatus, string> = {
  complete: 'Complete',
  partial: 'Partial',
  'not-started': 'Not started',
};

const statusTextStyles: Record<SessionStatus, string> = {
  complete: 'text-complete',
  partial: 'text-partial',
  'not-started': 'text-text-faint',
};

interface SessionDetailProps {
  week: TrainingWeekSummary;
  session: SessionSummary;
  syncedAt: number;
  onBack: () => void;
  onSelectLift: (lift: LiftDetail) => void;
}

export function SessionDetail({
  week,
  session,
  syncedAt,
  onBack,
  onSelectLift,
}: SessionDetailProps) {
  const completionPercent =
    session.totalLifts === 0
      ? 0
      : (session.completedLifts / session.totalLifts) * 100;
  const nextIncompleteIndex = session.lifts.findIndex(
    (lift) => lift.status !== 'complete'
  );

  return (
    <section>
      <header className="px-0.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-control border border-border-subtle bg-surface text-xl font-bold text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              aria-label="Back to Training Week"
              onClick={onBack}
            >
              <CaretLeft aria-hidden="true" size={18} weight="bold" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[1.375rem] font-black leading-none tracking-display">
                {session.name}
              </h1>
              <p className="mt-1 font-mono text-[0.6875rem] font-medium text-text-muted">
                Week {week.weekNumber} · {formatSyncAge(syncedAt)}
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full bg-current/10 px-2.5 py-1 text-[0.6875rem] font-bold ${statusTextStyles[session.status]}`}
          >
            {statusLabels[session.status]}
          </span>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-track">
          <div
            className="h-full rounded-full bg-complete transition-[width] duration-300"
            style={{ width: `${completionPercent}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-[0.6875rem] font-medium text-text-faint">
          {session.completedLifts} of {session.totalLifts} lifts complete
        </p>
      </header>

      <div className="mt-4 grid gap-2.5">
        {session.lifts.map((lift, index) => (
          <LiftRow
            key={lift.id}
            lift={lift}
            index={index}
            emphasized={index === nextIncompleteIndex}
            shouldFilm={isLiftScheduledForFilming(week.weekNumber, index)}
            onSelect={() => onSelectLift(lift)}
          />
        ))}
      </div>
    </section>
  );
}

function LiftRow({
  lift,
  index,
  emphasized,
  shouldFilm,
  onSelect,
}: {
  lift: LiftDetail;
  index: number;
  emphasized: boolean;
  shouldFilm: boolean;
  onSelect: () => void;
}) {
  const hasLog =
    lift.weight !== null || lift.setResults.some((result) => result !== null);
  const actionLabel =
    lift.status === 'complete' ? 'Edit' : lift.status === 'partial' ? 'Fix' : 'Log';

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-3 rounded-card border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${
        lift.status === 'complete'
          ? 'border-complete/50 bg-surface-raised hover:border-complete/70'
          : emphasized
          ? 'border-action/40 bg-surface'
          : 'border-border-subtle bg-surface-raised hover:border-border-strong'
      }`}
      aria-label={`${actionLabel} ${lift.name}${
        lift.progressionAchievement ? '. Progression target reached' : ''
      }${
        shouldFilm ? '. Film one set for coach feedback' : ''
      }`}
      onClick={onSelect}
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <LiftStatus status={lift.status} index={index} />
        {shouldFilm ? (
          <span
            className="grid size-[1.375rem] place-items-center text-action"
            title="Film one set for coach feedback"
          >
            <Camera aria-hidden="true" size={17} weight="fill" />
          </span>
        ) : null}
        {lift.progressionAchievement ? (
          <span
            className="grid size-[1.375rem] place-items-center text-progression"
            title={lift.progressionAchievement.message}
          >
            <Sparkle aria-hidden="true" size={17} weight="fill" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-extrabold leading-tight">
          {lift.name}
        </span>
        <span className="mt-1 block truncate font-mono text-[0.625rem] font-medium text-text-muted">
          {lift.setCount} × {lift.repTarget}
          {lift.progression ? ` · ${lift.progression}` : ''}
        </span>
      </span>
      {hasLog ? (
        <span className="shrink-0 text-right font-mono">
          <span className="block text-sm font-bold text-text-primary">
            {lift.weight ?? '—'}
          </span>
          <span
            className={`mt-1 block text-[0.625rem] font-medium ${statusTextStyles[lift.status]}`}
          >
            {formatSetResults(lift.setResults)}
          </span>
        </span>
      ) : (
        <span
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
            emphasized
              ? 'bg-action text-action-ink'
              : 'bg-surface-control text-text-muted'
          }`}
        >
          {actionLabel}
        </span>
      )}
    </button>
  );
}

function LiftStatus({ status, index }: { status: SessionStatus; index: number }) {
  return (
    <span
      className={`grid size-[1.375rem] shrink-0 place-items-center rounded-full border font-mono text-[0.5625rem] font-bold ${
        status === 'partial'
          ? 'border-partial text-partial'
          : 'border-border-strong text-text-faint'
      }`}
      aria-label={`Lift ${index + 1}: ${statusLabels[status]}`}
    >
      {index + 1}
    </span>
  );
}

function formatSetResults(results: Array<string | null>): string {
  return results.map((result) => result ?? '—').join(' · ');
}

function formatSyncAge(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  return minutes < 1 ? 'Synced just now' : `Synced ${minutes}m ago`;
}
