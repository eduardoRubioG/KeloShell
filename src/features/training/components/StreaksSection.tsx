import { ArrowRight, Drop, Lightning, Scales, Warning } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { StreakSummary, StreaksResponse } from '../../../contracts/streaks';
import { fetchStreaks, logCreatineHabit } from '../api/streaks';

interface StreaksSectionProps {
  today: string;
}

export function StreaksSection({ today }: StreaksSectionProps) {
  const query = useQuery({
    queryKey: ['streaks', today],
    queryFn: () => fetchStreaks(today),
  });

  if (query.isPending) {
    return <StreaksSkeleton />;
  }

  if (query.isError || !query.data) {
    return null;
  }

  return <StreaksContent data={query.data} today={today} />;
}

function StreaksContent({
  data,
  today,
}: {
  data: StreaksResponse;
  today: string;
}) {
  const navigate = useNavigate({ from: '/' });
  const queryClient = useQueryClient();

  const creatineStreak = data.streaks.find((s) => s.key === 'creatine');
  const bodyweightStreak = data.streaks.find((s) => s.key === 'bodyweight');
  const workoutsStreak = data.streaks.find((s) => s.key === 'workouts');

  const mutation = useMutation({
    mutationFn: logCreatineHabit,
    onSuccess: (response: StreaksResponse) => {
      queryClient.setQueryData(['streaks', today], response);
    },
  });

  const handleCreatineTap = () => {
    if (mutation.isPending || !creatineStreak) return;
    mutation.mutate({
      operation: creatineStreak.todayComplete ? 'unlog' : 'log',
      date: today,
    });
  };

  return (
    <div className="mt-5">
      {data.bodyweightPrompt ? (
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-card border border-action/35 bg-action-soft px-4 py-3.5 text-left transition-colors hover:bg-action-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          onClick={() =>
            void navigate({
              to: '/body',
              search: { date: data.bodyweightPrompt!.date },
            })
          }
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-action-muted text-action">
            <Warning aria-hidden="true" size={18} weight="fill" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">
              Log today&apos;s bodyweight
            </span>
            <span className="mt-0.5 block font-mono text-[0.6875rem] text-text-muted">
              {formatShortDate(data.bodyweightPrompt.date)} · no value yet
            </span>
          </span>
          <ArrowRight
            aria-hidden="true"
            size={17}
            weight="bold"
            className="shrink-0 text-action"
          />
        </button>
      ) : null}

      <p className="mt-5 font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
        Streaks
      </p>
      <div className="mt-2 flex gap-3">
        {creatineStreak ? (
          <button
            type="button"
            className="flex flex-1 flex-col rounded-card border border-partial-border bg-partial-soft px-3 pb-3 pt-3 text-left transition-colors hover:bg-partial-soft-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleCreatineTap}
            disabled={mutation.isPending}
            aria-label={`Creatine streak: ${creatineStreak.count} days. ${creatineStreak.todayComplete ? 'Logged today. Tap to unlog.' : 'Tap to log today.'}`}
          >
            <StreakCardContent
              streak={creatineStreak}
              icon={<Drop aria-hidden="true" size={16} weight="fill" />}
              iconColorClass="bg-partial-muted text-partial"
              pillLabel={creatineStreak.todayComplete ? '✓ Logged' : 'log today'}
              pillColorClass={
                creatineStreak.todayComplete
                  ? 'bg-complete-soft text-complete'
                  : 'bg-surface-control text-text-muted'
              }
            />
          </button>
        ) : null}

        {bodyweightStreak ? (
          <div
            className="flex flex-1 flex-col rounded-card border border-action/35 bg-action-soft px-3 pb-3 pt-3"
            aria-label={`Bodyweight streak: ${bodyweightStreak.count} days.`}
          >
            <StreakCardContent
              streak={bodyweightStreak}
              icon={<Scales aria-hidden="true" size={16} weight="fill" />}
              iconColorClass="bg-action-muted text-action"
              pillLabel={bodyweightStreak.todayComplete ? '✓ Logged' : 'log today'}
              pillColorClass={
                bodyweightStreak.todayComplete
                  ? 'bg-complete-soft text-complete'
                  : 'bg-surface-control text-text-muted'
              }
            />
          </div>
        ) : null}

        {workoutsStreak ? (
          <div
            className="flex flex-1 flex-col rounded-card border border-complete-border bg-complete-soft px-3 pb-3 pt-3"
            aria-label={`Workouts streak: ${workoutsStreak.count} weeks.`}
          >
            <StreakCardContent
              streak={workoutsStreak}
              icon={<Lightning aria-hidden="true" size={16} weight="fill" />}
              iconColorClass="bg-complete-muted text-complete"
              pillLabel={workoutsStreak.todayComplete ? 'complete' : 'in progress'}
              pillColorClass={
                workoutsStreak.todayComplete
                  ? 'bg-complete-soft text-complete'
                  : 'bg-surface-control text-text-muted'
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const STREAK_LABELS: Record<string, string> = {
  creatine: 'Creatine',
  bodyweight: 'Bodyweight',
  workouts: 'Workouts',
};

function StreakCardContent({
  streak,
  icon,
  iconColorClass,
  pillLabel,
  pillColorClass,
}: {
  streak: StreakSummary;
  icon: React.ReactNode;
  iconColorClass: string;
  pillLabel: string;
  pillColorClass: string;
}) {
  return (
    <>
      <span
        className={`grid size-8 place-items-center rounded-full ${iconColorClass}`}
      >
        {icon}
      </span>
      <span className="mt-2 font-mono text-[0.5625rem] font-semibold uppercase tracking-label text-text-muted">
        {STREAK_LABELS[streak.key] ?? streak.key}
      </span>
      <span className="mt-0.5 text-[1.75rem] font-black leading-none tracking-display">
        {streak.count}
      </span>
      <span className="font-mono text-[0.5625rem] font-semibold uppercase tracking-label text-text-muted">
        {streak.unit === 'day' ? 'DAY STREAK' : 'WK STREAK'}
      </span>
      <span
        className={`mt-2 inline-flex self-start rounded-full px-2 py-0.5 font-mono text-[0.5625rem] font-semibold uppercase ${pillColorClass}`}
      >
        {pillLabel}
      </span>
    </>
  );
}

function StreaksSkeleton() {
  return (
    <div className="mt-5" aria-busy="true" aria-label="Loading streaks">
      <div className="h-2.5 w-16 animate-pulse rounded bg-track" />
      <div className="mt-2 flex gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="h-28 flex-1 animate-pulse rounded-card bg-surface-raised"
          />
        ))}
      </div>
    </div>
  );
}

function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
