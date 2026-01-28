-- Normalize shipment status label from "Cleared - Ready for Release" to "Cleared - Ready for Pickup"

UPDATE shipments
SET status = 'Cleared - Ready for Pickup'
WHERE status = 'Cleared - Ready for Release';

UPDATE shipment_status_history
SET old_status = 'Cleared - Ready for Pickup'
WHERE old_status = 'Cleared - Ready for Release';

UPDATE shipment_status_history
SET new_status = 'Cleared - Ready for Pickup'
WHERE new_status = 'Cleared - Ready for Release';

UPDATE shipment_notification_prefs
SET statuses_json = REPLACE(statuses_json, 'Cleared - Ready for Release', 'Cleared - Ready for Pickup')
WHERE statuses_json LIKE '%Cleared - Ready for Release%';

UPDATE notification_prefs
SET shipment_filters_json = REPLACE(shipment_filters_json, 'Cleared - Ready for Release', 'Cleared - Ready for Pickup')
WHERE shipment_filters_json LIKE '%Cleared - Ready for Release%';
