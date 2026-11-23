-- Customer portal account mapping and persisted customer notifications.
-- This migration is additive and reuses the existing customer, vehicle and job identities.

ALTER TABLE customer_accounts ADD COLUMN username VARCHAR(191) NULL AFTER email;
ALTER TABLE customer_accounts ADD UNIQUE KEY customer_accounts_workshop_username_uq (workshop_id, username);

UPDATE customer_accounts ca
JOIN customers c ON c.id = ca.customer_id AND c.workshop_id = ca.workshop_id
SET ca.username = c.customer_code
WHERE ca.username IS NULL AND c.customer_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_notifications (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  customer_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191) NULL,
  event_key VARCHAR(191) NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(191) NOT NULL,
  message TEXT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL,
  read_at VARCHAR(40) NULL,
  UNIQUE KEY customer_notifications_event_uq (workshop_id, event_key),
  KEY customer_notifications_customer_idx (workshop_id, customer_id, created_at),
  CONSTRAINT customer_notifications_customer_fk FOREIGN KEY (customer_id, workshop_id) REFERENCES customers(id, workshop_id) ON DELETE CASCADE,
  CONSTRAINT customer_notifications_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO customer_notifications (
  id, workshop_id, customer_id, job_id, event_key, type, title, message, created_at
)
SELECT
  CONCAT('notify-status-', h.id),
  h.workshop_id,
  v.customer_id,
  j.id,
  CONCAT('status:', h.new_status, ':', h.changed_at, ':', h.id),
  CASE h.new_status
    WHEN 'Received' THEN 'job_received'
    WHEN 'Awaiting Inspection' THEN 'inspection_scheduled'
    WHEN 'Under Inspection' THEN 'inspection_started'
    WHEN 'Awaiting Customer Approval' THEN 'approval_required'
    WHEN 'Approved' THEN 'repair_approved'
    WHEN 'In Progress' THEN 'repair_in_progress'
    WHEN 'Awaiting Spare Parts' THEN 'awaiting_parts'
    WHEN 'Repair Completed' THEN 'repair_completed'
    WHEN 'Ready for Collection' THEN 'ready_for_collection'
    WHEN 'Collected' THEN 'collected'
    ELSE 'repair_update'
  END,
  CONCAT('Repair update: ', h.new_status),
  CASE h.new_status
    WHEN 'Received' THEN 'The workshop has booked in your vehicle and will begin the initial inspection.'
    WHEN 'Awaiting Inspection' THEN 'Your vehicle is queued for its initial inspection.'
    WHEN 'Under Inspection' THEN 'A technician is inspecting the problem you reported.'
    WHEN 'Awaiting Customer Approval' THEN 'The workshop has findings that require your approval before further work continues.'
    WHEN 'Approved' THEN 'The approved work has been added to the repair queue.'
    WHEN 'In Progress' THEN 'The approved repair work is now being carried out.'
    WHEN 'Awaiting Spare Parts' THEN 'The workshop is waiting for recorded spare parts before work can continue.'
    WHEN 'Repair Completed' THEN 'The recorded repair work is complete and final checks are underway.'
    WHEN 'Ready for Collection' THEN 'Your vehicle is ready. Please contact the workshop to arrange collection.'
    WHEN 'Collected' THEN 'Your vehicle has been marked as collected. Thank you for choosing NEXTGEN.'
    ELSE 'The workshop has recorded a new repair status for your vehicle.'
  END,
  h.changed_at
FROM repair_status_history h
JOIN jobs j ON j.id = h.job_id AND j.workshop_id = h.workshop_id
JOIN vehicles v ON v.id = j.vehicle_id AND v.workshop_id = j.workshop_id
WHERE h.new_status IS NOT NULL;
