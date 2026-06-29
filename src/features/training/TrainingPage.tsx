import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';

import { fetchTrainingWeeks } from './api/training-weeks';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { LiftLogging } from './components/LiftLogging';
import { TrainingWeekHeader } from './components/TrainingWeekHeader';

export function TrainingPage() {
  const {
    week: requestedWeekId,
    session: requestedSessionName,
    lift: requestedLiftId,
  } = useSearch({ from: '/' });
  const navigate = useNavigate({ from: '/' });
  const trainingWeeksQuery = useQuery({
    queryKey: ['training-weeks'],
    queryFn: fetchTrainingWeeks,
  });
  const response = trainingWeeksQuery.data;
  const requestedWeek = response?.weeks.find(
    (week) => week.id === requestedWeekId
  );
  const selectedWeek =
    requestedWeek ??
    response?.weeks.find((week) => week.id === response.defaultWeekId);
  const selectedSession = selectedWeek?.sessions.find(
    (session) => session.name === requestedSessionName
  );
  const selectedLift = selectedSession?.lifts.find(
    (lift) => lift.id === requestedLiftId
  );

  useEffect(() => {
    if (!response || requestedWeek) {
      return;
    }
    if (response.defaultWeekId !== requestedWeekId) {
      void navigate({
        search: {
          week: response.defaultWeekId ?? undefined,
          session: undefined,
          lift: undefined,
        },
        replace: true,
      });
    }
  }, [navigate, requestedWeek, requestedWeekId, response]);

  useEffect(() => {
    if (!response || !requestedSessionName || selectedSession) {
      return;
    }
    void navigate({
      search: { week: selectedWeek?.id, session: undefined, lift: undefined },
      replace: true,
    });
  }, [
    navigate,
    requestedSessionName,
    response,
    selectedSession,
    selectedWeek?.id,
  ]);

  useEffect(() => {
    if (!response || !requestedLiftId || selectedLift) {
      return;
    }
    void navigate({
      search: {
        week: selectedWeek?.id,
        session: selectedSession?.name,
        lift: undefined,
      },
      replace: true,
    });
  }, [
    navigate,
    requestedLiftId,
    response,
    selectedLift,
    selectedSession?.name,
    selectedWeek?.id,
  ]);

  if (trainingWeeksQuery.isPending) {
    return <TrainingPageLoading />;
  }

  if (trainingWeeksQuery.isError) {
    return (
      <TrainingPageMessage
        eyebrow="Source Spreadsheet"
        title="Training is unavailable"
        detail={trainingWeeksQuery.error.message}
        action={
          <button
            type="button"
            className="rounded-control bg-action px-4 py-2.5 text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            onClick={() => void trainingWeeksQuery.refetch()}
          >
            Try again
          </button>
        }
      />
    );
  }

  if (!response || response.weeks.length === 0) {
    return (
      <TrainingPageMessage
        eyebrow="Training Week"
        title="No weeks found"
        detail="The Source Spreadsheet does not contain any Training Week rows yet."
      />
    );
  }

  if (!selectedWeek) {
    return (
      <TrainingPageMessage
        eyebrow="Program Definition"
        title="No available weeks"
        detail="Training Week rows exist, but none currently have complete Program Definitions for all four sessions."
      />
    );
  }

  const availableWeeks = response.weeks.filter(
    (week) => week.availability === 'available'
  );
  const currentAvailableIndex = availableWeeks.findIndex(
    (week) => week.id === selectedWeek.id
  );
  const previousWeek =
    currentAvailableIndex > 0
      ? availableWeeks[currentAvailableIndex - 1]
      : selectedWeek.availability === 'unavailable'
        ? availableWeeks.findLast((week) => week.id < selectedWeek.id)
        : undefined;
  const nextWeek =
    currentAvailableIndex >= 0
      ? availableWeeks[currentAvailableIndex + 1]
      : availableWeeks.find((week) => week.id > selectedWeek.id);
  const selectWeek = (weekId: string) =>
    navigate({ search: { week: weekId, session: undefined, lift: undefined } });

  if (selectedWeek && selectedSession && selectedLift) {
    return (
      <LiftLogging
        key={`${selectedWeek.id}-${selectedSession.name}-${selectedLift.id}-${selectedLift.revision}`}
        week={selectedWeek}
        session={selectedSession}
        lift={selectedLift}
        onBack={() =>
          void navigate({
            search: {
              week: selectedWeek.id,
              session: selectedSession.name,
              lift: undefined,
            },
          })
        }
        onSynced={() =>
          void navigate({
            search: {
              week: selectedWeek.id,
              session: selectedSession.name,
              lift: undefined,
            },
          })
        }
      />
    );
  }

  if (selectedSession) {
    return (
      <SessionDetail
        week={selectedWeek}
        session={selectedSession}
        syncedAt={trainingWeeksQuery.dataUpdatedAt}
        onBack={() =>
          void navigate({
            search: {
              week: selectedWeek.id,
              session: undefined,
              lift: undefined,
            },
          })
        }
        onSelectLift={(lift) =>
          void navigate({
            search: {
              week: selectedWeek.id,
              session: selectedSession.name,
              lift: lift.id,
            },
          })
        }
      />
    );
  }

  return (
    <>
      <TrainingWeekHeader
        week={selectedWeek}
        previousWeekId={previousWeek?.id}
        nextWeekId={nextWeek?.id}
        onSelectWeek={selectWeek}
      />
      {selectedWeek.availability === 'available' ? (
        <SessionList
          sessions={selectedWeek.sessions}
          onSelectSession={(session) =>
            void navigate({
              search: {
                week: selectedWeek.id,
                session: session.name,
                lift: undefined,
              },
            })
          }
        />
      ) : (
        <TrainingPageMessage
          eyebrow="Program Definition"
          title="Week not available"
          detail="This Training Week exists in the Source Spreadsheet, but one or more Workout Sessions have not been programmed."
          compact
        />
      )}
    </>
  );
}

function TrainingPageLoading() {
  return (
    <div aria-label="Loading Training Week" aria-busy="true">
      <div className="flex items-center gap-5 px-1.5">
        <div className="size-24 shrink-0 animate-pulse rounded-full bg-track" />
        <div className="flex-1">
          <div className="h-2.5 w-24 animate-pulse rounded bg-track" />
          <div className="mt-3 h-9 w-32 animate-pulse rounded bg-surface-control" />
          <div className="mt-2 h-3 w-24 animate-pulse rounded bg-track" />
        </div>
      </div>
      <div className="mt-8 grid gap-2.5">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-[4.625rem] animate-pulse rounded-session border border-border-subtle bg-surface-raised"
          />
        ))}
      </div>
    </div>
  );
}

interface TrainingPageMessageProps {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
  compact?: boolean;
}

function TrainingPageMessage({
  eyebrow,
  title,
  detail,
  action,
  compact = false,
}: TrainingPageMessageProps) {
  return (
    <section
      className={`${compact ? 'mt-8' : 'px-1 pt-8'} max-w-sm`}
      aria-live="polite"
    >
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-[2rem] font-black leading-none tracking-display">
        {title}
      </h1>
      <p className="mt-4 text-sm font-medium leading-6 text-text-muted">
        {detail}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
