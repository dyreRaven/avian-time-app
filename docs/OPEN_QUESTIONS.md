# Open Questions

- [x] On signup/account-creation completion, prevent the dashboard flash before onboarding.
  - If onboarding is not completed and not explicitly skipped, users should land directly on the onboarding checklist/card instead of briefly rendering dashboard content.
  - Repro: signup success -> redirect to `/` currently shows dashboard first, then onboarding.
  - Additional repro noted: clicking `Create organization` from the onboarding card briefly renders dashboard content again before returning to onboarding.

- [x] On onboarding step "Connect QuickBooks", Intuit authorization sometimes stalls on the App Center loader and redirects back to onboarding without reaching credential entry/consent.
  - Repro: onboarding card -> Connect QuickBooks -> Intuit App Center loader spins -> returns to app onboarding checklist.
  - Follow-up: capture callback `qbo_reason`/`qbo_message` and validate OAuth state + callback redirect handling.

- [ ] Onboarding QuickBooks connection flow feels choppy and flashes onboarding too many times before resuming setup.
  - Repro: onboarding card -> Connect QuickBooks -> callback returns and UI briefly bounces through onboarding states before settling into QuickBooks setup.
  - Desired: a single smooth transition back into QuickBooks setup with no intermediate onboarding flashes.

- Clock-in section readiness tracking
  - [x] Fix kiosk tiny/long-shift confirmation flow so clock-out no longer auto-cancels in section 1.
  - [x] Handle missing timesheet for non-admin workers during clock-in without dead-end.
  - [x] Ensure offline queue drops unrecoverable punch errors instead of re-queuing indefinitely.
  - [x] Normalize clock-in admin-capability contract for kiosk employee payloads.
  - [x] Improve clock-in photo-required messaging when camera is unavailable and keep flow explicit.
  - [x] Preserve server error payload (`active_project_id`) in kiosk fetch errors so clock-in can correctly handle active-project changes during punches.
