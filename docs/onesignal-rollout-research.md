# OneSignal rollout research

## Question

How should KeloShell identify and target individual Subscribers with OneSignal, what PWA constraints apply, and when should the existing custom Web Push implementation be replaced?

## Findings

### Identity and targeting

- The Web SDK's `login(external_id)` associates the current browser subscription with a stable application-owned user identifier and unifies later activity under OneSignal's user model. KeloShell should use its non-email Subscriber ID, not an email address, as `external_id`.
- On sign-out or account change, `logout()` unlinks the current user context and returns the browser to an anonymous state.
- OneSignal recommends transactional targeting through `include_aliases.external_id` with `target_channel: "push"`. Reminder dispatch should therefore send to the resolved Subscriber ID rather than segments, tags, email addresses, or OneSignal-generated subscription IDs.
- Identity verification should be evaluated before rollout so a browser cannot claim another Subscriber's external ID merely by calling `login()`.

Sources:

- [Web SDK reference: login and logout](https://documentation.onesignal.com/docs/en/web-sdk-reference)
- [Transactional messages: targeting aliases](https://documentation.onesignal.com/docs/en/transactional-messages)

### Service worker and PWA integration

- OneSignal's Web SDK requires a OneSignal service worker. Its path and scope can be configured with `serviceWorkerPath` and `serviceWorkerParam.scope`.
- KeloShell already owns a root-scoped PWA service worker for update and notification behavior. A second overlapping worker can create conflicts, so the implementation decision must explicitly choose either a combined worker or a non-overlapping OneSignal scope and then verify notification clicks, app updates, offline behavior, and installed-PWA behavior.
- OneSignal's v16 worker loads `https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js`; this adds a hosted runtime dependency to notification delivery.

Sources:

- [OneSignal Web SDK migration guide](https://github.com/OneSignal/OneSignal-Website-SDK/blob/main/MIGRATION_GUIDE.md)
- [OneSignal service-worker setup example](https://documentation.onesignal.com/docs/en/angular-setup)
- [OneSignal confirmed-delivery worker reference](https://documentation.onesignal.com/docs/en/confirmed-delivery)

### Browser and iOS constraints

- Web push requires a secure HTTPS origin and notification permission initiated through user interaction.
- On iOS and iPadOS, web push requires version 16.4 or later, a valid web app manifest, installation to the Home Screen, and opening the installed app before requesting permission.
- These constraints are onboarding requirements, not details OneSignal removes. The concierge runbook and release gates need device-specific installation and live-delivery checks.

Sources:

- [Web push setup](https://documentation.onesignal.com/docs/en/web-push-setup)
- [iOS web push setup](https://documentation.onesignal.com/docs/en/web-push-for-ios)

### Migration limits

- Existing web-push subscriptions are not generally portable between providers because the active service worker, push subscription, VAPID credentials, and provider records participate in delivery.
- Installing a new provider's worker may eventually resubscribe a returning browser, but it does not make all existing Subscribers immediately targetable through the new provider.
- KeloShell must treat migration as re-enrollment: preserve the current custom delivery until a Subscriber has initialized OneSignal, logged in with the correct external ID, granted permission where necessary, and passed a targeted test send.
- Reusing the current VAPID key may reduce browser-level churn only if OneSignal supports the exact configuration; it does not import KeloShell's KV records or establish OneSignal user identity by itself.

Sources:

- [OneSignal Web SDK migration discussion: exporting or importing web subscribers](https://github.com/OneSignal/OneSignal-Website-SDK/wiki/What-happens-if-I-switch-from-OneSignal-to-another-push-provider%3F)
- [Web SDK push-subscription namespace](https://github.com/OneSignal/OneSignal-Website-SDK/blob/main/MIGRATION_GUIDE.md)

## Decision implications

- Keeping custom Web Push through the three-Subscriber alpha is the shortest path to alpha because it avoids coupling that stage to Supabase identity, worker coexistence, and re-enrollment.
- Migrating before the alpha reduces throwaway validation of a retiring stack, but makes Supabase identity and the OneSignal migration release-critical first.
- In either sequence, OneSignal should be established before the five-client cohort. Use the immutable Subscriber ID as `external_id`, call `login()` only after authenticated tenant resolution, and target reminders with `include_aliases.external_id`.
- A dual-delivery migration window must switch each Subscriber only after a successful targeted test and deduplicate reminder delivery so two providers cannot send the same reminder.
- The five-client cohort should not begin until supported installed-PWA paths pass permission, background delivery, click-through, logout/account-change, and reinstallation checks.
- General availability should have one supported delivery path; retire custom Web Push after every active cohort Subscriber is confirmed on OneSignal or has explicitly opted out.

## Decisions still requiring human input

- Whether iOS push is release-critical for the five-client cohort.
- Whether KeloShell will combine service-worker behavior or isolate OneSignal under a narrower scope.
- How long the dual-delivery migration window may remain open.
- What notification data and retention disclosures Subscribers receive.
