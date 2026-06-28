export function TrainingWeekHeader() {
  return (
    <header className="flex items-center gap-5 px-1.5">
      <div
        className="grid size-24 shrink-0 place-items-center rounded-full bg-[conic-gradient(var(--color-complete)_0_75%,var(--color-track)_75%_100%)]"
        role="img"
        aria-label="Three of four Workout Sessions complete"
      >
        <div className="grid size-[4.625rem] place-items-center rounded-full bg-canvas text-center">
          <div>
            <p className="font-sans text-[1.75rem] font-black leading-none">
              3<span className="text-base text-text-faint">/4</span>
            </p>
            <p className="mt-1 font-mono text-[0.5625rem] font-semibold uppercase tracking-label text-text-muted">
              Complete
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
          Training Week
        </p>
        <h1 className="mt-1 text-[2.375rem] font-black leading-[0.92] tracking-display">
          Week
          <br />
          14
        </h1>
        <p className="mt-2 text-xs font-medium text-text-muted">Apr 21–27</p>
      </div>
    </header>
  );
}
