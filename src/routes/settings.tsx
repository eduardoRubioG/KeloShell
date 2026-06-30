import { createFileRoute } from '@tanstack/react-router';

import { NotificationsSettings } from '../features/notifications/NotificationsSettings';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <section className="px-1">
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted">
        Settings
      </p>
      <h1 className="mt-2 text-[2.375rem] font-black leading-none tracking-display">Settings</h1>
      <NotificationsSettings />
    </section>
  );
}
