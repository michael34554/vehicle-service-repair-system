-- Additive migration for the AI Smart Workshop module.
-- Extends the existing diagnosis records instead of creating a second prediction table.

ALTER TABLE ai_diagnoses
  ADD COLUMN affected_component VARCHAR(64) NULL,
  ADD COLUMN model_version VARCHAR(64) NULL,
  ADD COLUMN possible_causes_json LONGTEXT NULL,
  ADD COLUMN recommendations_json LONGTEXT NULL,
  ADD COLUMN input_context_json LONGTEXT NULL,
  ADD KEY ai_diagnoses_workshop_component_idx (workshop_id, affected_component, created_at);

CREATE TABLE IF NOT EXISTS vehicle_component_inspections (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  vehicle_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191),
  component_name VARCHAR(64) NOT NULL,
  condition_status VARCHAR(32) NOT NULL,
  inspection_notes TEXT,
  inspected_by_user_id VARCHAR(191) NOT NULL,
  inspected_by_name VARCHAR(255) NOT NULL,
  inspection_date VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY vehicle_component_inspections_vehicle_component_idx (workshop_id, vehicle_id, component_name, inspection_date),
  KEY vehicle_component_inspections_job_idx (workshop_id, job_id),
  CONSTRAINT vehicle_component_inspections_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT vehicle_component_inspections_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE CASCADE,
  CONSTRAINT vehicle_component_inspections_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_component_inspections_user_fk FOREIGN KEY (inspected_by_user_id, workshop_id) REFERENCES users(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
