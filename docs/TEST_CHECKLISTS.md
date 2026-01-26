# Test Checklists
Generated: 2026-01-22

These checklists cover P0/P1 items only. Use them after fixes to validate behavior.

## P0 - Blockers

### T-002 Upload security hardening
- Attempt to upload a .html or .js file renamed as .png/.pdf.
- Expect a 4xx JSON error (not 500 HTML).
- Upload a valid PNG/PDF and confirm success.
- Download the file and verify Content-Disposition is attachment (not inline) unless explicitly safe.

### T-003 Shipment payment docs gating
- Create a user with see_shipments but without view_payroll.
- Upload a payment doc and a non-payment doc on the same shipment.
- Verify non-payment doc list/download works for see_shipments user.
- Verify payment doc list/download returns 403 for the same user.

### T-004 Kiosk admin GET device auth fails
- Enroll a kiosk and capture device_id/device_secret.
- Perform GET /api/kiosks/:id/sessions with admin_id in query using device headers.
- Perform GET /api/kiosks/:id/open-punches with admin_id in query using device headers.
- Verify both return 200 with expected payloads.

### T-005 Production cookie settings are insecure
- Run with NODE_ENV=production and configured COOKIE_SECURE/COOKIE_SAMESITE.
- Login and inspect Set-Cookie header.
- Verify Secure is present and SameSite matches intended policy.

### T-006 High-severity dependency vulnerabilities
- Run `npm audit --audit-level=high`.
- Verify no high-severity vulnerabilities are reported.

## P1 - Reliability and offline

### T-007 PWA/offline caching broken
- Confirm required icons exist and manifest points to valid files.
- Load the app once online and verify service worker install succeeds.
- Simulate offline and verify kiosk UI loads without errors.

### T-008 Retention job scheduler overflow
- Start the server and confirm retention jobs schedule without Timer overflow warnings.
- Verify each retention job runs at least once (log or observable effect).

### T-009 Restore tooling missing
- Run the restore script against a recent backup.
- Verify DB contents and uploads are restored correctly.

### T-010 Scripts do not load .env
- With only .env present, run migrate/backup/bootstrap scripts.
- Verify required config is loaded and scripts complete successfully.
