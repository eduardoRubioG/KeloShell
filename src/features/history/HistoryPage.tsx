export function HistoryPage() {
  return (
    <section className="px-1" aria-labelledby="history-heading">
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
        Training Log
      </p>
      <h1
        id="history-heading"
        className="mt-2 text-[2.375rem] font-black leading-none tracking-display"
      >
        History
      </h1>
      <p className="mt-4 max-w-sm text-sm font-medium leading-6 text-text-muted">
        Previous Training Weeks and Synced Entries will live here.
      </p>
    </section>
  );
}
