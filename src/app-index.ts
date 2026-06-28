import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import type {
  ConnectivityCheck,
  ConnectivityReport,
} from './contracts/connectivity';
import './styles/global.css';

type ScreenState = 'idle' | 'running' | 'complete' | 'request-error';

@customElement('app-index')
export class AppIndex extends LitElement {
  @state() private screenState: ScreenState = 'idle';
  @state() private report?: ConnectivityReport;
  @state() private requestError = '';

  static styles = css`
    :host {
      --ink: #171714;
      --paper: #f2f0e9;
      --surface: #fbfaf5;
      --line: #cac6b8;
      --muted: #69675f;
      --signal: #d9ff43;
      --danger: #d5412d;
      --success: #147a52;
      display: block;
      min-height: 100dvh;
      color: var(--ink);
      background:
        linear-gradient(rgba(23, 23, 20, 0.045) 1px, transparent 1px),
        var(--paper);
      background-size: 100% 28px;
    }

    * {
      box-sizing: border-box;
    }

    main {
      width: min(100%, 920px);
      min-height: 100dvh;
      margin: 0 auto;
      padding: 18px 18px 44px;
    }

    .masthead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 52px;
      border-top: 7px solid var(--ink);
      border-bottom: 1px solid var(--ink);
    }

    .wordmark {
      margin: 0;
      font-family: 'Arial Narrow', 'Roboto Condensed', sans-serif;
      font-size: 1.05rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .private-label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    .private-label::before {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      content: '';
    }

    .intro {
      display: grid;
      gap: 24px;
      padding: 48px 0 34px;
      border-bottom: 1px solid var(--ink);
    }

    .eyebrow,
    .section-label,
    .metadata dt {
      margin: 0;
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.68rem;
      font-weight: 750;
      line-height: 1.4;
      text-transform: uppercase;
    }

    h1 {
      max-width: 700px;
      margin: 7px 0 0;
      font-family: 'Arial Narrow', 'Roboto Condensed', sans-serif;
      font-size: clamp(3.25rem, 13vw, 7.2rem);
      font-stretch: condensed;
      font-weight: 900;
      letter-spacing: -0.065em;
      line-height: 0.79;
      text-transform: uppercase;
    }

    .intro-copy {
      max-width: 570px;
      margin: 0;
      color: var(--muted);
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 1.05rem;
      line-height: 1.55;
    }

    .console {
      margin-top: 22px;
      border: 1px solid var(--ink);
      background: var(--surface);
      box-shadow: 7px 7px 0 var(--ink);
    }

    .console-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 50px;
      padding: 0 15px;
      border-bottom: 1px solid var(--ink);
      background: var(--ink);
      color: var(--paper);
    }

    .mode {
      color: var(--signal);
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .console-body {
      padding: 16px;
    }

    .idle-panel,
    .error-panel {
      min-height: 250px;
      display: grid;
      align-content: space-between;
      gap: 30px;
    }

    .idle-panel p,
    .error-panel p {
      max-width: 520px;
      margin: 0;
      font-size: 0.95rem;
      line-height: 1.55;
    }

    button {
      position: relative;
      width: 100%;
      min-height: 62px;
      border: 1px solid var(--ink);
      border-radius: 0;
      background: var(--signal);
      color: var(--ink);
      cursor: pointer;
      font: 850 0.83rem/1 ui-monospace, 'SFMono-Regular', Consolas, monospace;
      text-transform: uppercase;
      transition:
        transform 120ms ease,
        box-shadow 120ms ease;
    }

    button:hover:not(:disabled) {
      box-shadow: 4px 4px 0 var(--ink);
      transform: translate(-2px, -2px);
    }

    button:active:not(:disabled) {
      box-shadow: none;
      transform: translate(0, 0);
    }

    button:focus-visible {
      outline: 3px solid var(--danger);
      outline-offset: 3px;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    .running {
      min-height: 250px;
      display: grid;
      place-items: center;
      text-align: center;
    }

    .pulse {
      width: 76px;
      height: 76px;
      margin: 0 auto 24px;
      border: 14px solid var(--ink);
      background: var(--signal);
      animation: test-pulse 900ms steps(2, end) infinite;
    }

    .running p {
      margin: 0;
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.75rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .summary {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: start;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }

    .summary h2 {
      margin: 4px 0 0;
      font-family: 'Arial Narrow', 'Roboto Condensed', sans-serif;
      font-size: clamp(2.1rem, 8vw, 3.8rem);
      font-weight: 900;
      letter-spacing: -0.04em;
      line-height: 0.92;
      text-transform: uppercase;
    }

    .summary h2.success {
      color: var(--success);
    }

    .summary h2.failure {
      color: var(--danger);
    }

    .duration {
      margin-top: 4px;
      padding: 7px 9px;
      border: 1px solid var(--ink);
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.7rem;
      font-weight: 800;
    }

    .check-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .check {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) auto;
      gap: 11px;
      align-items: start;
      padding: 15px 0;
      border-bottom: 1px solid var(--line);
    }

    .check-mark {
      display: grid;
      width: 22px;
      height: 22px;
      place-items: center;
      border: 1px solid currentColor;
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.72rem;
      font-weight: 900;
    }

    .check.passed .check-mark {
      background: var(--success);
      color: white;
    }

    .check.failed .check-mark {
      background: var(--danger);
      color: white;
    }

    .check.skipped .check-mark {
      color: var(--muted);
    }

    .check strong {
      display: block;
      margin-bottom: 3px;
      font-size: 0.85rem;
    }

    .check p {
      margin: 0;
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.4;
    }

    .check time {
      color: var(--muted);
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.62rem;
    }

    .result-actions {
      padding-top: 16px;
    }

    .metadata {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      margin: 26px 0 0;
      border: 1px solid var(--ink);
      background: var(--ink);
    }

    .metadata div {
      padding: 14px;
      background: var(--paper);
    }

    .metadata dd {
      margin: 5px 0 0;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 0.9rem;
    }

    .error-panel .error-code {
      color: var(--danger);
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    @keyframes test-pulse {
      50% {
        transform: scale(0.72) rotate(45deg);
      }
    }

    @media (min-width: 680px) {
      main {
        padding: 28px 34px 70px;
      }

      .intro {
        grid-template-columns: 1.4fr 0.6fr;
        align-items: end;
        padding: 70px 0 46px;
      }

      .console-body {
        padding: 24px;
      }

      .idle-panel,
      .error-panel,
      .running {
        min-height: 290px;
      }

      .metadata {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        scroll-behavior: auto !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;

  render() {
    return html`
      <main>
        <header class="masthead">
          <p class="wordmark">KeloShell</p>
          <span class="private-label">Private tool</span>
        </header>

