# Section Profiles (Shipping Partial Feature Sets)

You can ship one app image and expose only the modules you want in a deployment.

This is handled by:
- `ENABLED_SECTIONS` in environment config (`clock`, `payroll`, `shipments`, or `all`)
- Runtime nav + API route gating already implemented in app and server

Use the same container image and vary only deployment config.

## Canonical Profiles

1) Clock-in only
- `ENABLED_SECTIONS=clock`

2) Clock-in + Payroll
- `ENABLED_SECTIONS=clock,payroll`

3) Clock-in + Shipments
- `ENABLED_SECTIONS=clock,shipments`

## Example `.env` profiles

Create one of these for your target release. Fill secrets once in each file (or keep them in your base `.env.docker.example`-based file and only override the section value).

### `.env.clock-only`
```env
# Base deployment values (from .env.docker.example)
NODE_ENV=production
PORT=3000
HOST_PORT=3000
DB_PATH=/app/data/rebuild.db
SESSION_DB_PATH=/app/data/sessions.db

# Section profile
ENABLED_SECTIONS=clock
```

### `.env.clock-payroll`
```env
NODE_ENV=production
PORT=3000
HOST_PORT=3000
DB_PATH=/app/data/rebuild.db
SESSION_DB_PATH=/app/data/sessions.db

ENABLED_SECTIONS=clock,payroll
```

### `.env.clock-shipments`
```env
NODE_ENV=production
PORT=3000
HOST_PORT=3000
DB_PATH=/app/data/rebuild.db
SESSION_DB_PATH=/app/data/sessions.db

ENABLED_SECTIONS=clock,shipments
```

## Compose snippet examples

Run with explicit env files:
```bash
docker compose --env-file .env.clock-only up -d
docker compose --env-file .env.clock-payroll up -d
docker compose --env-file .env.clock-shipments up -d
```

Or keep one `.env` and override temporarily:
```bash
ENABLED_SECTIONS=clock,payroll docker compose up -d
ENABLED_SECTIONS=clock,shipments docker compose up -d
ENABLED_SECTIONS=clock docker compose up -d
```

Per-service override (useful in CI/deploy scripts):
```yaml
services:
  avian-time-app:
    environment:
      ENABLED_SECTIONS: clock,payroll
```

## Recommended release workflow

1. Build once:
   - `docker compose build`
2. Start selected profile by env file or `ENABLED_SECTIONS`.
3. Verify feature behavior:
   - `npm run check:section-toggle`
