import { BodyweightPrompt } from './components/BodyweightPrompt';
import { SessionList } from './components/SessionList';
import { TrainingWeekHeader } from './components/TrainingWeekHeader';

export function TrainingPage() {
  return (
    <>
      <TrainingWeekHeader />
      <BodyweightPrompt />
      <SessionList />
    </>
  );
}
