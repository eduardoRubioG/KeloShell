import { ArrowRight, TrendDown, TrendUp, Warning } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';

import type { DailyBodyweightEntry } from '../../contracts/body';
import {
  bodyweightTrend,
  sparklineSegments,
} from './bodyweight-view';
import { todayLocalIsoDate } from './local-date';
import { formatShortDate, formatWeight } from './format-dates';

const RECENT_COUNT = 4;
const SPARKLINE_WIDTH = 304;
const SPARKLINE_HEIGHT = 84;

interface BodyweightHubSectionsProps {
  entries: DailyBodyweightEntry[];
  compact?: boolean;
}

export function BodyweightPrompt({ entries }: { entries: DailyBodyweightEntry[] }) {
  const navigate = useNavigate({ from: '/body' });
  const today = todayLocalIsoDate();
  const todayEntry = entries.find((entry) => entry.date === today);

  if (!todayEntry || todayEntry.hasValue) {
    return null;
  }

  return (
    <button
      type="button"
      className="mt-4 flex w-full items-center gap-3 rounded-card border border-action/35 bg-action-soft px-4 py-3.5 text-left transition-colors hover:bg-action-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      onClick={() => void navigate({ search: (previous) => ({ ...previous, date: todayEntry.date }) })}
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
  );
}

export function CompactBodyweightRow({ entries }: { entries: DailyBodyweightEntry[] }) {
  const navigate = useNavigate({ from: '/body' });
  const today = todayLocalIsoDate();
  const todayEntry = entries.find((entry) => entry.date === today);
  const trend = bodyweightTrend(entries, today);

  if (!todayEntry) {
    return null;
  }

  return (
    <button
      type="button"
      className="mt-4 flex w-full items-center gap-3 rounded-card border border-border-subtle bg-surface-raised px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      onClick={() => void navigate({ search: (previous) => ({ ...previous, date: todayEntry.date }) })}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">
          Daily Bodyweight
        </span>
        <span className="mt-1 block text-sm font-extrabold text-text-primary">
          {todayEntry.hasValue ? `${todayEntry.weight} lb` : 'Not logged yet'}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">
          7-day avg
        </span>
        <span className="mt-1 block font-mono text-xs font-bold text-text-secondary">
          {trend.average === null ? '—' : `${formatWeight(trend.average)} lb`}
        </span>
      </span>
      <ArrowRight aria-hidden="true" size={15} className="shrink-0 text-text-faint" />
    </button>
  );
}

export function TrendCard({ entries }: { entries: DailyBodyweightEntry[] }) {
  const today = todayLocalIsoDate();
  const trend = bodyweightTrend(entries, today);
  const segments = sparklineSegments(trend.values, SPARKLINE_WIDTH, SPARKLINE_HEIGHT);
  const change = trend.change;
  const hasChange = change !== null && Math.abs(change) >= 0.05;
  const ChangeIcon = change !== null && change > 0 ? TrendUp : TrendDown;

  return (
    <section
      className="mt-4 overflow-hidden rounded-card border border-border-subtle bg-surface-raised"
      aria-labelledby="bodyweight-trend-heading"
    >
      <div className="flex items-start justify-between gap-4 px-4 pt-4">
        <div>
          <h2
            id="bodyweight-trend-heading"
            className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted"
          >
            7-Day Trend
          </h2>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[2rem] font-black leading-none tracking-display">
              {trend.latest === null ? '—' : formatWeight(trend.latest)}
            </span>
            <span className="font-mono text-[0.625rem] font-semibold uppercase text-text-faint">
              lbs
            </span>
          </div>
        </div>
        {hasChange ? (
          <span
            className={`mt-6 flex items-center gap-1 font-mono text-xs font-bold ${change < 0 ? 'text-complete' : 'text-partial'}`}
          >
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
        <svg
          className="h-[5.25rem] w-full overflow-visible"
          viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="bodyweight-trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-action)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--color-action)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1="6"
            x2={SPARKLINE_WIDTH - 6}
            y1={SPARKLINE_HEIGHT - 6}
            y2={SPARKLINE_HEIGHT - 6}
            stroke="var(--color-border-subtle)"
          />
          {segments.map((segment, index) => {
            const points = segment.map((point) => `${point.x},${point.y}`).join(' ');
            if (segment.length === 1) {
              return (
                <circle
                  key={index}
                  cx={segment[0].x}
                  cy={segment[0].y}
                  r="3.5"
                  fill="var(--color-action)"
                />
              );
            }
            const areaPoints = `${segment[0].x},${SPARKLINE_HEIGHT - 6} ${points} ${segment.at(-1)?.x},${SPARKLINE_HEIGHT - 6}`;
            return (
              <g key={index}>
                <polygon points={areaPoints} fill="url(#bodyweight-trend-fill)" />
                <polyline
                  points={points}
                  fill="none"
                  stroke="var(--color-action)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
        </svg>
        <div className="mt-1 flex justify-between px-1 font-mono text-[0.625rem] text-text-faint">
          <span>{trend.entries[0] ? formatShortDate(trend.entries[0].date) : '—'}</span>
          <span>
            {trend.entries.at(-1) ? formatShortDate(trend.entries.at(-1)!.date) : '—'}
          </span>
        </div>
      </div>
    </section>
  );
}

export function RecentBodyweightList({ entries }: { entries: DailyBodyweightEntry[] }) {
  const navigate = useNavigate({ from: '/body' });
  const today = todayLocalIsoDate();
  const recentEntries = entries
    .filter((entry) => entry.date <= today)
    .slice(-RECENT_COUNT)
    .reverse();

  return (
    <section className="mt-5" aria-labelledby="recent-bodyweight-heading">
      <div className="flex items-baseline justify-between px-1">
        <h2
          id="recent-bodyweight-heading"
          className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted"
        >
          Recent Bodyweight
        </h2>
        <span className="font-mono text-[0.625rem] font-semibold uppercase tracking-label text-text-faint">
          lbs
        </span>
      </div>
      <ul className="mt-2 space-y-2">
        {recentEntries.map((entry) => (
          <li key={entry.date}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-card border border-border-subtle bg-surface-raised px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              onClick={() =>
                void navigate({ search: (previous) => ({ ...previous, date: entry.date }) })
              }
            >
              <span className="min-w-0 flex-1 text-sm font-bold text-text-secondary">
                {formatShortDate(entry.date)}
                {entry.date === today ? (
                  <span className="ml-2 rounded-full bg-action-muted px-2 py-0.5 font-mono text-[0.5625rem] font-semibold uppercase text-action">
                    Today
                  </span>
                ) : null}
              </span>
              <span
                className={`font-mono text-sm font-bold ${entry.hasValue ? 'text-text-primary' : 'text-text-faint'}`}
              >
                {entry.weight ?? '—'}
              </span>
              <ArrowRight aria-hidden="true" size={15} className="text-text-faint" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BodyweightHubSections({ entries, compact }: BodyweightHubSectionsProps) {
  if (compact) {
    return <CompactBodyweightRow entries={entries} />;
  }

  return (
    <>
      <BodyweightPrompt entries={entries} />
      <TrendCard entries={entries} />
      <RecentBodyweightList entries={entries} />
    </>
  );
}
