import {
  ArrowLeft,
  ArrowRight,
  Check,
  Minus,
  Plus,
  TrendDown,
  TrendUp,
  Warning,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate, useSearch } from '@tanstack/react-router';

import type { BodyweightResponse, DailyBodyweightEntry } from '../../contracts/body';
import { formatNumber, parsePositiveDecimal } from '../../shared/parse-number';
import { fetchBodyweight, saveDailyBodyweight } from './api/bodyweight';
import {
  bodyweightTrend,
  previousRecordedEntry,
  sortBodyweightEntries,
  sparklineSegments,
} from './bodyweight-view';
import { todayLocalIsoDate } from './local-date';

const RECENT_COUNT = 4;
const SPARKLINE_WIDTH = 304;
const SPARKLINE_HEIGHT = 84;

export function BodyPage() {
  const { date: selectedDate } = useSearch({ from: '/body' });
  const navigate = useNavigate({ from: '/body' });
  const query = useQuery({
    queryKey: ['bodyweight'],
    queryFn: fetchBodyweight,
  });

  if (query.isPending) {
    return <BodyPageLoading />;
  }

  if (query.isError) {
    return (
      <BodyPageMessage
        eyebrow="Source Spreadsheet"
        title="Body Tracking is unavailable"
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
      <BodyPageMessage
        eyebrow="Body Tracking"
        title="No entries found"
        detail="The Source Spreadsheet does not contain any bodyweight rows yet."
      />
    );
  }

  const entries = sortBodyweightEntries(query.data.entries);
  if (selectedDate) {
    const activeEntry = entries.find((entry) => entry.date === selectedDate);
    if (!activeEntry) {
      return (
        <BodyPageMessage
          eyebrow="Daily Bodyweight"
          title="Date unavailable"
          detail="That date is not available in the Source Spreadsheet."
          action={
            <button
              type="button"
              className="rounded-control bg-action px-4 py-2.5 text-sm font-extrabold text-action-ink"
              onClick={() => void navigate({ search: { date: undefined }, replace: true })}
            >
              Back to Body
            </button>
          }
        />
      );
    }

    return <BodyweightEditor key={activeEntry.date} entry={activeEntry} entries={entries} />;
  }

  return <BodyHub entries={entries} />;
}

function BodyHub({ entries }: { entries: DailyBodyweightEntry[] }) {
  const navigate = useNavigate({ from: '/body' });
  const today = todayLocalIsoDate();
  const todayEntry = entries.find((entry) => entry.date === today);
  const trend = bodyweightTrend(entries, today);
  const recentEntries = entries.filter((entry) => entry.date <= today).slice(-RECENT_COUNT).reverse();

  const openEntry = (date: string) => {
    void navigate({ search: { date } });
  };

  return (
    <section className="px-1" aria-labelledby="body-heading">
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
        Body Tracking
      </p>
      <h1 id="body-heading" className="mt-2 text-[2.375rem] font-black leading-none tracking-display">
        Body
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
            <span className="block text-sm font-extrabold">Log today&apos;s bodyweight</span>
            <span className="mt-0.5 block font-mono text-[0.6875rem] text-text-muted">
              {formatShortDate(todayEntry.date)} · no value yet
            </span>
          </span>
          <ArrowRight aria-hidden="true" size={17} weight="bold" className="shrink-0 text-action" />
        </button>
      ) : null}

      <TrendCard trend={trend} />

      <section className="mt-5" aria-labelledby="recent-bodyweight-heading">
        <div className="flex items-baseline justify-between px-1">
          <h2 id="recent-bodyweight-heading" className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
            Recent Bodyweight
          </h2>
          <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">lbs</span>
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
                  {entry.weight ?? '—'}
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

