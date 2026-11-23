-- Audit trail for adaptive-learning runs.
CREATE TABLE IF NOT EXISTS ai_training_runs (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NULL,
  initiated_by_user_id VARCHAR(191) NULL,
  initiated_by_name VARCHAR(255),
  dataset_path VARCHAR(500) NOT NULL,
  status VARCHAR(32) NOT NULL,
  model_version VARCHAR(191) NULL,
  provenance_json LONGTEXT NULL,
  metrics_json LONGTEXT NULL,
  error_text TEXT NULL,
  created_at VARCHAR(40) NOT NULL,
  finished_at VARCHAR(40) NULL,
  KEY ai_training_runs_workshop_idx (workshop_id, created_at),
  CONSTRAINT ai_training_runs_initiator_fk FOREIGN KEY (initiated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Explicit bay registry so Workshop Floor Live no longer invents bays from job text.
CREATE TABLE IF NOT EXISTS workshop_bays (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  code VARCHAR(80) NOT NULL,
  label VARCHAR(160),
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY workshop_bays_workshop_code_uq (workshop_id, code),
  CONSTRAINT workshop_bays_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO workshop_bays (id, workshop_id, code, label, created_at, updated_at)
SELECT CONCAT('bay-', LOWER(REPLACE(UUID(), '-', ''))), workshop_id,
       LEFT(TRIM(bay), 80), MAX(TRIM(bay)), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM jobs
WHERE bay IS NOT NULL AND TRIM(bay) <> ''
GROUP BY workshop_id, LEFT(TRIM(bay), 80);

-- Compatibility and advisory recommendation records.
CREATE TABLE IF NOT EXISTS part_compatibility (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  part_id VARCHAR(191) NOT NULL,
  catalogue_model_id VARCHAR(191) NOT NULL,
  component_key VARCHAR(64) NULL,
  verified_by_name VARCHAR(255) NULL,
  source VARCHAR(500) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY part_compatibility_uq (part_id, catalogue_model_id, component_key),
  KEY part_compatibility_model_idx (catalogue_model_id, component_key),
  CONSTRAINT part_compatibility_part_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE,
  CONSTRAINT part_compatibility_model_fk FOREIGN KEY (catalogue_model_id) REFERENCES vehicle_models(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS part_recommendations (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  vehicle_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191) NULL,
  diagnosis_id VARCHAR(191) NULL,
  part_id VARCHAR(191) NOT NULL,
  score DECIMAL(6, 3) NOT NULL,
  reason_json LONGTEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'advisory',
  feedback VARCHAR(32) NULL,
  created_by_user_id VARCHAR(191) NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY part_recommendations_context_idx (workshop_id, vehicle_id, created_at),
  CONSTRAINT part_recommendations_part_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE,
  CONSTRAINT part_recommendations_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Digital twin state, telemetry and consent.
CREATE TABLE IF NOT EXISTS vehicle_data_consents (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  vehicle_id VARCHAR(191) NOT NULL,
  customer_id VARCHAR(191) NOT NULL,
  scope VARCHAR(64) NOT NULL,
  is_granted TINYINT(1) NOT NULL,
  granted_at VARCHAR(40) NULL,
  revoked_at VARCHAR(40) NULL,
  recorded_by_user_id VARCHAR(191) NULL,
  recorded_by_name VARCHAR(255) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY vehicle_data_consents_uq (vehicle_id, scope),
  CONSTRAINT vehicle_data_consents_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_telemetry_events (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  vehicle_id VARCHAR(191) NOT NULL,
  source VARCHAR(80) NOT NULL,
  signal_key VARCHAR(120) NOT NULL,
  signal_value_json LONGTEXT NOT NULL,
  observed_at VARCHAR(40) NOT NULL,
  received_at VARCHAR(40) NOT NULL,
  provenance VARCHAR(120) NOT NULL,
  KEY vehicle_telemetry_vehicle_time_idx (vehicle_id, observed_at),
  CONSTRAINT vehicle_telemetry_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_twin_states (
  vehicle_id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  odometer_km INT NULL,
  state_json LONGTEXT NOT NULL,
  source VARCHAR(80) NOT NULL,
  last_signal_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT vehicle_twin_states_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_vin_decodes (
  vin VARCHAR(17) NOT NULL PRIMARY KEY,
  payload_json LONGTEXT NOT NULL,
  provider VARCHAR(120) NOT NULL,
  decoded_at VARCHAR(40) NOT NULL,
  KEY vehicle_vin_decodes_provider_idx (provider, decoded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Visual fault localization evidence and annotations.
CREATE TABLE IF NOT EXISTS vehicle_fault_images (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  vehicle_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191) NULL,
  diagnosis_id VARCHAR(191) NULL,
  image_url VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(120) NULL,
  source VARCHAR(120) NOT NULL,
  captured_at VARCHAR(40) NULL,
  uploaded_by_user_id VARCHAR(191) NULL,
  created_at VARCHAR(40) NOT NULL,
  CONSTRAINT vehicle_fault_images_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_image_annotations (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  image_id VARCHAR(191) NOT NULL,
  component_key VARCHAR(64) NOT NULL,
  bbox_json LONGTEXT NOT NULL,
  note TEXT NULL,
  annotated_by_user_id VARCHAR(191) NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY vehicle_image_annotations_image_idx (image_id, component_key),
  CONSTRAINT vehicle_image_annotations_image_fk FOREIGN KEY (image_id) REFERENCES vehicle_fault_images(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicle_visual_localizations (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  vehicle_id VARCHAR(191) NOT NULL,
  image_id VARCHAR(191) NOT NULL,
  component_key VARCHAR(64) NOT NULL,
  confidence DECIMAL(6, 3) NULL,
  projection_json LONGTEXT NOT NULL,
  provider VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'proposed',
  reviewed_by_user_id VARCHAR(191) NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY vehicle_visual_localizations_vehicle_idx (vehicle_id, created_at),
  CONSTRAINT vehicle_visual_localizations_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE CASCADE,
  CONSTRAINT vehicle_visual_localizations_image_fk FOREIGN KEY (image_id) REFERENCES vehicle_fault_images(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Validated node-map approvals for exact 3D assets.
CREATE TABLE IF NOT EXISTS vehicle_component_node_maps (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  asset_key VARCHAR(191) NOT NULL,
  component_key VARCHAR(64) NOT NULL,
  node_name VARCHAR(191) NOT NULL,
  geometry_source VARCHAR(32) NOT NULL DEFAULT 'exact',
  confidence DECIMAL(5, 3) NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'proposed',
  verified_by_name VARCHAR(255) NULL,
  notes TEXT NULL,
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY vehicle_component_node_maps_uq (asset_key, component_key, node_name),
  KEY vehicle_component_node_maps_asset_idx (asset_key, verification_status),
  CONSTRAINT vehicle_component_node_maps_asset_fk FOREIGN KEY (asset_key) REFERENCES vehicle_3d_assets(asset_key) ON DELETE CASCADE,
  CONSTRAINT vehicle_component_node_maps_component_fk FOREIGN KEY (component_key) REFERENCES vehicle_components(component_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
