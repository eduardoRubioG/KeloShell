export function BodyPage() {
  return (
    <section className="px-1" aria-labelledby="body-heading">
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
        Body Tracking
      </p>
      <h1
        id="body-heading"
        className="mt-2 text-[2.375rem] font-black leading-none tracking-display"
      >
        Body
      </h1>
      <p className="mt-4 max-w-sm text-sm font-medium leading-6 text-text-muted">
        Daily Bodyweight and Measurement Check-Ins will live here.
      </p>
    </section>
  );
}