function TrendCard({ trend }: { trend: ReturnType<typeof bodyweightTrend> }) {
  const segments = sparklineSegments(trend.values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT);
  const change = trend.change;
  const hasChange = change !== null && Math.abs(change) >= 0.05;
  const ChangeIcon = change !== null && change > 0 ? TrendUp : TrendDown;

  return (
    <section className="mt-4 overflow-hidden rounded-card border border-border-subtle bg-surface-raised" aria-labelledby="bodyweight-trend-heading">
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div>
          <h2 id="bodyweight-trend-heading" className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
            7-Day Trend
          </h2>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[2rem] font-black leading-none tracking-display">
              {trend.latest === null ? '—' : formatWeight(trend.latest)}
            </span>
            <span className="font-mono text-[0.625rem] font-semibold uppercase text-text-faint">lbs</span>
          </div>
        </div>
        {hasChange ? (
          <span className={`mt-6 flex items-center gap-1 font-mono text-xs font-bold ${change < 0 ? 'text-complete' : 'text-partial'}`}>
            <ChangeIcon aria-hidden="true" size={15} weight="bold" />
            {formatWeight(Math.abs(change))} lbs
          </span>
        ) : (
          <span className="mt-6 font-mono text-xs font-semibold text-text-faint">
            {change === null ? 'Not enough data' : 'No change'}
          </span>
        )}
      </div>

      <div className="px-3 pb-3 pt-2" aria-hidden="true">
        <svg className="h-[5.25rem] w-full overflow-visible" viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="bodyweight-trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-action)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--color-action)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="6" x2={SPARKLINE_WIDTH - 6} y1={SPARKLINE_HEIGHT - 6} y2={SPARKLINE_HEIGHT - 6} stroke="var(--color-border-subtle)" />
          {segments.map((segment, index) => {
            const points = segment.map((point) => `${point.x},${point.y}`).join(' ');
            if (segment.length === 1) {
              return <circle key={index} cx={segment[0].x} cy={segment[0].y} r="3.5" fill="var(--color-action)" />;
            }
            const areaPoints = `${segment[0].x},${SPARKLINE_HEIGHT - 6} ${points} ${segment.at(-1)?.x},${SPARKLINE_HEIGHT - 6}`;
            return (
              <g key={index}>
                <polygon points={areaPoints} fill="url(#bodyweight-trend-fill)" />
                <polyline points={points} fill="none" stroke="var(--color-action)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })}
        </svg>
        <div className="mt-1 flex justify-between px-1 font-mono text-[0.625rem] text-text-faint">
          <span>{trend.entries[0] ? formatShortDate(trend.entries[0].date) : '—'}</span>
          <span>{trend.entries.at(-1) ? formatShortDate(trend.entries.at(-1)!.date) : '—'}</span>
        </div>
      </div>
    </section>
  );
}

interface BodyweightEditorProps {
  entry: DailyBodyweightEntry;
  entries: DailyBodyweightEntry[];
}

function BodyweightEditor({ entry, entries }: BodyweightEditorProps) {
  const navigate = useNavigate({ from: '/body' });
  const queryClient = useQueryClient();
  const selectedChipRef = useRef<HTMLButtonElement>(null);
  const initialWeight = entry.weight ?? '';
  const [weight, setWeight] = useState(initialWeight);
  const parsedWeight = parsePositiveDecimal(weight);
  const isDirty = weight !== initialWeight;
  const trend = bodyweightTrend(entries, entry.date);
  const previousEntry = previousRecordedEntry(entries, entry.date);
  const today = todayLocalIsoDate();

  useBlocker({
    shouldBlockFn: () => !window.confirm('Discard your unsaved bodyweight changes?'),
    enableBeforeUnload: isDirty,
    disabled: !isDirty,
  });

  useEffect(() => {
    selectedChipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, []);

  const mutation = useMutation({
    mutationFn: saveDailyBodyweight,
    onSuccess: (response: BodyweightResponse) => {
      queryClient.setQueryData(['bodyweight'], response);
      const updated = response.entries.find((item) => item.date === entry.date);
      setWeight(updated?.weight ?? '');
    },
  });

  const selectDate = (date: string) => {
    mutation.reset();
    void navigate({ search: { date } });
  };

  const adjustWeight = (amount: number) => {
    const current = parsePositiveDecimal(weight);
    if (current === null || current + amount <= 0) {
      return;
    }
    setWeight(formatNumber(current + amount));
    mutation.reset();
  };

  const handleSave = () => {
    if (parsedWeight === null || !isDirty || mutation.isPending) {
      return;
    }
    mutation.mutate({
      operation: 'save',
      date: entry.date,
      weight: parsedWeight,
      revision: entry.revision,
    });
  };

  const handleClear = () => {
    if (!entry.hasValue || mutation.isPending || !window.confirm(`Clear the saved bodyweight for ${formatDate(entry.date)}?`)) {
      return;
    }
    mutation.mutate({ operation: 'clear', date: entry.date, revision: entry.revision });
  };

  return (
    <section className="-mx-1" aria-labelledby="daily-bodyweight-heading">
      <header className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back to Body"
          className="grid size-9 shrink-0 place-items-center rounded-control border border-border-subtle bg-surface text-text-secondary transition-colors hover:bg-surface-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          onClick={() => void navigate({ search: { date: undefined } })}
        >
          <ArrowLeft aria-hidden="true" size={18} weight="bold" />
        </button>
        <div className="min-w-0">
          <h1 id="daily-bodyweight-heading" className="truncate text-lg font-black leading-tight tracking-display">Daily Bodyweight</h1>
          <p className="mt-0.5 font-mono text-[0.6875rem] text-text-muted">Body · {formatMonth(entry.date)}</p>
        </div>
      </header>

      <div className="-mx-3 mt-4 flex snap-x gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Source Spreadsheet dates">
        {entries.map((dateEntry) => {
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
            {previousEntry ? `${formatShortDate(previousEntry.date)} · ${previousEntry.weight} lb` : 'No earlier value'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">7-day avg</p>
          <p className="mt-1 font-mono text-xs font-bold text-text-secondary">
            {trend.average === null ? '—' : `${formatWeight(trend.average)} lb`}
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
            aria-label="Decrease bodyweight by 1"
            disabled={parsedWeight === null || parsedWeight <= 1 || mutation.isPending}
            onClick={() => adjustWeight(-1)}
          >
            <Minus aria-hidden="true" size={19} weight="bold" />
          </button>
          <label className="min-w-0 flex-1 text-center">
            <span className="sr-only">Daily Bodyweight</span>
            <input
              className="w-full bg-transparent text-center text-[2rem] font-black leading-none tracking-display text-text-primary outline-none placeholder:text-text-faint"
              inputMode="decimal"
              autoComplete="off"
              value={weight}
              placeholder="—"
              disabled={mutation.isPending}
              onChange={(event) => {
                setWeight(event.target.value);
                mutation.reset();
              }}
            />
            <span className="mt-1 block font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-muted">lbs</span>
          </label>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-control bg-surface-control text-action disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            aria-label="Increase bodyweight by 1"
            disabled={parsedWeight === null || mutation.isPending}
            onClick={() => adjustWeight(1)}
          >
            <Plus aria-hidden="true" size={19} weight="bold" />
          </button>
        </div>
      </section>

      <div className="mt-3 min-h-10" aria-live="polite">
        {mutation.isError ? (
          <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{mutation.error.message}</p>
        ) : isDirty && parsedWeight === null ? (
          <p className="px-1 text-xs font-medium text-partial">Enter a positive bodyweight value.</p>
        ) : mutation.isSuccess ? (
          <p className="flex items-center gap-1.5 px-1 text-xs font-bold text-complete">
            <Check aria-hidden="true" size={14} weight="bold" /> Synced to Source Spreadsheet
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
          disabled={parsedWeight === null || !isDirty || mutation.isPending}
          onClick={handleSave}
        >
          {mutation.isPending ? 'Syncing…' : mutation.isSuccess && !isDirty ? 'Synced' : 'Save Daily Bodyweight'}
        </button>
      </footer>
    </section>
  );
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

function formatWeight(value: number): string {
  return value.toFixed(1);
}

function BodyPageLoading() {
  return (
    <div aria-label="Loading Body Tracking" aria-busy="true">
      <div className="px-1">
        <div className="h-2.5 w-24 animate-pulse rounded bg-track" />
        <div className="mt-3 h-10 w-20 animate-pulse rounded bg-surface-control" />
      </div>
      <div className="mt-5 h-16 animate-pulse rounded-card border border-border-subtle bg-surface-raised" />
      <div className="mt-4 h-48 animate-pulse rounded-card border border-border-subtle bg-surface-raised" />
      <div className="mt-5 space-y-2">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-card bg-surface-raised" />
        ))}
      </div>
    </div>
  );
}

interface BodyPageMessageProps {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}

function BodyPageMessage({ eyebrow, title, detail, action }: BodyPageMessageProps) {
  return (
    <section className="max-w-sm px-1 pt-8" aria-live="polite">
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">{eyebrow}</p>
      <h1 className="mt-2 text-[2rem] font-black leading-none tracking-display">{title}</h1>
      <p className="mt-4 text-sm font-medium leading-6 text-text-muted">{detail}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
