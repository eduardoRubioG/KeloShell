import type { MeasurementCheckInStatus } from '../../contracts/measurements';

export function CheckInStatusBadge({ status }: { status: MeasurementCheckInStatus }) {
  if (status === 'complete') {
    return (
      <span className="rounded-full bg-complete-soft px-2 py-0.5 font-mono text-[0.5625rem] font-semibold uppercase text-complete">
        Complete
      </span>
    );
  }

  if (status === 'partial') {
    return (
      <span className="rounded-full bg-partial-soft px-2 py-0.5 font-mono text-[0.5625rem] font-semibold uppercase text-partial">
        Partial
      </span>
    );
  }

  return (
    <span className="rounded-full bg-surface-control px-2 py-0.5 font-mono text-[0.5625rem] font-semibold uppercase text-text-faint">
      Empty
    </span>
  );
}
