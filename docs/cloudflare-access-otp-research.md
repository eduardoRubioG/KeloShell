# Cloudflare Access OTP delivery research

**Incident context:** keloshell.pages.dev is gated by Cloudflare Access/Zero Trust using the One-Time PIN (OTP) login method. Eduardo (owner) receives OTP codes normally. A newly added second user (a personal Gmail address) never receives an OTP code — nothing in spam or "all mail," checked on multiple devices. Eduardo confirmed that entering the *owner's* email on the *new user's* physical device delivers a code instantly, which rules out device, network, and browser as the cause. The problem is isolated to the new user's specific email address string. The Access policy is an Allow policy with an Include → Emails selector that (per a screenshot) contains the new user's address, saved in the dashboard. This document researches Cloudflare's own documentation (and, where docs are silent, community-reported anecdotes) to narrow down the cause.

---

## 1. Does Access send an OTP to any address, or only to policy-allowed addresses?

**Direct answer: only to addresses explicitly allowed by an Access policy on the app.** Cloudflare's own docs state this plainly, and pair it with a deliberate non-disclosure behavior: the login page shows the same "a code has been emailed to you" message whether or not a code was actually sent, so a user can't distinguish "email allowed, code sent, delivery failed" from "email not allowed, no code ever sent."

> "Cloudflare only sends the email if the user is allowed by an Access policy." … "blocked users will not receive an email. The login page will always say **A code has been emailed to you**, regardless of whether or not an email was sent."

