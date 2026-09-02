import { ArrowLeft, Check, Minus, Plus } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type {
  MeasurementCheckInEntry,
  MeasurementField,
  MeasurementsResponse,
} from '../../contracts/measurements';
import { formatNumber, parsePositiveDecimal } from '../../shared/parse-number';
import { saveMeasurementCheckIn } from './api/measurements';
import { CheckInStatusBadge } from './CheckInStatusBadge';
import {
  checkInStatus,
  filledFieldCount,
  previousFieldValue,
} from './measurement-view';
import { formatDate, formatDay, formatShortDate } from './format-dates';

interface MeasurementCheckInEditorProps {
  checkIn: MeasurementCheckInEntry;
  checkIns: MeasurementCheckInEntry[];
  fields: readonly MeasurementField[];
  unitLabel: string;
  today: string;
  onBack: () => void;
  onSelectDate: (date: string) => void;
}

export function MeasurementCheckInEditor({
  checkIn,
  checkIns,
  fields,
  unitLabel,
  today,
  onBack,
  onSelectDate,
}: MeasurementCheckInEditorProps) {
  const queryClient = useQueryClient();
  const selectedChipRef = useRef<HTMLButtonElement>(null);
  const initialDraft = useMemo(
    () =>
      Object.fromEntries(
        fields.map((field) => [field.id, checkIn.values[field.id] ?? ''])
      ),
    [checkIn.date, checkIn.values, fields]
  );
  const [draftValues, setDraftValues] = useState(initialDraft);

  const valuesToSave = useMemo(() => {
    const next: Record<string, number> = {};
    for (const field of fields) {
      const draft = draftValues[field.id]?.trim() ?? '';
      if (draft === '') {
        continue;
      }
      const parsed = parsePositiveDecimal(draft);
      if (parsed === null) {
        continue;
      }
      const saved = checkIn.values[field.id];
      if (saved !== null && Number(saved) === parsed) {
        continue;
      }
      next[field.id] = parsed;
    }
    return next;
  }, [checkIn.values, draftValues, fields]);

  const hasInvalidDraft = fields.some((field) => {
    const draft = draftValues[field.id]?.trim() ?? '';
    return draft !== '' && parsePositiveDecimal(draft) === null;
  });
  const isDirty = Object.keys(valuesToSave).length > 0;
  const status = checkInStatus(checkIn);

  const mutation = useMutation({
    mutationFn: saveMeasurementCheckIn,
    onSuccess: (response: MeasurementsResponse) => {
      queryClient.setQueryData(['measurements'], response);
      const updated = response.checkIns.find((entry) => entry.date === checkIn.date);
      if (updated) {
        setDraftValues(
          Object.fromEntries(
            fields.map((field) => [field.id, updated.values[field.id] ?? ''])
          )
        );
      }
    },
  });

  useEffect(() => {
    setDraftValues(initialDraft);
    mutation.reset();
  }, [checkIn.date, initialDraft, mutation]);

  useEffect(() => {
    selectedChipRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [checkIn.date]);

  useBlocker({
    shouldBlockFn: () => !window.confirm('Discard your unsaved measurement changes?'),
    enableBeforeUnload: isDirty,
    disabled: !isDirty,
  });

  const adjustField = (fieldId: string, amount: number) => {
    const current = parsePositiveDecimal(draftValues[fieldId] ?? '');
    if (current === null || current + amount <= 0) {
      return;
    }
    setDraftValues((previous) => ({
      ...previous,
      [fieldId]: formatNumber(current + amount),
    }));
    mutation.reset();
  };

  const handleSave = () => {
    if (!isDirty || hasInvalidDraft || mutation.isPending) {
      return;
    }
    mutation.mutate({
      date: checkIn.date,
      revision: checkIn.revision,
      values: valuesToSave,
    });
  };

  return (
    <section className="-mx-1 pb-24" aria-labelledby="measurement-check-in-heading">
      <header className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back to Body"
          className="grid size-9 shrink-0 place-items-center rounded-control border border-border-subtle bg-surface text-text-secondary transition-colors hover:bg-surface-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={18} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <h1
            id="measurement-check-in-heading"
            className="truncate text-lg font-black leading-tight tracking-display"
          >
            Measurement Check-In
          </h1>
          <p className="mt-0.5 font-mono text-[0.6875rem] text-text-muted">
            {formatDate(checkIn.date)} · {filledFieldCount(checkIn, fields)}/{fields.length}{' '}
            fields{unitLabel ? ` · ${unitLabel}` : ''}
          </p>
        </div>
        <CheckInStatusBadge status={status} />
      </header>

      <div
        className="-mx-3 mt-4 flex snap-x gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Scheduled Measurement Check-In dates"
      >
        {checkIns.map((entry) => {
          const isSelected = entry.date === checkIn.date;
          const entryStatus = checkInStatus(entry);
          return (
            <button
              key={entry.date}
              ref={isSelected ? selectedChipRef : undefined}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${formatDate(entry.date)}, ${entryStatus}`}
              className={`flex min-w-[3.35rem] snap-center flex-col items-center rounded-control border px-2 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${
                isSelected
                  ? 'border-action bg-action-soft text-action'
                  : 'border-border-subtle bg-surface text-text-muted hover:bg-surface-control'
              }`}
              onClick={() => {
                if (entry.date !== checkIn.date) {
                  onSelectDate(entry.date);
                }
              }}
            >
              <span className="text-sm font-extrabold">{formatDay(entry.date)}</span>
              <span className="mt-1 flex h-3 items-center font-mono text-[0.5625rem] font-semibold uppercase">
                {entry.date === today ? (
                  'Today'
                ) : entryStatus === 'complete' ? (
                  <Check aria-hidden="true" size={11} weight="bold" />
                ) : entryStatus === 'partial' ? (
                  '·'
                ) : (
                  '—'
                )}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="mt-4 space-y-3">
        {fields.map((field) => {
          const previous = previousFieldValue(checkIns, checkIn.date, field.id);
          const parsed = parsePositiveDecimal(draftValues[field.id] ?? '');

          return (
            <li
              key={field.id}
              className="rounded-card border border-border-subtle bg-surface-raised px-3.5 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-text-primary">{field.label}</p>
                  <p className="mt-0.5 font-mono text-[0.625rem] text-text-faint">
                    {previous
                      ? `Previous · ${formatShortDate(previous.date)} · ${previous.value}${unitLabel ? ` ${unitLabel}` : ''}`
                      : 'No previous value'}
                  </p>
                </div>
                {unitLabel ? (
                  <span className="font-mono text-[0.625rem] font-semibold uppercase text-text-faint">
                    {unitLabel}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="grid size-10 place-items-center rounded-control bg-surface-control text-text-muted disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                  aria-label={`Decrease ${field.label}`}
                  disabled={parsed === null || parsed <= 0.1 || mutation.isPending}
                  onClick={() => adjustField(field.id, -0.1)}
                >
                  <Minus aria-hidden="true" size={17} weight="bold" />
                </button>
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{field.label}</span>
                  <input
                    className="w-full bg-transparent text-center text-xl font-black leading-none tracking-display text-text-primary outline-none placeholder:text-text-faint"
                    inputMode="decimal"
                    autoComplete="off"
                    value={draftValues[field.id] ?? ''}
                    placeholder="—"
                    disabled={mutation.isPending}
                    onChange={(event) => {
                      setDraftValues((previous) => ({
                        ...previous,
                        [field.id]: event.target.value,
                      }));
                      mutation.reset();
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="grid size-10 place-items-center rounded-control bg-surface-control text-action disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                  aria-label={`Increase ${field.label}`}
                  disabled={parsed === null || mutation.isPending}
                  onClick={() => adjustField(field.id, 0.1)}
                >
                  <Plus aria-hidden="true" size={17} weight="bold" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 min-h-10" aria-live="polite">
        {mutation.isError ? (
          <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
            {mutation.error.message}
          </p>
        ) : hasInvalidDraft ? (
          <p className="px-1 text-xs font-medium text-partial">Enter positive values for edited fields.</p>
        ) : mutation.isSuccess && !isDirty ? (
          <p className="flex items-center gap-1.5 px-1 text-xs font-bold text-complete">
            <Check aria-hidden="true" size={14} weight="bold" /> Synced to Source Spreadsheet
          </p>
        ) : null}
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-app gap-2.5 border-t border-border-subtle bg-nav/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:border-x">
        <button
          type="button"
          className="h-12 flex-1 rounded-card bg-action px-4 text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 disabled:cursor-not-allowed disabled:bg-surface-control disabled:text-text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          disabled={!isDirty || hasInvalidDraft || mutation.isPending}
          onClick={handleSave}
        >
          {mutation.isPending ? 'Syncing…' : mutation.isSuccess && !isDirty ? 'Synced' : 'Save Measurement Check-In'}
        </button>
      </footer>
    </section>
  );
}
