import type {
  SessionStatus,
  SessionSummary,
} from '../model/session-summary';

const sessionStyles: Record<SessionStatus, string> = {
  complete:
    'border-complete-border bg-complete-soft text-text-primary hover:bg-complete-soft-hover',
  partial:
    'border-partial-border bg-partial-soft text-text-primary hover:bg-partial-soft-hover',
  'not-started':
    'border-border-subtle bg-surface-raised text-text-secondary hover:border-border-strong',
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
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-3.5 rounded-session border px-4 py-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${sessionStyles[session.status]}`}
      aria-label={`${session.name}: ${session.statusLabel}, ${session.completedLifts} of ${session.totalLifts} lifts complete`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold tracking-tight">
          {session.name}
        </span>
        <span
          className={`mt-0.5 block font-mono text-[0.6875rem] font-semibold uppercase ${sessionAccentStyles[session.status]}`}
        >
          {session.statusLabel}
        </span>
      </span>
      <span
        className={`text-[1.375rem] font-black tracking-tight ${sessionAccentStyles[session.status]}`}
        aria-hidden="true"
      >
        {session.completedLifts}/{session.totalLifts}
      </span>
    </button>
  );
}
