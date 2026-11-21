-- DB-backed customer session and token lifecycle.
-- Staff sessions use jwt_sessions/jwt_tokens; customer sessions get the same
-- rotation, reuse detection and revocation guarantees here.

CREATE TABLE IF NOT EXISTS customer_sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  customer_account_id VARCHAR(191) NOT NULL,
  customer_id VARCHAR(191) NOT NULL,
  workshop_id VARCHAR(191) NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  absolute_expires_at VARCHAR(40) NOT NULL,
  last_used_at VARCHAR(40) NULL,
  revoked_at VARCHAR(40) NULL,
  KEY customer_sessions_account_idx (customer_account_id, revoked_at),
  KEY customer_sessions_customer_idx (customer_id, workshop_id),
  CONSTRAINT customer_sessions_account_fk FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE,
  CONSTRAINT customer_sessions_customer_fk FOREIGN KEY (customer_id, workshop_id) REFERENCES customers(id, workshop_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_jwt_tokens (
  jti VARCHAR(191) NOT NULL PRIMARY KEY,
  session_id VARCHAR(191) NOT NULL,
  token_type VARCHAR(16) NOT NULL,
  expires_at VARCHAR(40) NOT NULL,
  replaced_by_jti VARCHAR(191) NULL,
  revoked_at VARCHAR(40) NULL,
  created_at VARCHAR(40) NOT NULL,
  KEY customer_jwt_tokens_session_idx (session_id, token_type, revoked_at),
  KEY customer_jwt_tokens_expires_idx (expires_at),
  CONSTRAINT customer_jwt_tokens_session_fk FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
