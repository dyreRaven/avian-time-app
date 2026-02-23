ALTER TABLE shipments ADD COLUMN country_of_origin TEXT;
ALTER TABLE shipment_items ADD COLUMN country_of_origin TEXT;
ALTER TABLE shipment_templates ADD COLUMN country_of_origin TEXT;
ALTER TABLE shipment_template_items ADD COLUMN country_of_origin TEXT;
