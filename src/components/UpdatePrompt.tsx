import { createPortal } from 'react-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (registration) {
        setInterval(() => {
          registration.update();
        }, UPDATE_CHECK_INTERVAL_MS);
      }
    },
  });

  if (!needRefresh) return null;

  return createPortal(
    <div
      role="alert"
      aria-live="polite"
      className="fixed left-4 right-4 z-[9999] mx-auto max-w-app pointer-events-auto"
      style={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom) + 0.75rem)' }}
    >
      <div className="rounded-card border border-border-strong bg-surface-raised px-4 py-3 shadow-app flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary leading-snug">Update available</p>
          <p className="text-xs text-text-muted mt-0.5">Reload to get the latest version.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setNeedRefresh(false)}
            className="text-xs text-text-muted px-2.5 py-1.5 rounded-control hover:text-text-secondary transition-colors"
          >
            Later
          </button>
          <button
            onClick={() => updateServiceWorker(true)}
            className="text-xs font-medium bg-action text-action-ink px-3 py-1.5 rounded-control hover:opacity-90 transition-opacity"
          >
            Update
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
