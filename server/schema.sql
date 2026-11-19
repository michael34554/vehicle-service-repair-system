

CREATE TABLE IF NOT EXISTS workshops (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  created_at VARCHAR(40) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workshop_settings (
  workshop_id VARCHAR(191) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  phone VARCHAR(100),
  email VARCHAR(254),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  CONSTRAINT workshop_settings_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  password_salt VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'owner',
  created_at VARCHAR(40) NOT NULL,
  UNIQUE KEY users_id_workshop_uq (id, workshop_id),
  UNIQUE KEY users_email_uq (email),
  CONSTRAINT users_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  workshop_id VARCHAR(191) NOT NULL,
  token_hash VARCHAR(191) NOT NULL UNIQUE,
  expires_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY sessions_expiry_idx (expires_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id, workshop_id) REFERENCES users(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jwt_sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  workshop_id VARCHAR(191) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  revoked_at VARCHAR(40),
  CONSTRAINT jwt_sessions_user_fk FOREIGN KEY (user_id, workshop_id) REFERENCES users(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jwt_tokens (
  jti VARCHAR(191) NOT NULL PRIMARY KEY,
  session_id VARCHAR(191) NOT NULL,
  token_type VARCHAR(16) NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  revoked_at VARCHAR(40),
  replaced_by_jti VARCHAR(191),
  KEY jwt_tokens_session_type_idx (session_id, token_type),
  KEY jwt_tokens_expiry_idx (expires_at),
  CONSTRAINT jwt_tokens_session_fk FOREIGN KEY (session_id) REFERENCES jwt_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  phone VARCHAR(100),
  email VARCHAR(254),
  notes TEXT,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  customer_code VARCHAR(191),
  address TEXT,
  gender VARCHAR(32),
  phone_normalized VARCHAR(100),
  email_normalized VARCHAR(254) GENERATED ALWAYS AS (NULLIF(LOWER(TRIM(email)), '')) STORED,
  phone_normalized_key VARCHAR(100) GENERATED ALWAYS AS (NULLIF(phone_normalized, '')) STORED,
  UNIQUE KEY customers_id_workshop_uq (id, workshop_id),
  UNIQUE KEY customers_workshop_code_uq (workshop_id, customer_code),
  UNIQUE KEY customers_workshop_phone_normalized_uq (workshop_id, phone_normalized_key),
  UNIQUE KEY customers_workshop_email_normalized_uq (workshop_id, email_normalized),
  KEY customers_workshop_idx (workshop_id),
  KEY customers_workshop_name_idx (workshop_id, display_name),
  CONSTRAINT customers_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vehicles (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  customer_id VARCHAR(191),
  plate VARCHAR(100) NOT NULL,
  vin VARCHAR(100),
  make VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  model_year INT NOT NULL,
  color VARCHAR(80),
  mileage INT NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  vehicle_code VARCHAR(191),
  engine_number VARCHAR(100),
  registration_normalized VARCHAR(100),
  registration_normalized_key VARCHAR(100) GENERATED ALWAYS AS (NULLIF(registration_normalized, '')) STORED,
  UNIQUE KEY vehicles_id_workshop_uq (id, workshop_id),
  UNIQUE KEY vehicles_workshop_plate_uq (workshop_id, plate),
  UNIQUE KEY vehicles_workshop_code_uq (workshop_id, vehicle_code),
  UNIQUE KEY vehicles_workshop_registration_uq (workshop_id, registration_normalized_key),
  KEY vehicles_workshop_idx (workshop_id),
  KEY vehicles_workshop_customer_created_idx (workshop_id, customer_id, created_at),
  CONSTRAINT vehicles_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT vehicles_customer_fk FOREIGN KEY (customer_id, workshop_id) REFERENCES customers(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  vehicle_id VARCHAR(191) NOT NULL,
  job_no VARCHAR(191) NOT NULL,
  service_type VARCHAR(255) NOT NULL,
  issue_description TEXT,
  status VARCHAR(64) NOT NULL DEFAULT 'Pending',
  priority VARCHAR(32) NOT NULL DEFAULT 'standard',
  bay VARCHAR(80),
  assigned_technician VARCHAR(255),
  estimated_amount_cents BIGINT NOT NULL DEFAULT 0,
  final_amount_cents BIGINT,
  promised_at VARCHAR(40),
  notes TEXT,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  tracking_number VARCHAR(191),
  repair_status VARCHAR(80),
  repair_priority VARCHAR(32),
  inspection_notes TEXT,
  estimated_labour_cost_cents BIGINT NOT NULL DEFAULT 0,
  estimated_parts_cost_cents BIGINT NOT NULL DEFAULT 0,
  estimated_total_cost_cents BIGINT NOT NULL DEFAULT 0,
  created_by VARCHAR(191),
  UNIQUE KEY jobs_id_workshop_uq (id, workshop_id),
  UNIQUE KEY jobs_workshop_job_no_uq (workshop_id, job_no),
  UNIQUE KEY jobs_workshop_tracking_number_uq (workshop_id, tracking_number),
  KEY jobs_workshop_status_idx (workshop_id, status),
  KEY jobs_workshop_vehicle_idx (workshop_id, vehicle_id),
  KEY jobs_workshop_repair_status_idx (workshop_id, repair_status, created_at),
  KEY jobs_workshop_priority_idx (workshop_id, repair_priority, created_at),
  KEY jobs_workshop_mechanic_idx (workshop_id, assigned_technician, created_at),
  CONSTRAINT jobs_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT jobs_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(100),
  email VARCHAR(254),
  address TEXT,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY suppliers_id_workshop_uq (id, workshop_id),
  UNIQUE KEY suppliers_workshop_name_uq (workshop_id, name),
  KEY suppliers_workshop_name_idx (workshop_id, name),
  CONSTRAINT suppliers_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  sku VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 0,
  unit_cost_cents BIGINT NOT NULL DEFAULT 0,
  supplier VARCHAR(255),
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'General',
  description TEXT,
  selling_price_cents BIGINT NOT NULL DEFAULT 0,
  supplier_id VARCHAR(191),
  UNIQUE KEY parts_id_workshop_uq (id, workshop_id),
  UNIQUE KEY parts_workshop_sku_uq (workshop_id, sku),
  KEY parts_workshop_idx (workshop_id),
  CONSTRAINT parts_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT parts_supplier_fk FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_parts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191) NOT NULL,
  part_id VARCHAR(191) NOT NULL,
  quantity INT NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY job_parts_job_part_uq (job_id, part_id),
  CONSTRAINT job_parts_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE RESTRICT,
  CONSTRAINT job_parts_part_fk FOREIGN KEY (part_id, workshop_id) REFERENCES parts(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191),
  invoice_number VARCHAR(191) NOT NULL,
  amount_cents BIGINT NOT NULL,
  payment_method VARCHAR(64) NOT NULL DEFAULT 'Cash',
  status VARCHAR(32) NOT NULL DEFAULT 'Pending',
  paid_at VARCHAR(40),
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY payments_workshop_invoice_uq (workshop_id, invoice_number),
  KEY payments_workshop_idx (workshop_id),
  CONSTRAINT payments_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT payments_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repair_status_history (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191) NOT NULL,
  previous_status VARCHAR(80),
  new_status VARCHAR(80) NOT NULL,
  note TEXT,
  changed_by_user_id VARCHAR(191),
  changed_by_name VARCHAR(255) NOT NULL,
  changed_at VARCHAR(40) NOT NULL,
  KEY repair_status_history_job_changed_idx (workshop_id, job_id, changed_at),
  CONSTRAINT repair_status_history_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT repair_status_history_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repair_activity_logs (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191) NOT NULL,
  work_performed TEXT,
  inspection_findings TEXT,
  problems_identified TEXT,
  recommendations TEXT,
  additional_work_required TEXT,
  internal_notes TEXT,
  created_by_user_id VARCHAR(191),
  created_by_name VARCHAR(255) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY repair_activity_logs_job_created_idx (workshop_id, job_id, created_at),
  CONSTRAINT repair_activity_logs_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT repair_activity_logs_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repair_mechanic_assignments (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191) NOT NULL,
  mechanic_user_id VARCHAR(191) NOT NULL,
  mechanic_name VARCHAR(255) NOT NULL,
  assigned_by_user_id VARCHAR(191),
  assigned_by_name VARCHAR(255) NOT NULL,
  assigned_at VARCHAR(40) NOT NULL,
  unassigned_at VARCHAR(40),
  KEY repair_mechanic_assignments_mechanic_idx (workshop_id, mechanic_user_id, assigned_at),
  CONSTRAINT repair_assignments_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT repair_assignments_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE CASCADE,
  CONSTRAINT repair_assignments_mechanic_fk FOREIGN KEY (mechanic_user_id, workshop_id) REFERENCES users(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_transactions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  part_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191),
  vehicle_id VARCHAR(191),
  transaction_type VARCHAR(32) NOT NULL,
  quantity_delta INT NOT NULL,
  unit_cost_cents BIGINT NOT NULL DEFAULT 0,
  note TEXT,
  responsible_user_id VARCHAR(191),
  responsible_name VARCHAR(255) NOT NULL,
  transaction_at VARCHAR(40) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY stock_transactions_workshop_date_idx (workshop_id, transaction_at),
  KEY stock_transactions_part_date_idx (workshop_id, part_id, transaction_at),
  KEY stock_transactions_job_idx (workshop_id, job_id, transaction_at),
  CONSTRAINT stock_transactions_part_fk FOREIGN KEY (part_id, workshop_id) REFERENCES parts(id, workshop_id) ON DELETE RESTRICT,
  CONSTRAINT stock_transactions_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE RESTRICT,
  CONSTRAINT stock_transactions_vehicle_fk FOREIGN KEY (vehicle_id, workshop_id) REFERENCES vehicles(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_accounts (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  customer_id VARCHAR(191) NOT NULL,
  workshop_id VARCHAR(191) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  password_salt VARCHAR(128) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY customer_accounts_workshop_email_uq (workshop_id, email),
  UNIQUE KEY customer_accounts_customer_workshop_uq (customer_id, workshop_id),
  KEY customer_accounts_workshop_email_idx (workshop_id, email),
  KEY customer_accounts_customer_idx (customer_id, workshop_id),
  CONSTRAINT customer_accounts_customer_fk FOREIGN KEY (customer_id, workshop_id) REFERENCES customers(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

