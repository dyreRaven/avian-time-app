# Data Model (Multi-Tenant)

## Conventions
- All tables include `org_id` unless noted.
- `created_at` and `updated_at` are ISO timestamps where needed.
- Foreign keys enforce tenant consistency.

## Identity and Access
- `orgs`: id, name, timezone, created_at.
- `org_settings`: org_id, key, value (e.g., clock_in_photo_required, kiosk_enrollment_code_hash, time_exception_rules, payroll_rules, notifications, branding).
- `users`: id, email, password_hash, created_at.
- `user_orgs`: id, user_id, org_id, employee_id, is_super_admin, created_at.
- `employees`: id, org_id, name, nickname, name_on_checks, rate, active, pin_hash,
  language, qbo_employee_id, qbo_vendor_id, worker_timekeeping,
  desktop_access, kiosk_admin_access, email, needs_qbo_sync,
  name_on_checks_updated_at, name_on_checks_qbo_updated_at,
  id_document_type, id_document_path, id_document_uploaded_at, id_document_uploaded_by, created_at.
- `employee_permissions`: employee_id, see_shipments, modify_time,
  view_time_reports, view_payroll, modify_pay_rates.
- `audit_log`: id, org_id, actor_user_id, actor_employee_id, action, entity_type,
  entity_id, before_json, after_json, note, created_at.

## Kiosks and Timekeeping
- `kiosks`: id, org_id, name, location, device_id, device_secret, project_id,
  last_seen_at, created_at.
- `kiosk_sessions` (timesheets): id, org_id, kiosk_id, device_id, project_id, date,
  created_by_employee_id, created_at, ended_at.
- `kiosk_foreman_days`: id, org_id, kiosk_id, foreman_employee_id, date, set_by_employee_id, created_at.
- `time_punches`: id, org_id, client_id, employee_id, project_id,
  clock_in_ts, clock_out_ts, clock_out_project_id,
  clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng,
  geo_distance_m, geo_violation,
  clock_in_photo_path, device_id, foreman_employee_id,
  auto_clock_out, auto_clock_out_reason,
  exception_resolved, exception_resolved_at, exception_resolved_by,
  exception_review_status, exception_review_note, exception_reviewed_by, exception_reviewed_at,
  employee_name_snapshot, project_name_snapshot,
  time_entry_id, created_at.
- `time_entries`: id, org_id, employee_id, project_id, start_date, end_date,
  start_time, end_time, hours, total_pay, foreman_employee_id,
  paid, paid_date,
  approval_status, approved_at, approved_by_employee_id, approval_note,
  resolved, resolved_status, resolved_note, resolved_at, resolved_by,
  verified, verified_at, verified_by_employee_id,
  employee_name_snapshot, project_name_snapshot.
- `time_exception_actions`: id, org_id, source_type (`punch` | `time_entry`), source_id,
  action (approve/modify/reject/create/verify/unverify/resolve/unresolve),
  actor_user_id, actor_employee_id, actor_name, note, changes_json (before/after), created_at.

## Projects
- `projects`: id, org_id, qbo_id, name, customer_name, project_timezone, geo_lat,
  geo_lng, geo_radius, active.

## Vendors
- `vendors`: id, org_id, qbo_id, name, pin_hash, active, is_freight_forwarder, uses_timekeeping.

## Payroll
- `payroll_settings`: id, org_id, bank_account_name, expense_account_name,
  default_memo, line_description_template.
- `payroll_runs`: id, org_id, start_date, end_date, created_by, created_at,
  total_hours, total_pay, status, include_overtime, idempotency_key, last_attempt_id, last_error.
- `payroll_checks`: id, org_id, payroll_run_id, employee_id, total_hours, total_pay,
  qbo_txn_id, paid, paid_date, check_number, voided_at, voided_reason.
- `payroll_run_attempts`: id, org_id, payroll_run_id, start_date, end_date,
  ok, fatal_error, created_at.
- `payroll_attempt_results`: id, org_id, attempt_id, employee_id, employee_name,
  total_hours, total_pay, ok, error, warning_codes, qbo_txn_id, created_at.
- `payroll_audit_log`: id, org_id, payroll_run_id, event_type, message,
  actor_employee_id, details_json, created_at.
- `payroll_lock`: id, org_id, locked_by, locked_at.
- `name_on_checks_queue`: id, org_id, employee_id, desired_name, payee_type,
  payee_id, last_error, attempts, created_at, updated_at.

## Shipments
- `shipments`: id, org_id, title, po_number, vendor_id, vendor_name,
  freight_forwarder, destination, project_id, project_name_snapshot,
  sku, quantity, total_price, price_per_item,
  expected_ship_date, expected_arrival_date, tracking_number, bol_number,
  storage_due_date, storage_daily_late_fee,
  picked_up_by, picked_up_date, picked_up_updated_by, picked_up_updated_at,
  vendor_paid, vendor_paid_amount, shipper_paid, shipper_paid_amount,
  customs_paid, customs_paid_amount, total_paid,
  items_verified, verified_by, verification_notes,
  website_url, notes, status, is_archived, archived_at, created_by, created_at, updated_at.
- `shipment_items`: id, org_id, shipment_id, description, sku, quantity, unit_price,
  line_total, vendor_name, verified, notes, verification_json, created_at. Storage location is stored per item in verification_json.storage_override.
- `shipment_status_history`: id, org_id, shipment_id, old_status, new_status, note, changed_at.
- `shipment_payments`: id, org_id, shipment_id, type, amount, currency,
  status, due_date, paid_date, invoice_number, notes, file_path, created_by, created_at.
- `shipment_timeline`: id, org_id, shipment_id, event_type, old_status, new_status,
  note, created_by, created_at.
- `shipment_documents`: id, org_id, shipment_id, title, category, doc_type, doc_label,
  file_path, uploaded_by, uploaded_at.
- `shipment_comments`: id, org_id, shipment_id, body, created_by, created_at, is_deleted, deleted_by, deleted_at.
- `shipment_templates`: id, org_id, name, title, vendor_id, freight_forwarder,
  destination, project_id, sku, quantity, total_price, price_per_item,
  website_url, notes, created_by, created_at.
- `shipment_template_items`: id, org_id, template_id, description, sku, quantity,
  unit_price, line_total, vendor_name, created_at.
- `shipment_notification_prefs`: id, org_id, user_id, employee_id,
  statuses_json, shipment_ids_json, project_ids_json, notify_time,
  remind_every_days, enabled, created_at, updated_at.

## QuickBooks
- `qbo_tokens`: id, org_id, access_token, refresh_token, expires_at, realm_id.

## Notifications
- `notifications`: id, org_id, user_id, type, title, body, data_json,
  read_at, created_at.
- `notification_prefs`: id, org_id, user_id, email_enabled, push_enabled,
  shipment_filters_json, payroll_filters_json, time_filters_json,
  remind_time, remind_every_days, clockout_enabled, clockout_time.
- `notification_deliveries`: id, org_id, notification_id, channel,
  status, error, created_at.
- `push_subscriptions`: id, org_id, user_id, endpoint, p256dh, auth,
  user_agent, created_at, revoked_at.

## System
- `session_store`: managed by express-session (sqlite).
- `file_uploads`: optional table if we need generic file metadata beyond shipments.
- `idempotency_keys`: id, org_id, scope, key, response_json, created_at.
