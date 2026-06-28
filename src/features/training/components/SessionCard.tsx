import type {
  SessionStatus,
  SessionSummary,
} from '../../../contracts/training';

const sessionStyles: Record<SessionStatus, string> = {
  complete:
    'border-complete-border bg-complete-soft text-text-primary',
  partial:
    'border-partial-border bg-partial-soft text-text-primary',
  'not-started':
    'border-border-subtle bg-surface-raised text-text-secondary',
};

const sessionAccentStyles: Record<SessionStatus, string> = {
  complete: 'text-complete',
  partial: 'text-partial',
  'not-started': 'text-text-faint',
};

interface SessionCardProps {
  session: SessionSummary;
}

export function SessionCard({ session }: SessionCardProps) {
  const statusLabel =
    session.status === 'complete'
      ? 'Complete'
      : session.status === 'partial'
        ? session.completedLifts > 0
          ? `Partial · ${session.completedLifts} complete`
          : 'Partial'
        : 'Not started';

  return (
    <article
      className={`flex w-full items-center gap-3.5 rounded-session border px-4 py-3.5 text-left ${sessionStyles[session.status]}`}
      aria-label={`${session.name}: ${statusLabel}, ${session.completedLifts} of ${session.totalLifts} lifts complete`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold tracking-tight">
          {session.name}
        </span>
        <span
          className={`mt-0.5 block font-mono text-[0.6875rem] font-semibold uppercase ${sessionAccentStyles[session.status]}`}
        >
          {statusLabel}
        </span>
      </span>
      <span
        className={`text-[1.375rem] font-black tracking-tight ${sessionAccentStyles[session.status]}`}
        aria-hidden="true"
      >
        {session.completedLifts}/{session.totalLifts}
      </span>
    </article>
  );
}
