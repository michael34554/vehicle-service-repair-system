-- Additive migration for the Mechanic Management module.
-- Mechanic accounts are existing `users` rows with role = 'technician'.
-- This migration adds mechanic-specific profile data and links work records to it
-- without duplicating customers, vehicles, repair jobs, or inventory records.

CREATE TABLE IF NOT EXISTS mechanics (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  mechanic_number VARCHAR(64) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(100) NOT NULL,
  address VARCHAR(500),
  gender VARCHAR(32),
  specialization VARCHAR(64) NOT NULL,
  experience_years INT NOT NULL DEFAULT 0,
  qualifications TEXT,
  employment_date VARCHAR(40) NOT NULL,
  employment_status VARCHAR(32) NOT NULL DEFAULT 'Active',
  availability_status VARCHAR(32) NOT NULL DEFAULT 'Available',
  profile_image VARCHAR(500),
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY mechanics_id_workshop_uq (id, workshop_id),
  UNIQUE KEY mechanics_workshop_user_uq (workshop_id, user_id),
  UNIQUE KEY mechanics_workshop_number_uq (workshop_id, mechanic_number),
  UNIQUE KEY mechanics_workshop_email_uq (workshop_id, email),
  KEY mechanics_workshop_specialization_idx (workshop_id, specialization),
  KEY mechanics_workshop_availability_idx (workshop_id, employment_status, availability_status),
  CONSTRAINT mechanics_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT mechanics_user_fk FOREIGN KEY (user_id, workshop_id) REFERENCES users(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extend the existing assignment history instead of creating a second assignment table.
-- Existing rows keep their values through the defaults below.
ALTER TABLE repair_mechanic_assignments
  ADD COLUMN assignment_status VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN notes TEXT,
  ADD KEY repair_assignments_mechanic_status_idx (workshop_id, mechanic_user_id, assignment_status, assigned_at);

-- Work logs remain in the existing repair_activity_logs table. These columns allow
-- mechanic work management to distinguish a start/progress/note/completion record.
ALTER TABLE repair_activity_logs
  ADD COLUMN activity_type VARCHAR(40),
  ADD COLUMN work_status VARCHAR(64);

-- Completion submissions that administrators verify. The repair job remains the
-- source of truth for repair status. This table stores the mechanic's submitted work.
CREATE TABLE IF NOT EXISTS repair_completions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  workshop_id VARCHAR(191) NOT NULL,
  job_id VARCHAR(191) NOT NULL,
  mechanic_user_id VARCHAR(191) NOT NULL,
  work_performed TEXT,
  identified_problems TEXT,
  completion_notes TEXT,
  submitted_at VARCHAR(40) NOT NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  verified_by_user_id VARCHAR(191),
  verified_by_name VARCHAR(255),
  verified_at VARCHAR(40),
  verification_note TEXT,
  created_at VARCHAR(40) NOT NULL,
  updated_at VARCHAR(40) NOT NULL,
  UNIQUE KEY repair_completions_workshop_job_uq (workshop_id, job_id),
  KEY repair_completions_mechanic_idx (workshop_id, mechanic_user_id, submitted_at),
  KEY repair_completions_verification_idx (workshop_id, verification_status, submitted_at),
  CONSTRAINT repair_completions_workshop_fk FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  CONSTRAINT repair_completions_job_fk FOREIGN KEY (job_id, workshop_id) REFERENCES jobs(id, workshop_id) ON DELETE RESTRICT,
  CONSTRAINT repair_completions_mechanic_fk FOREIGN KEY (mechanic_user_id, workshop_id) REFERENCES users(id, workshop_id) ON DELETE RESTRICT,
  CONSTRAINT repair_completions_verifier_fk FOREIGN KEY (verified_by_user_id, workshop_id) REFERENCES users(id, workshop_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
