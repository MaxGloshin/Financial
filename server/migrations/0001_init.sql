PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rp_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  label TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_passkeys_user_rp ON passkeys(user_id, rp_id);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  unlocked_until TEXT,
  ua_hash TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('register', 'login', 'unlock')),
  challenge TEXT NOT NULL,
  payload TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_challenges_expires ON webauthn_challenges(expires_at);

CREATE TABLE recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recovery_user ON recovery_codes(user_id);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash', 'debit', 'savings', 'credit', 'receivable', 'payable', 'asset_illiquid', 'investment')),
  currency TEXT NOT NULL DEFAULT 'RUB',
  credit_limit_minor INTEGER,
  interest_rate_bp INTEGER,
  statement_day INTEGER,
  payment_due_day INTEGER,
  is_liquid INTEGER NOT NULL DEFAULT 1 CHECK (is_liquid IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (type <> 'credit' OR credit_limit_minor IS NOT NULL)
);
CREATE INDEX idx_accounts_user ON accounts(user_id, sort_order);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'adjustment')),
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  icon TEXT,
  color TEXT,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  monthly_target_minor INTEGER,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_categories_user_kind ON categories(user_id, kind, sort_order);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'credit_payment', 'debt_payment', 'refund', 'adjustment')),
  occurred_at TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'voice', 'sms', 'csv', 'recurring', 'shortcut', 'template', 'seed')),
  source_ref TEXT,
  review_status TEXT NOT NULL DEFAULT 'ok' CHECK (review_status IN ('ok', 'needs_review', 'duplicate_suspect', 'ignored')),
  import_batch_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, occurred_at DESC);
CREATE INDEX idx_transactions_source_ref ON transactions(user_id, source_ref);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  CHECK ((account_id IS NULL) <> (category_id IS NULL))
);
CREATE INDEX idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_account ON ledger_entries(account_id);
CREATE INDEX idx_ledger_category ON ledger_entries(category_id);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'credit_payment', 'debt_payment', 'refund', 'adjustment')),
  amount_minor INTEGER NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_templates_user ON templates(user_id, sort_order);

CREATE TABLE credit_statements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_start TEXT,
  period_end TEXT,
  due_date TEXT,
  grace_end_date TEXT,
  total_due_minor INTEGER,
  min_payment_minor INTEGER,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('open', 'paid', 'overdue', 'unknown')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_statements_account ON credit_statements(account_id, due_date);

CREATE TABLE planned_inflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  expected_date TEXT,
  window_start INTEGER,
  window_end INTEGER,
  confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'likely', 'possible')),
  note TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE app_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(user_id, entity, entity_id, at DESC);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsed', 'committed', 'cancelled')),
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE import_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  raw TEXT NOT NULL,
  normalized_json TEXT,
  classification TEXT NOT NULL DEFAULT 'new' CHECK (classification IN ('new', 'duplicate_exact', 'duplicate_fuzzy', 'possible_manual_duplicate', 'invalid')),
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  note TEXT
);
CREATE INDEX idx_import_rows_batch ON import_rows(batch_id, row_index);
