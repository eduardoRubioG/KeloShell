import type { SessionSummary } from '../../../contracts/training';
import { SessionCard } from './SessionCard';

interface SessionListProps {
  sessions: SessionSummary[];
}

export function SessionList({ sessions }: SessionListProps) {
  return (
    <section className="mt-5" aria-labelledby="sessions-heading">
      <h2
        id="sessions-heading"
        className="px-1 text-[1.0625rem] font-extrabold"
      >
        Sessions
      </h2>
      <div className="mt-2 grid gap-2.5">
        {sessions.map((session) => (
          <SessionCard key={session.name} session={session} />
        ))}
      </div>
    </section>
  );
}
