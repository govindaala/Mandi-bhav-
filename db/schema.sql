PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS states (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS districts (
  id TEXT PRIMARY KEY,
  state_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(state_id, name),
  FOREIGN KEY (state_id) REFERENCES states(id)
);

CREATE TABLE IF NOT EXISTS mandis (
  id TEXT PRIMARY KEY,
  district_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (district_id) REFERENCES districts(id)
);

CREATE TABLE IF NOT EXISTS commodities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL DEFAULT 'quintal',
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS varieties (
  id TEXT PRIMARY KEY,
  commodity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(commodity_id, name),
  FOREIGN KEY (commodity_id) REFERENCES commodities(id)
);

CREATE TABLE IF NOT EXISTS qualities (
  id TEXT PRIMARY KEY,
  commodity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(commodity_id, name),
  FOREIGN KEY (commodity_id) REFERENCES commodities(id)
);

CREATE TABLE IF NOT EXISTS price_records (
  id TEXT PRIMARY KEY,
  mandi_id TEXT NOT NULL,
  commodity_id TEXT NOT NULL,
  variety_id TEXT,
  quality_id TEXT,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('GOVERNMENT_MANDI','ENAM','MANDI_OPERATOR','TRADER','JOURNALIST','OTHER')
  ),
  source_name TEXT,
  source_user_id TEXT,
  price_date TEXT NOT NULL,
  min_price INTEGER,
  max_price INTEGER,
  modal_price INTEGER,
  arrival_quantity REAL,
  unit TEXT NOT NULL DEFAULT 'quintal',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','VERIFIED','REJECTED','ARCHIVED')
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mandi_id) REFERENCES mandis(id),
  FOREIGN KEY (commodity_id) REFERENCES commodities(id),
  FOREIGN KEY (variety_id) REFERENCES varieties(id),
  FOREIGN KEY (quality_id) REFERENCES qualities(id),
  FOREIGN KEY (source_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_price_trend
ON price_records(commodity_id, mandi_id, price_date);

CREATE INDEX IF NOT EXISTS idx_price_status
ON price_records(status, price_date);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

INSERT OR IGNORE INTO roles (id,name,description,is_system)
VALUES
('role_super_admin','SUPER_ADMIN','Full system administration',1),
('role_mandi_trader','MANDI_TRADER','Mandi trader rate submission',1),
('role_journalist','JOURNALIST','Journalist/local market reporting',1);

INSERT OR IGNORE INTO permissions (id,code,description) VALUES
('perm_users_manage','users.manage','Create/block/unblock users'),
('perm_roles_manage','roles.manage','Create and manage roles'),
('perm_audit_view','audit.view','View audit log'),
('perm_price_submit','price.submit','Submit price data'),
('perm_price_verify','price.verify','Verify price data'),
('perm_price_publish','price.publish','Publish verified price data'),
('perm_mandi_manage','mandi.manage','Manage mandis'),
('perm_commodity_manage','commodity.manage','Manage commodities');

INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 'role_super_admin', id FROM permissions;

INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES
('role_mandi_trader','perm_price_submit'),
('role_journalist','perm_price_submit');

INSERT OR IGNORE INTO states(id,name) VALUES ('state_mp','Madhya Pradesh');

INSERT OR IGNORE INTO commodities(id,name,unit) VALUES
('crop_soybean','सोयाबीन','quintal'),
('crop_wheat','गेहूं','quintal'),
('crop_gram','चना','quintal'),
('crop_mustard','सरसों','quintal'),
('crop_lentil','मसूर','quintal'),
('crop_fenugreek','मेथी','quintal'),
('crop_flax','अलसी','quintal'),
('crop_garlic','लहसुन','quintal'),
('crop_onion','प्याज','quintal');
