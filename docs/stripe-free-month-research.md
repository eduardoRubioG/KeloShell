# Stripe card-upfront free-month research

## Question

How should KeloShell give five limited-cohort Subscribers a clearly disclosed free first month, collect a payment method up front, and renew at the normal monthly price?

## Findings

### One-time 100% coupon versus trial

- Stripe supports a coupon with `percent_off=100` and `duration=once`. On a subscription, `once` discounts only the next finalized invoice; later invoices use the normal recurring price.
- A promotion code can expose that coupon as a customer-entered code and add redemption restrictions. If KeloShell applies the offer after validating cohort eligibility, applying the coupon server-side is simpler and avoids code sharing.
- A free trial through `trial_period_days` models delayed billing and emits trial-specific lifecycle events. For the stated offer—“100% off the first month, then normal monthly price”—a once-duration coupon is the closer semantic match.

Sources:

- [No-cost Checkout orders](https://docs.stripe.com/payments/checkout/no-cost-orders)
- [Subscription discounts](https://docs.stripe.com/billing/subscriptions/discounts)
- [Coupon duration behavior](https://docs.stripe.com/billing/subscriptions/coupons)
- [Subscription trials](https://docs.stripe.com/billing/subscriptions/trials)

### Collecting a card up front

- Checkout in `subscription` mode creates a recurring subscription from recurring Price line items.
- Because a zero-total first invoice can make a payment method unnecessary for that invoice, KeloShell must configure and test Checkout so a reusable payment method is collected and attached despite the 100% discount.
- Trial configurations expose `payment_method_collection` and missing-payment-method end behavior. The coupon flow still requires an end-to-end test proving card collection on a no-cost first invoice.

Sources:

- [Build subscriptions with Checkout](https://docs.stripe.com/billing/subscriptions/build-subscriptions?payment-ui=checkout&ui=stripe-hosted)
- [Free trials with Checkout](https://docs.stripe.com/billing/subscriptions/trials/free-trials?how=checkout)
- [No-cost orders](https://docs.stripe.com/payments/checkout/no-cost-orders)

### Renewal, cancellation, and entitlement events

- Provision identity and subscription linkage from the signed `checkout.session.completed` webhook, not solely from the browser redirect.
- `invoice.paid` confirms continued entitlement. `invoice.payment_failed` should drive the accepted grace-period behavior and payment-method recovery.
- `customer.subscription.updated` and `customer.subscription.deleted` reflect cancellation and terminal state. Cancellation at period end should preserve entitlement until that period ends.
- Webhook signatures must be verified against the raw request body, handlers must be idempotent, and a local entitlement record should govern access.

Sources:

- [Checkout subscription webhooks](https://docs.stripe.com/billing/subscriptions/build-subscriptions?payment-ui=checkout&ui=stripe-hosted)
- [SaaS subscription events](https://docs.stripe.com/get-started/use-cases/saas-subscriptions)
- [Subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)

### Restrictions, disclosure, and testing

- Coupon and promotion-code restrictions can constrain redemption. The five-client offer should have an explicit deadline and maximum redemption count where supported.
- Use separate test and live objects, the Stripe CLI for webhook testing, and test clocks where supported to advance lifecycle time.
- The normal price, renewal date, automatic renewal, cancellation method, and requested feedback must be disclosed in product copy. Stripe configuration does not make that wording legally sufficient.

Sources:

- [Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons)
- [Stripe CLI](https://docs.stripe.com/stripe-cli/use-cli)
- [Test clocks](https://docs.stripe.com/billing/testing/test-clocks)

## Recommendation

1. Create one normal monthly recurring Price.
2. Create a 100%-off, `duration=once` coupon. Apply it server-side after cohort eligibility is validated; use a restricted promotion code only if entering a code is intentionally part of enrollment.
3. Require a reusable payment method during Checkout and prove in test mode that it is attached when the first invoice total is zero.
4. Show the normal monthly price, first renewal date, automatic-renewal behavior, and cancellation path before Checkout and in confirmation messaging.
5. Drive Subscription Entitlements from verified, idempotent webhooks: at minimum `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
6. Test enrollment, duplicate webhooks, cancellation during the free month, first paid renewal, failed renewal, payment-method replacement, offer misuse, and support handling before inviting the cohort.

## Decisions still requiring human input

- Automatic offer application versus a client-entered promotion code.
- Normal monthly price and tax treatment.
- Exact feedback expectations and whether non-participation has consequences.
- Renewal notices, cancellation wording, privacy terms, and jurisdiction-specific consumer requirements.
