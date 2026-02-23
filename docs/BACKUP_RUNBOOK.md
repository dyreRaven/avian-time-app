# Backup Runbook (Production)

This runbook is for a professional, safer deployment of Avian Time.

## Recommended Mode

Use an **external scheduler** (cron/systemd/Kubernetes CronJob) and keep
in-process backups disabled.

Why:
- Backups run even if the web process restarts/crashes.
- Scheduling/alerting is centralized.
- Easier to audit and monitor.

## Environment

Set these in runtime `.env`:

```env
ENABLE_IN_PROCESS_BACKUPS=false
BACKUP_DIR=/absolute/path/outside/repo/backups
BACKUP_DAILY_RETENTION_COUNT=30
BACKUP_MONTHLY_RETENTION_COUNT=12
```

If you choose in-process scheduling instead:

```env
ENABLE_IN_PROCESS_BACKUPS=true
BACKUP_RUN_ON_STARTUP=true
BACKUP_INTERVAL_HOURS=24
```

## Scheduler Example (cron)

Run backup every 6 hours:

```cron
0 */6 * * * cd /path/to/avian-time-app && /usr/bin/node scripts/backup-once.js >> /var/log/avian-backup.log 2>&1
```

Run health check every hour (alert if latest daily backup is too old):

```cron
15 * * * * cd /path/to/avian-time-app && /usr/bin/node scripts/backup-health-check.js --max-age-hours 8 >> /var/log/avian-backup-health.log 2>&1
```

## Restore Drill (Monthly)

1. Stop app process.
2. Restore latest snapshot:

```bash
node scripts/restore.js --date YYYY-MM-DD --force
```

3. Start app process.
4. Verify login + key workflows.

## Professional Safety Checklist

- Keep `BACKUP_DIR` outside repo and include it in host-level backups.
- Restrict backup folder permissions to app/admin users only.
- Replicate backups offsite (different region/account).
- Keep one immutable/offline copy (ransomware resilience).
- Test restore monthly and document result.