        <section class="intro" aria-labelledby="page-title">
          <div>
            <p class="eyebrow">System check / 01</p>
            <h1 id="page-title">Sheet link</h1>
          </div>
          <p class="intro-copy">
            Confirm the secure path from this PWA through Cloudflare to the
            bodybuilding spreadsheet replica.
          </p>
        </section>

        <section class="console" aria-labelledby="console-title">
          <header class="console-head">
            <span id="console-title" class="section-label">Connection console</span>
            <span class="mode">Replica / write-safe</span>
          </header>
          <div class="console-body" aria-live="polite">
            ${this.renderConsole()}
          </div>
        </section>

        <dl class="metadata">
          <div>
            <dt>Route</dt>
            <dd>Same-origin proxy</dd>
          </div>
          <div>
            <dt>Host</dt>
            <dd>Cloudflare Pages</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>${this.report?.target ?? 'Replica'}</dd>
          </div>
          <div>
            <dt>Persistence</dt>
            <dd>Marker restored</dd>
          </div>
        </dl>
      </main>
    `;
  }

  private renderConsole() {
    if (this.screenState === 'running') {
      return html`
        <div class="running">
          <div>
            <div class="pulse" aria-hidden="true"></div>
            <p>Running secure round trip</p>
          </div>
        </div>
      `;
    }

    if (this.screenState === 'request-error') {
      return html`
        <div class="error-panel">
          <div>
            <p class="error-code">Request stopped</p>
            <p>${this.requestError}</p>
          </div>
          <button type="button" @click=${this.runTest}>Try again</button>
        </div>
      `;
    }

    if (this.screenState === 'complete' && this.report) {
      return this.renderReport(this.report);
    }

    return html`
      <div class="idle-panel">
        <p>
          This writes one temporary marker to the replica, reads it back, then
          clears it. No workout data is touched.
        </p>
        <button type="button" @click=${this.runTest}>
          Run connectivity test
        </button>
      </div>
    `;
  }

  private renderReport(report: ConnectivityReport) {
    return html`
      <div class="summary">
        <div>
          <p class="section-label">Final state</p>
          <h2 class=${report.ok ? 'success' : 'failure'}>
            ${report.ok ? 'Link confirmed' : 'Check failed'}
          </h2>
        </div>
        <span class="duration">${report.durationMs} ms</span>
      </div>

      <ol class="check-list">
        ${report.checks.map((check) => this.renderCheck(check))}
      </ol>

      <div class="result-actions">
        <button type="button" @click=${this.runTest}>Run again</button>
      </div>
    `;
  }

  private renderCheck(check: ConnectivityCheck) {
    const mark =
      check.status === 'passed' ? '✓' : check.status === 'failed' ? '!' : '—';
    return html`
      <li class="check ${check.status}">
        <span class="check-mark" aria-hidden="true">${mark}</span>
        <div>
          <strong>${check.label}</strong>
          <p>${check.detail}</p>
        </div>
        ${check.durationMs > 0
          ? html`<time>${check.durationMs} ms</time>`
          : nothing}
      </li>
    `;
  }

  private runTest = async (): Promise<void> => {
    this.screenState = 'running';
    this.report = undefined;
    this.requestError = '';

    try {
      const response = await fetch('/api/connectivity-test', {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error('Your access session may have expired. Reload to sign in.');
      }

      const payload = (await response.json()) as
        | ConnectivityReport
        | { error?: string };
      if (!response.ok || !('checks' in payload)) {
        throw new Error(
          'error' in payload && payload.error
            ? payload.error
            : 'The proxy could not run the diagnostic.'
        );
      }

      this.report = payload;
      this.screenState = 'complete';
    } catch (error) {
      this.requestError =
        error instanceof Error
          ? error.message
          : 'The proxy could not run the diagnostic.';
      this.screenState = 'request-error';
    }
  };
}
