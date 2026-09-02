import {
  ArrowLeft,
  Check,
  Minus,
  Plus,
  Warning,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate, useSearch } from '@tanstack/react-router';

import type { BodyweightResponse, DailyBodyweightEntry } from '../../contracts/body';
import type { MeasurementCheckInEntry, MeasurementField } from '../../contracts/measurements';
import { formatNumber, parsePositiveDecimal } from '../../shared/parse-number';
import { fetchBodyweight, saveDailyBodyweight } from './api/bodyweight';
import { fetchMeasurements } from './api/measurements';
import { CheckInStatusBadge } from './CheckInStatusBadge';
import { MeasurementCheckInEditor } from './MeasurementCheckInEditor';
import {
  bodyweightTrend,
  previousRecordedEntry,
  sortBodyweightEntries,
} from './bodyweight-view';
import { todayLocalIsoDate } from './local-date';
import {
  checkInStatus,
  dueTodayCheckIn,
  filledFieldCount,
  pastCheckIns,
} from './measurement-view';
import {
  BodyweightHubSections,
} from './bodyweight-hub-sections';
import { formatDate, formatShortDate } from './format-dates';

type BodySegment = 'weight' | 'check-ins';

export function BodyPage() {
  const {
    date: selectedDate,
    checkInDate: selectedCheckInDate,
    segment: selectedSegment,
  } = useSearch({ from: '/body' });
  const navigate = useNavigate({ from: '/body' });
  const segment: BodySegment = selectedSegment ?? 'weight';
  const query = useQuery({
    queryKey: ['bodyweight'],
    queryFn: fetchBodyweight,
  });
  const measurementsQuery = useQuery({
    queryKey: ['measurements'],
    queryFn: fetchMeasurements,
    enabled: !selectedDate,
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
              onClick={() => void navigate({ search: (previous) => ({ ...previous, date: undefined }), replace: true })}
            >
              Back to Body
            </button>
          }
        />
      );
    }

    return <BodyweightEditor key={activeEntry.date} entry={activeEntry} entries={entries} />;
  }

  if (selectedCheckInDate) {
    if (measurementsQuery.isPending) {
      return <BodyPageLoading />;
    }

    if (measurementsQuery.isError) {
      return (
        <BodyPageMessage
          eyebrow="Measurement Check-Ins"
          title="Check-Ins unavailable"
          detail={measurementsQuery.error.message}
          action={
            <button
              type="button"
              className="rounded-control bg-action px-4 py-2.5 text-sm font-extrabold text-action-ink"
              onClick={() => void measurementsQuery.refetch()}
            >
              Try again
            </button>
          }
        />
      );
    }

    const data = measurementsQuery.data;
    const checkIns = data?.checkIns ?? [];
    const activeCheckIn = checkIns.find((checkIn) => checkIn.date === selectedCheckInDate);
    if (!data || !activeCheckIn) {
      return (
        <BodyPageMessage
          eyebrow="Measurement Check-In"
          title="Date unavailable"
          detail="That date is not available in the Source Spreadsheet."
          action={
            <button
              type="button"
              className="rounded-control bg-action px-4 py-2.5 text-sm font-extrabold text-action-ink"
              onClick={() =>
                void navigate({
                  search: (previous) => ({ ...previous, checkInDate: undefined }),
                  replace: true,
                })
              }
            >
              Back to Body
            </button>
          }
        />
      );
    }

    const sortedCheckIns = [...checkIns].sort((left, right) =>
      right.date.localeCompare(left.date)
    );

    return (
      <MeasurementCheckInEditor
        key={activeCheckIn.date}
        checkIn={activeCheckIn}
        checkIns={sortedCheckIns}
        fields={data.fields}
        unitLabel={data.unitLabel ?? ''}
        today={todayLocalIsoDate()}
        onBack={() =>
          void navigate({
            search: (previous) => ({ ...previous, checkInDate: undefined }),
          })
        }
        onSelectDate={(date) =>
          void navigate({
            search: (previous) => ({ ...previous, checkInDate: date }),
          })
        }
      />
    );
  }

  return (
    <BodySegmentedHub
      entries={entries}
      segment={segment}
      measurementsQuery={measurementsQuery}
      onOpenCheckIn={(date) => {
        void navigate({
          search: (previous) => ({
            ...previous,
            segment: 'check-ins',
            checkInDate: date,
          }),
        });
      }}
      onSegmentChange={(nextSegment) => {
        void navigate({
          search: (previous) => ({ ...previous, segment: nextSegment === 'weight' ? undefined : nextSegment }),
        });
      }}
    />
  );
}

interface MeasurementsQueryState {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  data?: {
    unitLabel: string | null;
    fields: MeasurementField[];
    checkIns: MeasurementCheckInEntry[];
  };
  refetch: () => Promise<unknown>;
}

interface BodySegmentedHubProps {
  entries: DailyBodyweightEntry[];
  segment: BodySegment;
  measurementsQuery: MeasurementsQueryState;
  onOpenCheckIn: (date: string) => void;
  onSegmentChange: (segment: BodySegment) => void;
}

