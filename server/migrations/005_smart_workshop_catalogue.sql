-- Additive migration for the NEXTGEN AI Smart Workshop catalogue and fault knowledge base.
-- Catalogue data is global reference data: it is not duplicated per workshop.
-- Registered vehicles, customers, repair jobs and diagnoses remain the workshop source of truth.

CREATE TABLE IF NOT EXISTS vehicle_manufacturers (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  country VARCHAR(80),
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY vehicle_manufacturers_name_uq (name),
  KEY vehicle_manufacturers_active_idx (is_active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_3d_assets (
  asset_key VARCHAR(191) NOT NULL PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  model_path VARCHAR(500) NOT NULL,
  license VARCHAR(120) NOT NULL,
  license_url VARCHAR(500),
  source VARCHAR(500) NOT NULL,
  is_generic TINYINT(1) NOT NULL DEFAULT 1,
  is_exact_match TINYINT(1) NOT NULL DEFAULT 0,
  node_map_json LONGTEXT,
  notes TEXT,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_models (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  manufacturer_id VARCHAR(191) NOT NULL,
  name VARCHAR(120) NOT NULL,
  body_style VARCHAR(80),
  year_from SMALLINT,
  year_to SMALLINT,
  image_path VARCHAR(500),
  asset_key VARCHAR(191),
  asset_status VARCHAR(32) NOT NULL DEFAULT 'representative',
  specification_note TEXT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY vehicle_models_manufacturer_name_uq (manufacturer_id, name),
  KEY vehicle_models_manufacturer_idx (manufacturer_id, is_active, name),
  KEY vehicle_models_asset_idx (asset_key),
  CONSTRAINT vehicle_models_manufacturer_fk FOREIGN KEY (manufacturer_id) REFERENCES vehicle_manufacturers(id) ON DELETE RESTRICT,
  CONSTRAINT vehicle_models_asset_fk FOREIGN KEY (asset_key) REFERENCES vehicle_3d_assets(asset_key) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_specifications (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  model_id VARCHAR(191) NOT NULL,
  year_from SMALLINT,
  year_to SMALLINT,
  engine_type VARCHAR(120),
  engine_capacity_cc INT,
  fuel_type VARCHAR(64),
  transmission_type VARCHAR(80),
  drive_type VARCHAR(64),
  technical_specs_json LONGTEXT,
  data_source VARCHAR(500),
  verification_status VARCHAR(32) NOT NULL DEFAULT 'not_recorded',
  verified_by_name VARCHAR(255),
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  KEY vehicle_specifications_model_idx (model_id, year_from, year_to),
  CONSTRAINT vehicle_specifications_model_fk FOREIGN KEY (model_id) REFERENCES vehicle_models(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mechanical_systems (
  system_key VARCHAR(64) NOT NULL PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_components (
  component_key VARCHAR(64) NOT NULL PRIMARY KEY,
  system_key VARCHAR(64) NOT NULL,
  label VARCHAR(120) NOT NULL,
  description TEXT,
  model_node_hint VARCHAR(191),
  is_exact_node TINYINT(1) NOT NULL DEFAULT 0,
  inspection_focus_json LONGTEXT,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT vehicle_components_system_fk FOREIGN KEY (system_key) REFERENCES mechanical_systems(system_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_model_systems (
  model_id VARCHAR(191) NOT NULL,
  system_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (model_id, system_key),
  CONSTRAINT vehicle_model_systems_model_fk FOREIGN KEY (model_id) REFERENCES vehicle_models(id) ON DELETE CASCADE,
  CONSTRAINT vehicle_model_systems_system_fk FOREIGN KEY (system_key) REFERENCES mechanical_systems(system_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_fault_records (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  manufacturer_id VARCHAR(191),
  model_id VARCHAR(191),
  year_from SMALLINT,
  year_to SMALLINT,
  engine_type VARCHAR(120),
  system_key VARCHAR(64) NOT NULL,
  component_key VARCHAR(64),
  fault_name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  symptoms_json LONGTEXT NOT NULL,
  causes_json LONGTEXT NOT NULL,
  diagnostic_procedures_json LONGTEXT NOT NULL,
  dtc_codes_json LONGTEXT,
  recommended_inspection TEXT,
  corrective_action TEXT,
  dataset_source VARCHAR(500) NOT NULL,
  provenance VARCHAR(32) NOT NULL,
  fidelity_note TEXT,
  severity VARCHAR(32),
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id VARCHAR(191),
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  KEY vehicle_fault_records_scope_idx (manufacturer_id, model_id, is_active),
  KEY vehicle_fault_records_system_component_idx (system_key, component_key, is_active),
  KEY vehicle_fault_records_fault_name_idx (fault_name),
  CONSTRAINT vehicle_fault_records_manufacturer_fk FOREIGN KEY (manufacturer_id) REFERENCES vehicle_manufacturers(id) ON DELETE SET NULL,
  CONSTRAINT vehicle_fault_records_model_fk FOREIGN KEY (model_id) REFERENCES vehicle_models(id) ON DELETE SET NULL,
  CONSTRAINT vehicle_fault_records_component_fk FOREIGN KEY (component_key) REFERENCES vehicle_components(component_key) ON DELETE SET NULL,
  CONSTRAINT vehicle_fault_records_system_fk FOREIGN KEY (system_key) REFERENCES mechanical_systems(system_key) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extend registered vehicles with catalogue linkage and optional, explicitly sourced specifications.
ALTER TABLE vehicles
  ADD COLUMN catalogue_model_id VARCHAR(191) NULL,
  ADD COLUMN engine_type VARCHAR(120) NULL,
  ADD COLUMN engine_capacity_cc INT NULL,
  ADD COLUMN fuel_type VARCHAR(64) NULL,
  ADD COLUMN transmission_type VARCHAR(80) NULL,
  ADD COLUMN drive_type VARCHAR(64) NULL,
  ADD KEY vehicles_catalogue_model_idx (workshop_id, catalogue_model_id),
  ADD CONSTRAINT vehicles_catalogue_model_fk FOREIGN KEY (catalogue_model_id) REFERENCES vehicle_models(id) ON DELETE SET NULL;

-- Link predictions to the knowledge-base record that informed them, without replacing ai_diagnoses.
ALTER TABLE ai_diagnoses
  ADD COLUMN fault_record_id VARCHAR(191) NULL,
  ADD COLUMN catalogue_model_id VARCHAR(191) NULL,
  ADD KEY ai_diagnoses_fault_record_idx (fault_record_id),
  ADD CONSTRAINT ai_diagnoses_fault_record_fk FOREIGN KEY (fault_record_id) REFERENCES vehicle_fault_records(id) ON DELETE SET NULL,
  ADD CONSTRAINT ai_diagnoses_catalogue_model_fk FOREIGN KEY (catalogue_model_id) REFERENCES vehicle_models(id) ON DELETE SET NULL;
