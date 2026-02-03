-- Rename legacy role labels to Super Admin for existing data.
UPDATE permission_templates
SET name = 'Super Admin'
WHERE name = 'Overlord';

UPDATE permission_templates
SET role_title = 'Super Admin'
WHERE role_title = 'Overlord';

UPDATE employees
SET role_title = 'Super Admin'
WHERE role_title = 'Overlord';
