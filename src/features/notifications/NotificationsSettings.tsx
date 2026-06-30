import { Bell, BellSlash, CheckCircle, PaperPlaneTilt, Warning, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import {
  disableNotifications,
  enableNotifications,
  getNotificationStatus,
  sendTestPush,
  type NotificationStatus,
} from './push-client';

export function NotificationsSettings() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    getNotificationStatus()
      .then(setStatus)
      .catch(() => setStatus('unsupported'));
  }, []);

  const handleEnable = async () => {
    setLoading(true);
    setError(null);
    try {
      await enableNotifications();
      setStatus('subscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable notifications.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    setError(null);
    try {
      await disableNotifications();
      setStatus('unsubscribed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable notifications.');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setTestSent(false);
    try {
      await sendTestPush();
      setTestSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The test notification could not be sent.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-6 px-1" aria-labelledby="notifications-heading">
      <h2
        id="notifications-heading"
        className="font-mono text-[0.6875rem] font-semibold uppercase tracking-eyebrow text-text-muted"
      >
        Push Notifications
      </h2>

      <div className="mt-3 rounded-card border border-border-subtle bg-surface-raised">
        <StatusRow status={status} />

        {status === 'denied' ? (
          <div className="border-t border-border-subtle px-4 py-3">
            <p className="text-xs font-medium leading-5 text-text-muted">
              Notifications are blocked. To enable them, open your browser or device settings and
              allow notifications for this site, then reload.
            </p>
          </div>
        ) : null}

        {status === 'unsupported' ? (
          <div className="border-t border-border-subtle px-4 py-3">
            <p className="text-xs font-medium leading-5 text-text-muted">
              Push notifications require this app to be installed on a supported device.
            </p>
          </div>
        ) : null}
      </div>

      {status === 'subscribed' ? (
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleTest()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-card border border-border-subtle bg-surface-raised text-sm font-bold text-text-secondary transition-colors hover:bg-surface-control disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          >
            <PaperPlaneTilt aria-hidden="true" size={17} weight="bold" />
            {loading ? 'Sending…' : 'Send test notification'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleDisable()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-card border border-border-subtle bg-surface-raised text-sm font-bold text-text-secondary transition-colors hover:bg-surface-control disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          >
            <BellSlash aria-hidden="true" size={17} weight="bold" />
            {loading ? 'Disabling…' : 'Disable notifications'}
          </button>
        </div>
      ) : status === 'unsubscribed' ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => void handleEnable()}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-card bg-action text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          <Bell aria-hidden="true" size={17} weight="bold" />
          {loading ? 'Enabling…' : 'Enable notifications'}
        </button>
      ) : null}

      <div className="mt-3 min-h-8" aria-live="polite">
        {error ? (
          <p className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
            <X aria-hidden="true" size={14} weight="bold" className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : testSent ? (
          <p className="flex items-center gap-1.5 px-1 text-xs font-bold text-complete">
            <CheckCircle aria-hidden="true" size={14} weight="bold" />
            Test notification sent — check your device.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function StatusRow({ status }: { status: NotificationStatus | null }) {
  if (status === null) {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="h-4 w-4 animate-pulse rounded-full bg-track" />
        <div className="h-3.5 w-24 animate-pulse rounded bg-track" />
      </div>
    );
  }

  const configs: Record<
    NotificationStatus,
    { icon: React.ReactNode; label: string; color: string }
  > = {
    subscribed: {
      icon: <Bell aria-hidden="true" size={16} weight="fill" />,
      label: 'Subscribed',
      color: 'text-complete',
    },
    unsubscribed: {
      icon: <BellSlash aria-hidden="true" size={16} weight="bold" />,
      label: 'Not enabled',
      color: 'text-text-faint',
    },
    denied: {
      icon: <Warning aria-hidden="true" size={16} weight="fill" />,
      label: 'Blocked by browser',
      color: 'text-partial',
    },
    unsupported: {
      icon: <BellSlash aria-hidden="true" size={16} weight="bold" />,
      label: 'Not supported',
      color: 'text-text-faint',
    },
  };

  const { icon, label, color } = configs[status];

  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${color}`}>
      {icon}
      <span className="text-sm font-bold">{label}</span>
    </div>
  );
}
