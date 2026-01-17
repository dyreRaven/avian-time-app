## Security Notes

- **CSRF**: For any cross-origin client, read the `X-CSRF-Token` response header from a safe request (GET/HEAD/OPTIONS) and send it back in `X-CSRF-Token` on all state-changing requests (POST/PUT/PATCH/DELETE). Same-origin browser use should work without changes.
- **Sessions & tokens**: Sessions and QuickBooks tokens are encrypted at rest using `SESSION_ENCRYPTION_KEY` (or `SESSION_SECRET` fallback). Keep these secrets private in `.env`.
- **APNs key**: Keep the `.p8` file outside the repo (e.g., `/Users/dyreraven/secrets/...`) and set `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_BUNDLE_ID` in `.env`.
- **Git history**: History was rewritten to remove keys/DBs. If others consume this repo, they must re-clone or hard-reset to the current `main`.
- **Admin gating**: UI routes are gated by access toggles (desktop_access, kiosk_admin_access); API routes are gated by permissions listed in `rebuild/architecture/API_CONTRACTS.md`.
