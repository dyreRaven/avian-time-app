# Section Toggle Rollout Tracker

This app can be packaged so only selected modules are available by setting `ENABLED_SECTIONS`.
Legend: `[x]` = complete, `[ ]` = pending.

- [x] Time/Clock-in + timesheets review readiness
- [x] Server route gating for time endpoints (`/api/time*`, `/api/time-exceptions`, `/api/time-punches`, `/api/time-entries`).
- [x] Server route gating on `requireSectionEnabled('payroll')` for `/api/sync/payroll-accounts` (prep for payroll phase).
- [x] Kiosk-admin: hide clock-time and shipment-time menu/nav items when section is disabled.
- [x] Kiosk-admin: load and apply section feature flags from `/api/kiosk/admin/account`.
- [x] Revisit desktop admin and worker kiosk views for any remaining time-only bleed-through.
- [x] Payroll module readiness: add payroll-only UI gating parity across all screens.
- [x] Payroll module readiness: verify payroll routes and admin pages honor payroll feature state. (routes in server.js now enforce payroll section gate)
- [x] Shipments module readiness: add shipments-only UI gating parity across all screens. (shipments section init in app.js now requires feature flag + permission)
- [x] Shipments module readiness: verify shipments routes and admin pages honor shipments feature state. (app.use('/api/shipments'...) and app.use('/api/reports/shipment'...) now guard the shipped routes; desktop init now also checks feature flag before shipping setup)
- [x] Container packaging: add Docker assets and `compose` config for environment-driven section flags.
- [x] Container packaging: validate `ENABLED_SECTIONS` defaults in shipped images. (compose defaults to `all`, DB paths set to `/app/data/*`)
