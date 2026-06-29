import {
  CaretLeft,
  Camera,
  Check,
  Info,
  Minus,
  Plus,
  Sparkle,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type {
  LiftDetail,
  SessionSummary,
  TrainingWeekSummary,
  TrainingWeeksResponse,
} from '../../../contracts/training';
import { saveLiftLog } from '../api/training-weeks';
import { isLiftScheduledForFilming } from '../filming-schedule';
import { getProgressionGuidance } from '../progression-guidance';
import { ProgressionDrawer } from './ProgressionDrawer';

interface LiftLoggingProps {
  week: TrainingWeekSummary;
  session: SessionSummary;
  lift: LiftDetail;
  onBack: () => void;
  onSynced: () => void;
}

export function LiftLogging({
  week,
  session,
  lift,
  onBack,
  onSynced,
}: LiftLoggingProps) {
  const queryClient = useQueryClient();
  const initialWeight = lift.weight ?? '';
  const initialSets = lift.setResults.map((result) => result ?? '');
  const liftIndex = session.lifts.findIndex((candidate) => candidate.id === lift.id);
  const shouldFilm = isLiftScheduledForFilming(week.weekNumber, liftIndex);
  const progressionGuidance = getProgressionGuidance(
    lift.progression,
    lift.repTarget
  );
  const progressionButtonRef = useRef<HTMLButtonElement>(null);
  const [isProgressionOpen, setIsProgressionOpen] = useState(false);
  const [weight, setWeight] = useState(initialWeight);
  const [setResults, setSetResults] = useState(initialSets);
  const isDirty =
    weight !== initialWeight ||
    setResults.some((result, index) => result !== initialSets[index]);
  const hasExistingLog =
    lift.weight !== null || lift.setResults.some((result) => result !== null);
  const parsedWeight = parsePositiveDecimal(weight);
  const parsedSets = setResults.map(parseNonNegativeWholeNumber);
  const isValid =
    parsedWeight !== null && parsedSets.every((result) => result !== null);

  useEffect(() => {
    const warnOnUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnOnUnload);
    return () => window.removeEventListener('beforeunload', warnOnUnload);
  }, [isDirty]);

  const mutation = useMutation({
    mutationFn: saveLiftLog,
    onSuccess: (response: TrainingWeeksResponse) => {
      queryClient.setQueryData(['training-weeks'], response);
      onSynced();
    },
  });

  const validationMessage = useMemo(() => {
    if (!isDirty) {
      return null;
    }
    if (parsedWeight === null) {
      return 'Enter a positive working weight.';
    }
    const missingSet = parsedSets.findIndex((result) => result === null);
    return missingSet >= 0
      ? `Enter a whole-number result for set ${missingSet + 1}.`
      : null;
  }, [isDirty, parsedSets, parsedWeight]);

  const handleBack = () => {
    if (isDirty && !window.confirm('Discard the changes to this Lift Log?')) {
      return;
    }
    onBack();
  };

  const adjustWeight = (amount: number) => {
    const current = parsePositiveDecimal(weight);
    if (current === null || current + amount <= 0) {
      return;
    }
    setWeight(formatNumber(current + amount));
  };

  const handleSave = () => {
    if (!isValid || !isDirty || mutation.isPending) {
      return;
    }
    mutation.mutate({
      operation: 'save',
      weekId: week.id,
      session: session.name,
      liftId: lift.id,
      revision: lift.revision,
      weight: parsedWeight,
      setResults: parsedSets as number[],
    });
  };

  const handleClear = () => {
    if (
      !hasExistingLog ||
      mutation.isPending ||
      !window.confirm(
        `Clear the saved weight and set results for ${lift.name}?`
      )
    ) {
      return;
    }
    mutation.mutate({
      operation: 'clear',
      weekId: week.id,
      session: session.name,
      liftId: lift.id,
      revision: lift.revision,
    });
  };

  const dismissProgression = () => {
    setIsProgressionOpen(false);
    window.requestAnimationFrame(() => progressionButtonRef.current?.focus());
  };

  return (
    <section aria-labelledby="lift-heading">
      <header className="flex items-center gap-3 px-0.5">
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center rounded-control border border-border-subtle bg-surface text-xl font-bold text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          aria-label="Back to Workout Session"
          onClick={handleBack}
        >
          <CaretLeft aria-hidden="true" size={18} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <h1
            id="lift-heading"
            className="truncate text-lg font-black leading-tight tracking-display"
          >
            {lift.name}
          </h1>
          <p className="mt-0.5 font-mono text-[0.6875rem] text-text-muted">
            {session.name} · Week {week.weekNumber}
          </p>
        </div>
        {shouldFilm ? (
          <span
            className="grid size-10 shrink-0 place-items-center rounded-control border border-action-border bg-action-soft text-action"
            aria-label="Film one set for coach feedback"
            title="Film one set for coach feedback"
          >
            <Camera aria-hidden="true" size={21} weight="fill" />
          </span>
        ) : null}
      </header>

      {lift.progressionPrompt ? (
        <section className="progression-glow mt-3 rounded-card border border-complete/50 bg-[linear-gradient(180deg,rgb(52_210_123_/_0.16),rgb(52_210_123_/_0.05))] px-4 py-3">
          <div className="flex items-center gap-2 text-complete">
            <Sparkle aria-hidden="true" size={16} weight="fill" />
            <h2 className="text-[0.8125rem] font-extrabold">
              {lift.progressionPrompt.message}
            </h2>
          </div>
          {lift.progressionPrompt.recommendedWeight ? (
            <div className="mt-2 flex items-end justify-between gap-4">
              <p className="text-xs font-medium text-[#c8e9d6]">
                Suggested weight
              </p>
              <p className="font-mono text-xl font-extrabold">
                {lift.progressionPrompt.recommendedWeight}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {lift.progressionAchievement ? (
        <section
          className={`${lift.progressionPrompt ? 'mt-2' : 'mt-3'} flex items-center gap-2.5 rounded-control border border-complete/30 bg-complete-soft px-3.5 py-2.5`}
        >
          <span
            aria-hidden="true"
            className="grid size-5 shrink-0 place-items-center rounded-full bg-complete text-xs font-black text-[#04150b]"
          >
            <Check aria-hidden="true" size={12} weight="bold" />
          </span>
          <h2 className="text-xs font-bold text-[#c8e9d6]">
            {lift.progressionAchievement.message}
          </h2>
        </section>
      ) : null}

      <section className="mt-3 rounded-card border border-border-subtle bg-surface px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">
            Coach · Execution context
          </h2>
          {lift.progression ? (
            progressionGuidance ? (
              <button
                ref={progressionButtonRef}
                type="button"
                className="flex min-h-8 items-center gap-1.5 rounded-control border border-action-border bg-action-soft px-2.5 text-[0.6875rem] font-bold text-action transition-colors hover:bg-action-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                aria-haspopup="dialog"
                aria-expanded={isProgressionOpen}
                onClick={() => setIsProgressionOpen(true)}
              >
                {lift.progression}
                <Info aria-hidden="true" size={14} weight="bold" />
              </button>
            ) : (
              <span className="text-[0.6875rem] font-bold text-action">
                {lift.progression}
              </span>
            )
          ) : null}
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          <ContextValue value={String(lift.setCount)} label="Sets" />
          <ContextValue value={lift.repTarget} label="Reps" />
          <ContextValue value={lift.proximityToFailure || '—'} label="RIR" />
        </div>
        {lift.cue ? (
          <p className="mt-2.5 text-xs font-medium leading-5 text-text-secondary">
            “{lift.cue}”
          </p>
        ) : null}
      </section>

      {lift.previousLog ? (
        <section className="mt-2.5 flex items-center gap-3 rounded-control border border-dashed border-border-strong px-3.5 py-2.5">
          <h2 className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">
            Prev
          </h2>
          <p className="min-w-0 truncate font-mono text-xs text-text-secondary">
            Wk {lift.previousLog.weekNumber} · {lift.previousLog.weight || '—'}{' '}
            · {lift.previousLog.setResults.join(' · ')}
          </p>
        </section>
      ) : null}

      <fieldset className="mt-3">
        <legend className="sr-only">Lift Log values</legend>
        <div className="flex items-center justify-between rounded-card border border-border-subtle bg-surface-raised px-3.5 py-3">
          <button
            type="button"
            className="grid size-10 place-items-center rounded-control bg-surface-control text-xl font-bold text-text-muted disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Decrease working weight by 5"
            disabled={
              parsedWeight === null || parsedWeight <= 5 || mutation.isPending
            }
            onClick={() => adjustWeight(-5)}
          >
            <Minus aria-hidden="true" size={18} weight="bold" />
          </button>
          <label className="min-w-0 flex-1 text-center">
            <span className="sr-only">Working weight</span>
            <input
              className="w-full bg-transparent text-center text-2xl font-bold leading-none tracking-display text-text-primary outline-none placeholder:text-text-faint"
              inputMode="decimal"
              autoComplete="off"
              value={weight}
              placeholder="—"
              disabled={mutation.isPending}
              onChange={(event) => setWeight(event.target.value)}
            />
            <span className="mt-1 block font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-muted">
              Working weight
            </span>
          </label>
          <button
            type="button"
            className="grid size-10 place-items-center rounded-control bg-surface-control text-xl font-bold text-action disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Increase working weight by 5"
            disabled={parsedWeight === null || mutation.isPending}
            onClick={() => adjustWeight(5)}
          >
            <Plus aria-hidden="true" size={18} weight="bold" />
          </button>
        </div>
        <div
          className="mt-2.5 grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${lift.setCount}, minmax(0, 1fr))`,
          }}
        >
          {setResults.map((result, index) => (
            <label
              key={index}
              className={`rounded-card border-[1.5px] bg-surface-raised px-2 py-2.5 text-center focus-within:border-action ${
                parsedSets[index] !== null
                  ? 'border-complete/50'
                  : 'border-border-subtle'
              }`}
            >
              <span className="sr-only">Set {index + 1} result</span>
              <input
                className="w-full bg-transparent text-center font-mono text-xl font-bold text-text-primary outline-none placeholder:text-text-faint"
                inputMode="numeric"
                autoComplete="off"
                value={result}
                placeholder="—"
                disabled={mutation.isPending}
                onChange={(event) =>
                  setSetResults((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item
                    )
                  )
                }
              />
              <span className="mt-1 block font-mono text-[0.5625rem] font-semibold uppercase text-text-muted">
                Set {index + 1}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-2 min-h-10" aria-live="polite">
        {mutation.isError ? (
          <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
            {mutation.error.message}
          </p>
        ) : validationMessage ? (
          <p className="px-1 text-xs font-medium text-partial">
            {validationMessage}
          </p>
        ) : null}
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-app gap-2.5 border-t border-border-subtle bg-nav/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:border-x">
        <button
          type="button"
          className="h-12 rounded-card bg-surface-control px-4 text-xs font-bold text-text-muted transition-colors hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          disabled={!hasExistingLog || mutation.isPending}
          onClick={handleClear}
        >
          Clear
        </button>
        <button
          type="button"
          className="h-12 flex-1 rounded-card bg-action px-4 text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 disabled:cursor-not-allowed disabled:bg-surface-control disabled:text-text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          disabled={!isValid || !isDirty || mutation.isPending}
          onClick={handleSave}
        >
          {mutation.isPending ? 'Syncing…' : 'Save Lift Log'}
        </button>
      </footer>

      {isProgressionOpen && progressionGuidance ? (
        <ProgressionDrawer
          guidance={progressionGuidance}
          onDismiss={dismissProgression}
        />
      ) : null}
    </section>
  );
}

function ContextValue({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-control bg-surface-control px-2 py-2 text-center">
      <p className="font-mono text-sm font-bold">{value}</p>
      <p className="mt-0.5 font-mono text-[0.5625rem] font-medium uppercase text-text-muted">
        {label}
      </p>
    </div>
  );
}

function parsePositiveDecimal(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeWholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3)));
}