Source: [One-time PIN login · Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

**Implication for this incident:** this is the single biggest fork in the diagnosis. Because the UI cannot distinguish "not sent" from "sent but undelivered," Eduardo's "no email arrives" symptom is *consistent with either* (a) a genuine mail-delivery failure on Gmail's side, or (b) the address silently failing to match any Allow policy so Cloudflare never attempted to send anything. Docs do not provide any user-facing signal to tell these apart — only the Access authentication logs can (see Q5).

---

## 2. How does Access match Include → Emails addresses? Does it normalize Gmail dots/plus-addressing?

**Direct answer: not documented in Access's own policy docs.** The policy-management and policies-FAQ pages describe *how to build and test* email-selector rules but do not specify the string-comparison algorithm (case sensitivity, whitespace trimming, or Gmail-style dot/plus normalization). This is a documentation gap, not a confirmed absence of the behavior.

The one place Cloudflare *does* document address normalization is a different product — Gateway/DLP email-address matching (used in Egress and DNS Resolver policies, not Access identity policies):

> "By default, Egress policy and Resolver policy behaviors match exact address only... To force Gateway to match all email address variants, go to Traffic policies > Traffic settings > Policy settings and turn on **Match extended email addresses**."

Source: [Identity-based policies · Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/traffic-policies/identity-selectors) (via search; this setting lives under Gateway traffic policies, not Access application policies)

That setting does not apply to Access Include/Require/Exclude email selectors — there is no documented equivalent toggle for Access policies. **Conclusion: Access's Include → Emails matching is undocumented on the normalization question.** Given Access policy examples in the docs consistently show lowercase addresses, case-insensitive exact-string matching is the most plausible default, but this is inference, not a documented guarantee.

**Community-reported (undocumented / anecdotal only):** the Cloudflare Community forum has multiple open threads describing OTP non-delivery to specific, allow-listed addresses with no root cause ever confirmed by Cloudflare staff in the threads found:
- ["Can't do one-time pin with certain emails"](https://community.cloudflare.com/t/cant-do-one-time-pin-with-certain-emails/812989) — 3 addresses in one policy, 2 work, 1 (an M365 address) doesn't; user gets "Invalid login session" instead of no-code-at-all.
- ["One Time Pin not being sent to Gmail"](https://community.cloudflare.com/t/one-time-pin-not-being-sent-to-gmail/767531)
- A search-engine-surfaced claim (not independently verified against the primary thread) that adding more than one address to a policy's **Require** field (not Include) has caused OTP non-delivery in the past — this is a different selector type than the one used here, and could not be verified as still-reproducible or current.

**Bottom line for Q2:** Cloudflare does not document Gmail dot/plus normalization for Access email selectors one way or the other. A mismatch caused by a stray space, a differing case, or (less likely, since Gmail itself normalizes dots/plus before delivery, so the *typed* address a user enters is usually already normalized by their own habit) a dot/plus variant is **plausible but not confirmed or denied by primary sources** — it remains an open, testable hypothesis rather than a documented fact.

---

## 3. Exact-hostname app vs. wildcard app: which governs, and could the wrong app be evaluated?

**Direct answer: the more specific (exact) hostname application governs**, per Cloudflare's general "most specific wins" precedence principle, which the docs apply consistently across products (TLS certificate/hostname priority, Access application paths, and — per search-engine-surfaced doc language — self-hosted Access applications).

> "Access is configured such that the most specific hostname definition wins (e.g., `test.example.com` will take precedence over `*.example.com`)."

Source: [Publish a self-hosted application to the Internet · Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) (this exact sentence could not be re-confirmed verbatim via direct WebFetch of the live page — the fetched copy of that page did not include this text — so treat this quote as **search-engine-surfaced and only partially verified**; the underlying page does confirm wildcards are used to "protect multiple parts of an application that share a root path" but does not explicitly discuss cross-application hostname collision in the copy retrieved).

What *is* directly confirmed from primary docs, on a related axis (path specificity within Access application-path rules):

> "If no separate, specific rule is set for a path, it will inherit any rules set for a broader path... the more specific rule takes precedence" (e.g. `dashboard.com/eng/exec` over `dashboard.com/eng`).

Source: [Application paths · Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)

**Could keloshell.pages.dev be evaluated against the wrong app?** If both an exact-hostname app for `keloshell.pages.dev` and a wildcard app for `*.keloshell.pages.dev` exist, the documented "most specific wins" principle says the exact-hostname app's policy governs a login to the bare hostname — *not* the wildcard app. So if the new user's email was added only to the wildcard app's policy (and not to the exact-hostname app's policy), that would fully explain silent non-delivery per Q1's finding: the exact app is the one actually evaluated, and if the new address isn't on *that* app's Include list, no code is ever sent — with zero visible error. **This is a strong, concrete, checkable hypothesis**: confirm which of the two apps (if both exist) has the new user's address in its own Include list, independent of which app the screenshot was taken from.

No official Cloudflare doc page found gives a single authoritative statement of "when two Access applications both match a hostname, application X wins" in as many words for *overlapping full applications* (as opposed to overlapping paths within one application) — this specific scenario is a **documentation gap**, filled only by the general cross-product "most specific wins" convention and the un-reverified self-hosted-app quote above.

---

## 4. Documented reasons Access would not send an OTP to a valid, policy-allowed address

**Documented reasons found:**
- **Not actually policy-allowed** (see Q1) — the single documented gate. If the address doesn't match an Include rule, no email is sent, with no user-visible difference.
- **Third-party mail scanning/allowlisting**: Cloudflare's docs recommend allowlisting the sending address so scanners don't quarantine or strip the message before it reaches the inbox:

> "If your organization uses a third-party email scanning service (for example, Mimecast or Barracuda), add `noreply@notify.cloudflare.com` to the email scanning allowlist."

Source: [One-time PIN login · Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

This is aimed at *organizational* mail gateways (Mimecast/Barracuda), not consumer Gmail — it's unlikely to be the mechanism for a personal Gmail account, but it establishes that Cloudflare's outbound OTP mail *can* be filtered upstream of the recipient's own spam folder.

**No documentation found** (searched policy docs, policies FAQ, one-time-pin doc, and Cloudflare's changelog/status surfaces reachable via search) describing:
- Per-address send throttling or rate limits for OTP mail
- Suppression/bounce-list blocking tied to a previous association of the address with a different Cloudflare account or identity
- IdP conflicts affecting OTP-specific delivery (IdP conflicts are documented for SSO login methods generally, not specifically as an OTP-suppression cause)

**Undocumented / community-reported only:** several open Cloudflare Community threads describe OTP silently failing for specific allow-listed addresses with no confirmed root cause posted by Cloudflare staff in the threads surfaced by search:
- [One-Time PIN - No Email](https://community.cloudflare.com/t/one-time-pin-no-email/303162)
- [Cloudflare Access One-Time PIN emails are no longer delivered](https://community.cloudflare.com/t/cloudflare-access-one-time-pin-emails-are-no-longer-delivered/937989)
- [Allowed email address is not receiving One-Time PIN in Zero Trust Access application](https://community.cloudflare.com/t/allowed-email-address-is-not-receiving-one-time-pin-in-zero-trust-access-applicatio/801603)
- [Zero Trust Access: OTP email never received](https://community.cloudflare.com/t/zero-trust-access-otp-email-never-received/889892)

None of these threads (as surfaced) confirm an account-history/suppression-list mechanism — they read as independent, unresolved reports, which itself is informative: there is no single well-known documented bug class matching "one specific valid address never gets OTP, others on the same policy work fine" beyond the generic advice to double-check the policy entry and check spam/allowlisting.

---

## 5. Current (2026) Zero Trust dashboard navigation

**(a) Verify the One-Time PIN login method is enabled**, per the OTP doc's own setup steps:

> 1. Go to **Zero Trust** > **Integrations** > **Identity providers**
> 2. Under **Your identity providers**, select **Add new identity provider**
> 3. Select **One-time PIN**

Source: [One-time PIN login · Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

(Note: this doc URL is a redirect target — the older path `cloudflare-one/identity/idp-integration/one-time-pin/` now resolves to `cloudflare-one/integrations/identity-providers/one-time-pin/`, confirming the dashboard's "Identity providers" section has been the maintained location as of the current docs. A search result also surfaced an alternate, seemingly older phrasing — "Settings > Authentication > Login methods" — from a third-party blog post, not from developers.cloudflare.com; since the instruction was to prefer current primary docs over blog posts/screenshots when they conflict, use the **Integrations > Identity providers** path as authoritative.)

**(b) View which Access application a specific login attempt was evaluated against**, per the authentication-logs doc:

> Navigate to **Zero Trust > Insights > Logs**, then select **Access authentication logs**.

Each log entry includes an **App** field ("Name of the Access application") and an **App domain** field ("URL of the Access application"), plus **User email**, **Connection** (IdP used), **Allow** (true/false), **Request time**, **IP address**, the app's unique identifier, event type, Ray ID, and country. Cloudflare also notes an "updated log viewer" with enhanced filtering is available, with a "classic view" fallback.

Source: [Access authentication logs · Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/insights/logs/dashboard-logs/access-authentication-logs/)

This log is the direct way to answer both open questions from Q1 and Q3 for this specific incident: filter by the new user's email (or by timestamp of their login attempt) and check (i) which **App** the attempt was evaluated against — confirming or ruling out the Q3 wrong-app hypothesis — and (ii) the **Allow** field — `false` here would mean the address never matched the policy (Q1's "not sent" branch) rather than a delivery failure.

---

## Bottom line for this case

Eduardo's confirmed test (owner's email, typed on the new user's device, delivers instantly) rules out device, network, browser, and — importantly — rules out organization-wide mail-scanner blocking of `noreply@notify.cloudflare.com` on that device/network path, since a code from that same sender reached that same device fine. That leaves the failure isolated to *how the new user's specific address is being evaluated or delivered*, and the docs point most strongly at two candidate mechanisms, in this order of likelihood:

1. **Policy/address-matching mismatch (Q1 + Q3), most supported by docs.** Cloudflare's docs are explicit and unambiguous that Access silently sends nothing if the address isn't matched by an Allow policy on the application actually being evaluated — and the login page's message is deliberately uninformative in that case. Combined with the documented "most specific hostname wins" precedence rule (Q3), if a wildcard app and an exact-hostname app for `keloshell.pages.dev` both exist, and the new user's email was only added to the app shown in the screenshot but not to whichever app is actually authoritative for the bare hostname, this fully and cleanly explains "policy screenshot shows the address, but no code ever arrives" with no gmail-side failure required at all.
2. **Gmail/mail-provider silently dropping the message.** Plausible but less supported — nothing in Cloudflare's docs suggests personal Gmail applies scanner-style blocking the way enterprise Mimecast/Barracuda gateways do, and the owner's account (also presumably Gmail, given no IdP context suggesting otherwise) receives mail fine from the same sender.
3. **Address-normalization mismatch (Q2)** — genuinely undocumented either way; can't be ruled in or out from primary sources.
4. **Account-history/suppression-list style blocking (Q4)** — no documented mechanism found; would remain speculative even if all else is ruled out.

**Single best next test:** Go to **Zero Trust > Insights > Logs > Access authentication logs**, filter/search for the new user's email address (or by the timestamp of their most recent login attempt), and read the **App** field and **Allow** field on that entry:
- **No log entry at all** for that email → the request likely isn't reaching Access as expected, or is being evaluated against a completely different app than assumed (re-examine DNS/app hostname config).
- **Log entry exists with Allow = false** → the address is not actually matching any policy on the app that was evaluated (check the **App** field to see *which* app, and compare its Include list against the one in the screenshot — they may not be the same app). This directly confirms hypothesis 1.
- **Log entry exists with Allow = true** → Access did attempt to send the code, which shifts the diagnosis fully onto Gmail-side delivery (hypothesis 2) — worth then trying `noreply@notify.cloudflare.com` allowlisting/searching promotions & category tabs on the new user's own Gmail account (not just spam), or testing a plus-addressed alias of the same Gmail account to see if it also fails.
