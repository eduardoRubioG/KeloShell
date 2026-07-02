import { CaretLeft, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { formatNumber } from '../../../shared/parse-number';
import { loadAvailablePlates, saveAvailablePlates } from '../plate-config';
import {
  PLATE_COLORS,
  PLATE_DENOMINATIONS,
  computePlateLoad,
  type EquipmentMode,
} from '../plate-math';

const PLATE_HEIGHTS: Record<number, number> = {
  45: 76,
  35: 66,
  25: 56,
  10: 44,
  5: 34,
  2.5: 26,
};

const MODES: { id: EquipmentMode; label: string }[] = [
  { id: 'barbell', label: 'Barbell' },
  { id: 'machine', label: 'Machine' },
  { id: 'single-peg', label: 'Single Peg' },
];

interface PlateCalculatorSheetProps {
  targetWeight: number;
  onDismiss: () => void;
}

export function PlateCalculatorSheet({
  targetWeight,
  onDismiss,
}: PlateCalculatorSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [mode, setMode] = useState<EquipmentMode>('barbell');
  const [view, setView] = useState<'calc' | 'plates'>('calc');
  const [availablePlates, setAvailablePlates] = useState<number[]>(() =>
    loadAvailablePlates(),
  );

  useEffect(() => {
    dialogRef.current?.showModal();
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const result = computePlateLoad(targetWeight, mode, availablePlates);
  const plateItems = result.plates.flatMap(({ denom, count }) =>
    Array.from({ length: count }, () => denom),
  );

  const handleToggle = (denom: number) => {
    setAvailablePlates((prev) => {
      const next = prev.includes(denom)
        ? prev.filter((d) => d !== denom)
        : [...prev, denom].sort((a, b) => b - a);
      saveAvailablePlates(next);
      return next;
    });
  };

  const summaryDescription = (() => {
    const perSide = formatNumber(result.perSideWeight);
    if (mode === 'barbell') return `45 lb bar · ${perSide} lb per side`;
    if (mode === 'machine') return `No bar · ${perSide} lb per side`;
    return `No bar · all weight one peg`;
  })();

  return (
    <dialog
      ref={dialogRef}
      className="progression-drawer"
      aria-labelledby="plate-calc-title"
      onClose={onDismiss}
      onMouseDown={(event) => {
        const b = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < b.left ||
          event.clientX > b.right ||
          event.clientY < b.top ||
          event.clientY > b.bottom;
        if (outside) event.currentTarget.close();
      }}
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />

      {view === 'calc' ? (
        <>
          <header className="flex items-center justify-between">
            <h2
              ref={headingRef}
              id="plate-calc-title"
              className="text-lg font-black tracking-display outline-none"
              tabIndex={-1}
            >
              Plate Calculator
            </h2>
            <button
              type="button"
              className="grid size-7 place-items-center rounded-full bg-surface-control text-text-muted transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              aria-label="Close plate calculator"
              onClick={() => dialogRef.current?.close()}
            >
              <X aria-hidden="true" size={13} weight="bold" />
            </button>
          </header>

          {/* Mode toggle */}
          <div className="mt-3 flex gap-1 rounded-card bg-surface-control p-1">
            {MODES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`flex-1 rounded-[0.5rem] py-2 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${
                  mode === id
                    ? 'bg-action text-action-ink'
                    : 'text-text-faint hover:text-text-muted'
                }`}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Summary row */}
          <div className="mt-2.5 flex items-center justify-between rounded-control bg-surface px-3 py-2">
            <p className="font-mono text-[0.6875rem] text-text-muted">
              {summaryDescription}
            </p>
            <p
              className={`font-mono text-xs font-bold ${result.exact ? 'text-complete' : 'text-partial'}`}
            >
              {formatNumber(result.totalWeight)} lb{' '}
              {result.exact ? '✓' : `(−${formatNumber(result.deltaLb)} lb)`}
            </p>
          </div>

          {/* Plate visual */}
          <div className="mt-2.5 flex min-h-[6.5rem] items-center justify-center overflow-x-auto rounded-card border border-border-subtle bg-surface px-4 py-3">
            {mode === 'single-peg' ? (
              <SinglePegVisual plateItems={plateItems} />
            ) : (
              <BarbellVisual plateItems={plateItems} />
            )}
          </div>

          {/* Color legend */}
          {result.plates.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
              {result.plates.map(({ denom }) => (
                <span key={denom} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: PLATE_COLORS[denom] }}
                  />
                  <span className="font-mono text-[0.625rem] text-text-faint">
                    {denom} lb
                  </span>
                </span>
              ))}
              {mode === 'barbell' && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-2.5 rounded-sm bg-track" />
                  <span className="font-mono text-[0.625rem] text-text-faint">
                    bar
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Breakdown */}
          <div className="mt-2.5 divide-y divide-border-subtle border-y border-border-subtle">
            {result.plates.map(({ denom, count }) => {
              const swatchH = Math.max(
                8,
                Math.round((PLATE_HEIGHTS[denom] ?? 40) * 0.27),
              );
              return (
                <div key={denom} className="flex items-center py-2.5">
                  <span
                    className="mr-3 shrink-0 rounded-sm"
                    style={{
                      width: 10,
                      height: swatchH,
                      background: PLATE_COLORS[denom],
                    }}
                  />
                  <span className="flex-1 text-[0.8125rem] font-bold">
                    {denom} lb
                  </span>
                  <span className="mr-3 font-mono text-xs text-text-faint">
                    ×{count}
                    {mode !== 'single-peg' ? ' per side' : ''}
                  </span>
                  <span className="min-w-[3rem] text-right font-mono text-sm font-bold">
                    {formatNumber(denom * count * result.sides)} lb
                  </span>
                </div>
              );
            })}
            {mode === 'barbell' && (
              <div className="flex items-center py-2.5">
                <span className="mr-3 inline-block h-1.5 w-2.5 shrink-0 rounded-sm bg-track" />
                <span className="flex-1 text-[0.8125rem] font-semibold text-text-muted">
                  Barbell bar
                </span>
                <span className="min-w-[3rem] text-right font-mono text-sm font-semibold text-text-muted">
                  45 lb
                </span>
              </div>
            )}
          </div>

          {/* Total */}
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">
              Total
            </span>
            <span className="text-xl font-black tracking-display">
              {formatNumber(result.totalWeight)}{' '}
              <span
                className={`text-sm font-bold ${result.exact ? 'text-complete' : 'text-partial'}`}
              >
                lb {result.exact ? '✓' : `(−${formatNumber(result.deltaLb)} lb)`}
              </span>
            </span>
          </div>

          {/* Available plates config */}
          <button
            type="button"
            className="mt-3 flex w-full items-center gap-3 rounded-control border border-border-subtle px-3.5 py-2.5 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            onClick={() => setView('plates')}
          >
            <span className="flex-1 text-left font-mono text-[0.6875rem] font-semibold text-text-faint">
              Available plates at this gym
            </span>
            <span className="font-bold text-text-faint">›</span>
          </button>
        </>
      ) : (
        <>
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                className="grid size-7 place-items-center rounded-full bg-surface-control text-text-muted transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                aria-label="Back to calculator"
                onClick={() => setView('calc')}
              >
                <CaretLeft aria-hidden="true" size={14} weight="bold" />
              </button>
              <h2
                id="plate-calc-title"
                className="text-lg font-black tracking-display"
              >
                Available Plates
              </h2>
            </div>
            <button
              type="button"
              className="grid size-7 place-items-center rounded-full bg-surface-control text-text-muted transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              aria-label="Close plate calculator"
              onClick={() => dialogRef.current?.close()}
            >
              <X aria-hidden="true" size={13} weight="bold" />
            </button>
          </header>

          <p className="mt-2.5 text-xs font-medium leading-5 text-text-faint">
            Disabled plates are skipped. The calculator finds the closest
            combination using only what's available.
          </p>

          <div className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface">
            {PLATE_DENOMINATIONS.map((denom) => {
              const isOn = availablePlates.includes(denom);
              return (
                <button
                  key={denom}
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  className="flex w-full items-center px-4 py-3.5 transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                  onClick={() => handleToggle(denom)}
                >
                  <span
                    className="mr-3.5 shrink-0 rounded-sm"
                    style={{
                      width: 10,
                      height: Math.max(
                        8,
                        Math.round((PLATE_HEIGHTS[denom] ?? 40) * 0.27),
                      ),
                      background: isOn
                        ? PLATE_COLORS[denom]
                        : 'rgb(255 255 255 / 0.12)',
                    }}
                  />
                  <span className="flex-1 text-left">
                    <span
                      className={`block text-sm font-bold ${!isOn ? 'text-text-faint line-through decoration-text-faint' : ''}`}
                    >
                      {denom} lb
                    </span>
                    {!isOn && (
                      <span className="mt-0.5 block font-mono text-[0.625rem] text-text-faint">
                        not at this gym
                      </span>
                    )}
                  </span>
                  <span
                    className={`relative ml-3 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                      isOn ? 'bg-complete' : 'border border-border-subtle bg-surface-control'
                    }`}
                    aria-hidden="true"
                  >
                    <span
                      className="absolute top-[2px] size-5 rounded-full shadow-sm transition-transform"
                      style={{
                        transform: isOn
                          ? 'translateX(22px)'
                          : 'translateX(2px)',
                        background: isOn ? '#fafafa' : '#3a3a46',
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="mt-4 h-12 w-full rounded-card bg-action text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            onClick={() => setView('calc')}
          >
            Done
          </button>
        </>
      )}
    </dialog>
  );
}

function BarbellVisual({ plateItems }: { plateItems: number[] }) {
  // plateItems is largest→smallest (greedy order)
  // Left side display: outermost (smallest) → innermost (largest) = reversed
  const left = [...plateItems].reverse();
  const right = plateItems;

  return (
    <div className="flex items-center">
      {left.length === 0 && (
        <div
          className="shrink-0"
          style={{ width: 6, height: 20, background: '#3e3e4a' }}
        />
      )}
      {left.map((denom, i) => (
        <div
          key={`l${i}`}
          className="shrink-0"
          style={{
            width: 14,
            height: PLATE_HEIGHTS[denom] ?? 40,
            background: PLATE_COLORS[denom],
            borderRadius: i === 0 ? '2px 0 0 2px' : 0,
            marginRight: i < left.length - 1 ? 1 : 0,
          }}
        />
      ))}
      <div
        className="shrink-0"
        style={{ width: 6, height: 20, background: '#3e3e4a' }}
      />
      <div
        className="shrink-0"
        style={{
          width: 72,
          height: 7,
          background: '#52525e',
          borderRadius: 2,
        }}
      />
      <div
        className="shrink-0"
        style={{ width: 6, height: 20, background: '#3e3e4a' }}
      />
      {right.map((denom, i) => (
        <div
          key={`r${i}`}
          className="shrink-0"
          style={{
            width: 14,
            height: PLATE_HEIGHTS[denom] ?? 40,
            background: PLATE_COLORS[denom],
            borderRadius: i === right.length - 1 ? '0 2px 2px 0' : 0,
            marginLeft: i > 0 ? 1 : 0,
          }}
        />
      ))}
      {right.length === 0 && (
        <div
          className="shrink-0"
          style={{ width: 6, height: 20, background: '#3e3e4a' }}
        />
      )}
    </div>
  );
}

function SinglePegVisual({ plateItems }: { plateItems: number[] }) {
  return (
    <div className="flex items-center">
      {/* Peg post (vertical mount) */}
      <div
        className="shrink-0"
        style={{
          width: 13,
          height: 90,
          background: '#191921',
          borderRadius: 3,
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      />
      {/* Horizontal peg connector */}
      <div
        className="shrink-0"
        style={{ width: 18, height: 7, background: '#52525e' }}
      />
      {/* Plates: innermost (left) to outermost (right) */}
      {plateItems.map((denom, i) => (
        <div
          key={i}
          className="shrink-0"
          style={{
            width: 14,
            height: PLATE_HEIGHTS[denom] ?? 40,
            background: PLATE_COLORS[denom],
            borderRadius: i === plateItems.length - 1 ? '0 2px 2px 0' : 0,
            marginLeft: i > 0 ? 1 : 0,
          }}
        />
      ))}
      {/* End collar */}
      {plateItems.length > 0 && (
        <div
          className="shrink-0"
          style={{
            width: 7,
            height: 22,
            background: '#3e3e4a',
            borderRadius: '0 2px 2px 0',
            marginLeft: 1,
          }}
        />
      )}
    </div>
  );
}
