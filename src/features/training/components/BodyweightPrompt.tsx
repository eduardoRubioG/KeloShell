export function BodyweightPrompt() {
  return (
    <button
      type="button"
      className="group mt-5 flex w-full items-center gap-3 rounded-card border border-action-border bg-action-soft px-3.5 py-3 text-left transition-colors hover:bg-action-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-control bg-action-muted text-lg font-extrabold leading-none text-action"
        aria-hidden="true"
      >
        +
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-bold">
          Log today’s bodyweight
        </span>
        <span className="mt-0.5 block text-[0.6875rem] font-medium text-text-muted">
          Apr 24 · no value yet
        </span>
      </span>
      <span
        className="text-xl font-bold text-text-faint transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      >
        ›
      </span>
    </button>
  );
}
