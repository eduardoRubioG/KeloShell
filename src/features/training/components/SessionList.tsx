import { sessionSummaries } from '../model/session-summary';
import { SessionCard } from './SessionCard';

export function SessionList() {
  return (
    <section className="mt-5" aria-labelledby="sessions-heading">
      <h2
        id="sessions-heading"
        className="px-1 text-[1.0625rem] font-extrabold"
      >
        Sessions
      </h2>
      <div className="mt-2 grid gap-2.5">
        {sessionSummaries.map((session) => (
          <SessionCard key={session.name} session={session} />
        ))}
      </div>
    </section>
  );
}
