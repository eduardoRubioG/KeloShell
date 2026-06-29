import { ArrowUp, Barbell, Target, TrendUp } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import type { ProgressionGuidance } from '../progression-guidance';

interface ProgressionDrawerProps {
  guidance: ProgressionGuidance;
  onDismiss: () => void;
}

export function ProgressionDrawer({
  guidance,
  onDismiss,
}: ProgressionDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="progression-drawer"
      aria-labelledby="progression-drawer-title"
      onClose={onDismiss}
      onMouseDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const isOutside =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (isOutside) {
          event.currentTarget.close();
        }
      }}
    >
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" />
      <header>
        <p className="font-mono text-[0.625rem] font-bold uppercase tracking-eyebrow text-progression">
          Progression guide
        </p>
        <h2
          ref={headingRef}
          id="progression-drawer-title"
          className="mt-1.5 text-2xl font-black leading-none tracking-display outline-none"
          tabIndex={-1}
        >
          {guidance.scheme}
        </h2>
      </header>

      <div className="mt-5 divide-y divide-border-subtle border-y border-border-subtle">
        <GuidanceRow
          icon={<Target aria-hidden="true" size={19} weight="bold" />}
          label="Your target"
          value={guidance.target}
        />
        <GuidanceRow
          icon={<ArrowUp aria-hidden="true" size={19} weight="bold" />}
          label="When to increase"
          value={guidance.increase}
        />
        <GuidanceRow
          icon={<Barbell aria-hidden="true" size={19} weight="bold" />}
          label="Starting load"
          value={guidance.startingLoad}
        />
      </div>

      <section className="mt-4 flex gap-3 rounded-control border border-progression/25 bg-progression/10 px-3.5 py-3">
        <TrendUp
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-progression"
          size={19}
          weight="bold"
        />
        <div>
          <h3 className="text-xs font-extrabold text-text-primary">Load change</h3>
          <p className="mt-1 text-xs font-medium leading-5 text-text-secondary">
            Increase by 5 lb / 2.5 kg or up to 5%. Use the RM calculator for
            estimated rep maxes.
          </p>
        </div>
      </section>

      <button
        type="button"
        className="mt-5 h-12 w-full rounded-card bg-action px-4 text-sm font-extrabold text-action-ink transition-colors hover:bg-action/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        onClick={() => dialogRef.current?.close()}
      >
        Close
      </button>
    </dialog>
  );
}

function GuidanceRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <section className="grid grid-cols-[1.75rem_1fr] gap-x-2.5 py-3.5">
      <span className="mt-0.5 text-progression">{icon}</span>
      <div>
        <h3 className="font-mono text-[0.625rem] font-bold uppercase tracking-label text-text-faint">
          {label}
        </h3>
        <p className="mt-1 text-sm font-semibold leading-5 text-text-primary">
          {value}
        </p>
      </div>
    </section>
  );
}
