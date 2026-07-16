import {
  ArrowLeft,
  ArrowRight,
  Check,
  Minus,
  Plus,
  Warning,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate, useSearch } from '@tanstack/react-router';

import type { StepsResponse, DailyStepsEntry } from '../../contracts/steps';
import { parsePositiveInteger } from '../../shared/parse-number';
import { todayLocalIsoDate } from '../body/local-date';
import { fetchSteps, saveDailySteps } from './api/steps';
import {
  entryValue,
  previousRecordedEntry,
  sortStepsEntries,
  stepsTrend,
} from './steps-view';

const RECENT_COUNT = 5;
const STEP_INCREMENT = 500;

export function StepsPage() {
  const { date: selectedDate } = useSearch({ from: '/steps' });
  const navigate = useNavigate({ from: '/steps' });
  const today = todayLocalIsoDate();
  const query = useQuery({
    queryKey: ['steps', today],
    queryFn: () => fetchSteps(today),
  });

  if (query.isPending) {
    return <StepsPageLoading />;
  }

  if (query.isError) {
    return (
      <StepsPageMessage
        eyebrow="Steps"
        title="Steps tracking is unavailable"
        detail={query.error.message}
        action={
          <button
            type="button"
            className="rounded-control bg-action px-4 py-2.5 text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        }
      />
    );
  }

  if (!query.data || query.data.entries.length === 0) {
    return (
      <StepsPageMessage
        eyebrow="Steps"
        title="No entries found"
        detail="The Steps tab does not contain any rows yet."
      />
    );
  }

  const entries = sortStepsEntries(query.data.entries);
  if (selectedDate) {
    const activeEntry = entries.find((entry) => entry.date === selectedDate);
    if (!activeEntry) {
      return (
        <StepsPageMessage
          eyebrow="Daily Steps"
          title="Date unavailable"
          detail="That date is not available for step tracking."
          action={
            <button
              type="button"
              className="rounded-control bg-action px-4 py-2.5 text-sm font-extrabold text-action-ink"
              onClick={() => void navigate({ search: { date: undefined }, replace: true })}
            >
              Back to Steps
            </button>
          }
        />
      );
    }

    return (
      <StepsEditor
        key={activeEntry.date}
        entry={activeEntry}
        entries={entries}
        today={today}
      />
    );
  }

  return <StepsHub entries={entries} today={today} />;
}

function StepsHub({ entries, today }: { entries: DailyStepsEntry[]; today: string }) {
  const navigate = useNavigate({ from: '/steps' });
  const todayEntry = entries.find((entry) => entry.date === today);
  const trend = stepsTrend(entries, today);
  const recentEntries = entries
    .filter((entry) => entry.date <= today)
    .slice(-RECENT_COUNT)
    .reverse();

  const openEntry = (date: string) => {
    void navigate({ search: { date } });
  };

  return (
    <section className="px-1" aria-labelledby="steps-heading">
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
        Steps
      </p>
      <h1 id="steps-heading" className="mt-2 text-[2.375rem] font-black leading-none tracking-display">
        Steps
      </h1>

      {todayEntry && !todayEntry.hasValue ? (
        <button
          type="button"
          className="mt-4 flex w-full items-center gap-3 rounded-card border border-action/35 bg-action-soft px-4 py-3.5 text-left transition-colors hover:bg-action-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          onClick={() => openEntry(todayEntry.date)}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-action-muted text-action">
            <Warning aria-hidden="true" size={18} weight="fill" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">Log today&apos;s steps</span>
            <span className="mt-0.5 block font-mono text-[0.6875rem] text-text-muted">
              {formatShortDate(todayEntry.date)} · no value yet
            </span>
          </span>
          <ArrowRight aria-hidden="true" size={17} weight="bold" className="shrink-0 text-action" />
        </button>
      ) : null}

      <AverageCard trend={trend} />

      <section className="mt-5" aria-labelledby="recent-steps-heading">
        <div className="flex items-baseline justify-between px-1">
          <h2 id="recent-steps-heading" className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
            Recent Steps
          </h2>
          <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">steps</span>
        </div>
        <ul className="mt-2 space-y-2">
          {recentEntries.map((entry) => (
            <li key={entry.date}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-card border border-border-subtle bg-surface-raised px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                onClick={() => openEntry(entry.date)}
              >
                <span className="min-w-0 flex-1 text-sm font-bold text-text-secondary">
                  {formatShortDate(entry.date)}
                  {entry.date === today ? (
                    <span className="ml-2 rounded-full bg-action-muted px-2 py-0.5 font-mono text-[0.5625rem] font-semibold uppercase text-action">Today</span>
                  ) : null}
                </span>
                <span className={`font-mono text-sm font-bold ${entry.hasValue ? 'text-text-primary' : 'text-text-faint'}`}>
                  {formatStepsCell(entry)}
                </span>
                <ArrowRight aria-hidden="true" size={15} className="text-text-faint" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function AverageCard({ trend }: { trend: ReturnType<typeof stepsTrend> }) {
  const recordedDays = trend.values.filter((value) => value !== null).length;

  return (
    <section
      className="mt-4 overflow-hidden rounded-card border border-border-subtle bg-surface-raised"
      aria-labelledby="steps-average-heading"
    >
      <div className="flex items-start justify-between gap-4 px-4 py-4">
        <div>
          <h2 id="steps-average-heading" className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
            7-Day Average
          </h2>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[2rem] font-black leading-none tracking-display">
              {trend.average === null ? '—' : formatSteps(trend.average)}
            </span>
            <span className="font-mono text-[0.625rem] font-semibold uppercase text-text-faint">steps/day</span>
          </div>
        </div>
        <span className="mt-6 font-mono text-xs font-semibold text-text-faint">
          {recordedDays === 0
            ? 'Not enough data'
            : `${recordedDays} of last 7 logged`}
        </span>
      </div>
    </section>
  );
}

interface StepsEditorProps {
  entry: DailyStepsEntry;
  entries: DailyStepsEntry[];
  today: string;
}

function StepsEditor({ entry, entries, today }: StepsEditorProps) {
  const navigate = useNavigate({ from: '/steps' });
  const queryClient = useQueryClient();
  const selectedChipRef = useRef<HTMLButtonElement>(null);
  const initialSteps = entry.hasValue && entry.steps !== null ? entry.steps.replace(/,/g, '') : '';
  const [steps, setSteps] = useState(initialSteps);
  const parsedSteps = parsePositiveInteger(steps);
  const isDirty = steps !== initialSteps;
  const trend = stepsTrend(entries, entry.date);
  const previousEntry = previousRecordedEntry(entries, entry.date);

  const recentEntries = entries.filter((dateEntry) => dateEntry.date <= today);

  useBlocker({
    shouldBlockFn: () => !window.confirm('Discard your unsaved step changes?'),
    enableBeforeUnload: isDirty,
    disabled: !isDirty,
  });

  useEffect(() => {
    selectedChipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, []);

  const mutation = useMutation({
    mutationFn: saveDailySteps,
    onSuccess: (response: StepsResponse) => {
      queryClient.setQueryData(['steps', today], response);
      const updated = response.entries.find((item) => item.date === entry.date);
      setSteps(updated?.hasValue && updated.steps !== null ? updated.steps.replace(/,/g, '') : '');
    },
  });

  const selectDate = (date: string) => {
    mutation.reset();
    void navigate({ search: { date } });
  };

  const adjustSteps = (amount: number) => {
    const current = parsePositiveInteger(steps) ?? 0;
    const next = current + amount;
    if (next <= 0) {
      setSteps('');
    } else {
      setSteps(String(next));
    }
    mutation.reset();
  };

  const handleSave = () => {
    if (parsedSteps === null || !isDirty || mutation.isPending) {
      return;
    }
    mutation.mutate({
      operation: 'save',
      date: entry.date,
      steps: parsedSteps,
      revision: entry.revision,
      today,
    });
  };

  const handleClear = () => {
    if (!entry.hasValue || mutation.isPending || !window.confirm(`Clear the saved steps for ${formatDate(entry.date)}?`)) {
      return;
    }
    mutation.mutate({ operation: 'clear', date: entry.date, revision: entry.revision, today });
  };

  return (
    <section className="-mx-1" aria-labelledby="daily-steps-heading">
      <header className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back to Steps"
          className="grid size-9 shrink-0 place-items-center rounded-control border border-border-subtle bg-surface text-text-secondary transition-colors hover:bg-surface-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          onClick={() => void navigate({ search: { date: undefined } })}
        >
          <ArrowLeft aria-hidden="true" size={18} weight="bold" />
        </button>
        <div className="min-w-0">
          <h1 id="daily-steps-heading" className="truncate text-lg font-black leading-tight tracking-display">Daily Steps</h1>
          <p className="mt-0.5 font-mono text-[0.6875rem] text-text-muted">Steps · {formatMonth(entry.date)}</p>
        </div>
      </header>

      <div className="-mx-3 mt-4 flex snap-x gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Step tracking dates">
        {recentEntries.map((dateEntry) => {
          const isSelected = dateEntry.date === entry.date;
          return (
            <button
              key={dateEntry.date}
              ref={isSelected ? selectedChipRef : undefined}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${formatDate(dateEntry.date)}, ${dateEntry.hasValue ? 'recorded' : 'no value'}`}
              className={`flex min-w-[3.35rem] snap-center flex-col items-center rounded-control border px-2 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${
                isSelected
                  ? 'border-action bg-action-soft text-action'
                  : 'border-border-subtle bg-surface text-text-muted hover:bg-surface-control'
              }`}
              onClick={() => selectDate(dateEntry.date)}
            >
              <span className="text-sm font-extrabold">{formatDay(dateEntry.date)}</span>
              <span className="mt-1 flex h-3 items-center font-mono text-[0.5625rem] font-semibold uppercase">
                {dateEntry.date === today ? 'Today' : dateEntry.hasValue ? <Check aria-hidden="true" size={11} weight="bold" /> : '—'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-control border border-border-subtle bg-surface px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">Previous</p>
          <p className="mt-1 truncate text-xs font-bold text-text-secondary">
            {previousEntry ? `${formatShortDate(previousEntry.date)} · ${previousEntry.steps}` : 'No earlier value'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">7-day avg</p>
          <p className="mt-1 font-mono text-xs font-bold text-text-secondary">
            {trend.average === null ? '—' : formatSteps(trend.average)}
          </p>
        </div>
      </div>

      <section className="mt-4" aria-labelledby="entry-date-heading">
        <h2 id="entry-date-heading" className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
          {formatDate(entry.date)}
        </h2>
        <div className="mt-2 flex items-center justify-between rounded-card border border-action/25 bg-surface-raised px-3.5 py-4">
          <button
            type="button"
            className="grid size-11 place-items-center rounded-control bg-surface-control text-text-muted disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            aria-label={`Decrease steps by ${STEP_INCREMENT}`}
            disabled={(parsedSteps ?? 0) <= 0 || mutation.isPending}
            onClick={() => adjustSteps(-STEP_INCREMENT)}
          >
            <Minus aria-hidden="true" size={19} weight="bold" />
          </button>
          <label className="min-w-0 flex-1 text-center">
            <span className="sr-only">Daily Steps</span>
            <input
              className="w-full bg-transparent text-center text-[2rem] font-black leading-none tracking-display text-text-primary outline-none placeholder:text-text-faint"
              inputMode="numeric"
              autoComplete="off"
              value={steps}
              placeholder="—"
              disabled={mutation.isPending}
              onChange={(event) => {
                setSteps(event.target.value.replace(/[^\d]/g, ''));
                mutation.reset();
              }}
            />
            <span className="mt-1 block font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-muted">steps</span>
          </label>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-control bg-surface-control text-action disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            aria-label={`Increase steps by ${STEP_INCREMENT}`}
            disabled={mutation.isPending}
            onClick={() => adjustSteps(STEP_INCREMENT)}
          >
            <Plus aria-hidden="true" size={19} weight="bold" />
          </button>
        </div>
      </section>

      <div className="mt-3 min-h-10" aria-live="polite">
        {mutation.isError ? (
          <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{mutation.error.message}</p>
        ) : isDirty && parsedSteps === null ? (
          <p className="px-1 text-xs font-medium text-partial">Enter a positive whole-number step count.</p>
        ) : mutation.isSuccess ? (
          <p className="flex items-center gap-1.5 px-1 text-xs font-bold text-complete">
            <Check aria-hidden="true" size={14} weight="bold" /> Synced to spreadsheet
          </p>
        ) : null}
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-app gap-2.5 border-t border-border-subtle bg-nav/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:border-x">
        <button
          type="button"
          className="h-12 rounded-card bg-surface-control px-4 text-xs font-bold text-text-muted transition-colors hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          disabled={!entry.hasValue || mutation.isPending}
          onClick={handleClear}
        >
          Clear
        </button>
        <button
          type="button"
          className="h-12 flex-1 rounded-card bg-action px-4 text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 disabled:cursor-not-allowed disabled:bg-surface-control disabled:text-text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          disabled={parsedSteps === null || !isDirty || mutation.isPending}
          onClick={handleSave}
        >
          {mutation.isPending ? 'Syncing…' : mutation.isSuccess && !isDirty ? 'Synced' : 'Save Daily Steps'}
        </button>
      </footer>
    </section>
  );
}

function formatStepsCell(entry: DailyStepsEntry): string {
  const value = entryValue(entry);
  return value === null ? '—' : formatSteps(value);
}

function formatSteps(value: number): string {
  return value.toLocaleString('en-US');
}

function formatDate(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMonth(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatDay(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('en-US', { day: 'numeric' });
}

function localDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function StepsPageLoading() {
  return (
    <div aria-label="Loading Steps" aria-busy="true">
      <div className="px-1">
        <div className="h-2.5 w-24 animate-pulse rounded bg-track" />
        <div className="mt-3 h-10 w-20 animate-pulse rounded bg-surface-control" />
      </div>
      <div className="mt-5 h-16 animate-pulse rounded-card border border-border-subtle bg-surface-raised" />
      <div className="mt-4 h-24 animate-pulse rounded-card border border-border-subtle bg-surface-raised" />
      <div className="mt-5 space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-card bg-surface-raised" />
        ))}
      </div>
    </div>
  );
}

interface StepsPageMessageProps {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}

function StepsPageMessage({ eyebrow, title, detail, action }: StepsPageMessageProps) {
  return (
    <section className="max-w-sm px-1 pt-8" aria-live="polite">
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">{eyebrow}</p>
      <h1 className="mt-2 text-[2rem] font-black leading-none tracking-display">{title}</h1>
      <p className="mt-4 text-sm font-medium leading-6 text-text-muted">{detail}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