function BodySegmentedHub({
  entries,
  segment,
  measurementsQuery,
  onOpenCheckIn,
  onSegmentChange,
}: BodySegmentedHubProps) {
  const today = todayLocalIsoDate();

  return (
    <section className="px-1 pb-24" aria-labelledby="body-heading">
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
        Body Tracking
      </p>
      <h1 id="body-heading" className="mt-2 text-[2.375rem] font-black leading-none tracking-display">
        Body
      </h1>

      <div
        className="mt-4 grid grid-cols-2 gap-1 rounded-control border border-border-subtle bg-surface p-1"
        role="tablist"
        aria-label="Body tracking mode"
      >
        {(
          [
            ['weight', 'Weight'],
            ['check-ins', 'Check-Ins'],
          ] as const
        ).map(([key, label]) => {
          const isActive = segment === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`rounded-control px-3 py-2.5 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${
                isActive
                  ? 'bg-action text-action-ink'
                  : 'text-text-muted hover:bg-surface-control hover:text-text-secondary'
              }`}
              onClick={() => onSegmentChange(key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {segment === 'weight' ? (
        <div role="tabpanel" aria-label="Daily Bodyweight">
          <BodyweightHubSections entries={entries} />
        </div>
      ) : (
        <MeasurementCheckInsPanel
          measurementsQuery={measurementsQuery}
          today={today}
          onOpenCheckIn={onOpenCheckIn}
        />
      )}
    </section>
  );
}

function MeasurementCheckInsPanel({
  measurementsQuery,
  today,
  onOpenCheckIn,
}: {
  measurementsQuery: MeasurementsQueryState;
  today: string;
  onOpenCheckIn: (date: string) => void;
}) {
  if (measurementsQuery.isPending) {
    return (
      <div role="tabpanel" aria-label="Measurement Check-Ins" className="mt-4 space-y-3" aria-busy="true">
        <div className="h-20 animate-pulse rounded-card bg-surface-raised" />
        <div className="h-24 animate-pulse rounded-card bg-surface-raised" />
      </div>
    );
  }

  if (measurementsQuery.isError) {
    return (
      <div role="tabpanel" aria-label="Measurement Check-Ins" className="mt-4">
        <BodyPageMessage
          eyebrow="Measurement Check-Ins"
          title="Check-Ins unavailable"
          detail={measurementsQuery.error?.message ?? 'Measurement data could not be loaded.'}
          action={
            <button
              type="button"
              className="rounded-control bg-action px-4 py-2.5 text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              onClick={() => void measurementsQuery.refetch()}
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  const data = measurementsQuery.data;
  if (!data || data.checkIns.length === 0) {
    return (
      <div role="tabpanel" aria-label="Measurement Check-Ins" className="mt-4">
        <BodyPageMessage
          eyebrow="Measurement Check-Ins"
          title="No check-ins found"
          detail="The Source Spreadsheet does not contain any scheduled Measurement Check-In dates yet."
        />
      </div>
    );
  }

  const fields = data.fields;
  const checkIns = [...data.checkIns].sort((left, right) => right.date.localeCompare(left.date));
  const dueToday = dueTodayCheckIn(checkIns, today);
  const previous = pastCheckIns(checkIns, today);
  const unitLabel = data.unitLabel ?? '';

  return (
    <div role="tabpanel" aria-label="Measurement Check-Ins" className="mt-4">
      {dueToday ? (
        <section aria-labelledby="due-check-in-heading">
          <h2
            id="due-check-in-heading"
            className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted"
          >
            Next Due
          </h2>
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-3 rounded-card border border-partial/35 bg-partial-soft px-4 py-4 text-left transition-colors hover:bg-partial-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            onClick={() => onOpenCheckIn(dueToday.date)}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-partial-soft text-partial">
              <Warning aria-hidden="true" size={20} weight="fill" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-extrabold">
                {checkInStatus(dueToday) === 'empty'
                  ? 'Start Measurement Check-In'
                  : 'Continue Measurement Check-In'}
              </span>
              <span className="mt-1 block font-mono text-[0.6875rem] text-text-muted">
                {formatShortDate(dueToday.date)}
                {unitLabel ? ` · ${unitLabel}` : ''} ·{' '}
                {filledFieldCount(dueToday, fields)}/{fields.length} fields
              </span>
            </span>
            <CheckInStatusBadge status={checkInStatus(dueToday)} />
          </button>
        </section>
      ) : null}

      <section className="mt-5" aria-labelledby="past-check-ins-heading">
        <h2
          id="past-check-ins-heading"
          className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted"
        >
          Past Check-Ins
        </h2>
        <ul className="mt-2 space-y-3">
          {previous.map((checkIn) => (
            <li key={checkIn.date}>
              <button
                type="button"
                className="w-full rounded-card border border-border-subtle bg-surface-raised px-4 py-3 text-left transition-colors hover:bg-surface-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                onClick={() => onOpenCheckIn(checkIn.date)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-text-secondary">
                    {formatDate(checkIn.date)}
                  </span>
                  <CheckInStatusBadge status={checkIn.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {fields.map((field) => {
                    const value = checkIn.values[field.id];
                    const filled = value !== null;
                    return (
                      <span
                        key={field.id}
                        className={`rounded-full px-2 py-0.5 font-mono text-[0.5625rem] font-semibold uppercase ${
                          filled
                            ? 'bg-complete-soft text-complete'
                            : 'bg-surface-control text-text-faint'
                        }`}
                      >
                        {field.label}
                      </span>
                    );
                  })}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
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
    void navigate({ search: (previous) => ({ ...previous, date }) });
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
          onClick={() => void navigate({ search: (previous) => ({ ...previous, date: undefined }) })}
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
