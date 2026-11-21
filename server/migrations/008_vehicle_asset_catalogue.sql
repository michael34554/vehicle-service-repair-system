-- Additive migration for dynamic, model-specific 3D vehicle asset catalogue metadata.
-- Existing workshop data, diagnoses and assets are preserved. The bundled representative
-- Ferrari asset stays available only as an explicitly labelled generic illustration.

ALTER TABLE vehicle_3d_assets
  ADD COLUMN manufacturer_name VARCHAR(120) NULL,
  ADD COLUMN model_name VARCHAR(120) NULL,
  ADD COLUMN year_from SMALLINT NULL,
  ADD COLUMN year_to SMALLINT NULL,
  ADD COLUMN variant VARCHAR(120) NULL,
  ADD COLUMN shadow_path VARCHAR(500) NULL,
  ADD COLUMN available_view_modes_json LONGTEXT NULL,
  ADD COLUMN inspectable_components_json LONGTEXT NULL,
  ADD COLUMN availability_status VARCHAR(32) NOT NULL DEFAULT 'missing',
  ADD COLUMN is_catalogue_selectable TINYINT(1) NOT NULL DEFAULT 1,
  ADD KEY vehicle_3d_assets_manufacturer_model_idx (manufacturer_name, model_name),
  ADD KEY vehicle_3d_assets_status_idx (availability_status, is_catalogue_selectable);

ALTER TABLE vehicle_models
  ADD COLUMN supported_years_json LONGTEXT NULL,
  ADD COLUMN variants_json LONGTEXT NULL,
  ADD COLUMN engines_json LONGTEXT NULL,
  ADD KEY vehicle_models_years_idx (year_from, year_to);
