-- Gatepass schema (SQLite). Timestamps are ISO-8601 UTC strings; `day` columns are
-- the society-local calendar date (YYYY-MM-DD) used for "today" and activity ranges.
-- Kept to portable SQL so it moves to Postgres with type tweaks only.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS society (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  name             TEXT    NOT NULL,
  logo             TEXT,                        -- data URL (small, resized client-side)
  gate_phone       TEXT    NOT NULL,
  supervisor_name  TEXT    NOT NULL,
  supervisor_phone TEXT    NOT NULL,
  otp_required     INTEGER NOT NULL DEFAULT 0,  -- visitor mobile OTP before walk-in is logged
  auto_share_pass  INTEGER NOT NULL DEFAULT 1,  -- SMS pre-approved passes to the visitor
  pass_validity    TEXT    NOT NULL DEFAULT '24 hours' CHECK (pass_validity IN ('4 hours', '24 hours', '3 days')),
  updated_at       TEXT    NOT NULL
);

-- Identity is the mobile number. One person may own/rent many units and may also be staff.
CREATE TABLE IF NOT EXISTS people (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  mobile     TEXT    NOT NULL UNIQUE CHECK (length(mobile) = 10),
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role      TEXT    NOT NULL CHECK (role IN ('admin', 'security')),
  PRIMARY KEY (person_id, role)
);

CREATE TABLE IF NOT EXISTS units (
  id               TEXT    PRIMARY KEY,                     -- e.g. A-101, OFF-12
  type             TEXT    NOT NULL CHECK (type IN ('Flat', 'Office')),
  owner_id         INTEGER NOT NULL REFERENCES people(id),
  tenant_id        INTEGER REFERENCES people(id),
  divert_to_tenant INTEGER NOT NULL DEFAULT 0,             -- owner routes visitor requests to tenant
  cc_owner         INTEGER NOT NULL DEFAULT 0              -- ...and also notifies the owner
);
CREATE INDEX IF NOT EXISTS units_owner ON units(owner_id);
CREATE INDEX IF NOT EXISTS units_tenant ON units(tenant_id);

CREATE TABLE IF NOT EXISTS passes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,                             -- 6 digits, unique among live passes
  name        TEXT    NOT NULL,
  mobile      TEXT    NOT NULL,
  unit_id     TEXT    NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  purpose     TEXT    NOT NULL,
  validity    TEXT    NOT NULL,                             -- society pass validity at issue time
  valid_from  TEXT    NOT NULL,
  valid_until TEXT    NOT NULL,
  reusable    INTEGER NOT NULL DEFAULT 0,                   -- set when extended: repeat entries allowed
  sent        INTEGER NOT NULL DEFAULT 0,                   -- SMS delivered to visitor
  time_slot   TEXT,                                         -- optional 'HH:MM–HH:MM' entry window
  revoked_at  TEXT,                                         -- set when the member cancels the pass
  used_at     TEXT,
  created_by  INTEGER NOT NULL REFERENCES people(id),
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS passes_code ON passes(code);
CREATE INDEX IF NOT EXISTS passes_unit ON passes(unit_id);

CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  mobile      TEXT    NOT NULL,
  unit_id     TEXT    NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  purpose     TEXT    NOT NULL,
  photo       TEXT,                                         -- data URL (resized client-side)
  status      TEXT    NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'inside', 'exited')),
  via         TEXT    NOT NULL CHECK (via IN ('Walk-in', 'Pass')),
  pass_id     INTEGER REFERENCES passes(id),
  day         TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  decided_by  INTEGER REFERENCES people(id),
  decided_at  TEXT,
  entered_at  TEXT,
  exited_at   TEXT,
  logged_by   INTEGER REFERENCES people(id)
);
CREATE INDEX IF NOT EXISTS visits_day ON visits(day);
CREATE INDEX IF NOT EXISTS visits_unit_status ON visits(unit_id, status);

CREATE TABLE IF NOT EXISTS tenant_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id      TEXT    NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('add', 'remove')),
  name         TEXT    NOT NULL,
  mobile       TEXT    NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES people(id),
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at   TEXT    NOT NULL,
  resolved_at  TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  unit_id     TEXT    NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  person_id   INTEGER NOT NULL REFERENCES people(id),
  status      TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'ack', 'resolved')),
  created_at  TEXT    NOT NULL,
  ack_at      TEXT,
  resolved_at TEXT
);

-- Append-only audit/activity log. `name` is the subject (visitor or member) at time of event.
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  day     TEXT NOT NULL,
  at      TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('request', 'approved', 'denied', 'entry', 'exit', 'pass', 'extend', 'tenant', 'profile', 'alert', 'revoke')),
  detail  TEXT NOT NULL DEFAULT '',
  actor_id     INTEGER,             -- who performed the action (snapshot below survives renames)
  actor_name   TEXT,
  actor_mobile TEXT,
  actor_role   TEXT,                -- 'Admin' | 'Security' | 'Resident'
  data         TEXT                 -- JSON: { fields: [label, value][], changes: {field, from, to}[] }
);
CREATE INDEX IF NOT EXISTS events_day ON events(day);
CREATE INDEX IF NOT EXISTS events_unit_day ON events(unit_id, day);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  text       TEXT    NOT NULL,
  link       TEXT,
  created_at TEXT    NOT NULL,
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS notifications_person ON notifications(person_id, created_at);

CREATE TABLE IF NOT EXISTS otps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile     TEXT    NOT NULL,
  purpose    TEXT    NOT NULL CHECK (purpose IN ('login', 'visitor', 'mobile_change')),
  code_hash  TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    TEXT,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS otps_lookup ON otps(mobile, purpose, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

-- Every SMS sent. In development this is the delivery channel (see /dev/sms).
CREATE TABLE IF NOT EXISTS sms_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_mobile  TEXT NOT NULL,
  body       TEXT NOT NULL,
  link       TEXT,
  status     TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sms_to ON sms_outbox(to_mobile, created_at);

-- Admin broadcasts. Recipients are resolved and snapshotted at send time so read stats stay accurate.
CREATE TABLE IF NOT EXISTS notices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  priority     TEXT    NOT NULL CHECK (priority IN ('normal', 'important', 'urgent')),
  audience     TEXT    NOT NULL CHECK (audience IN ('all', 'residents', 'security', 'blocks')),
  blocks       TEXT,                                  -- comma list when audience = 'blocks' (e.g. 'A,C')
  sms          INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER NOT NULL REFERENCES people(id),
  created_at   TEXT    NOT NULL,
  expires_on   TEXT,                                  -- YYYY-MM-DD; hidden from inboxes after this day
  withdrawn_at TEXT
);

CREATE TABLE IF NOT EXISTS notice_recipients (
  notice_id INTEGER NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role      TEXT    NOT NULL,                         -- 'Resident' | 'Security' (how they were reached)
  read_at   TEXT,
  ack_at    TEXT,                                     -- urgent notices ask for an explicit acknowledgement
  PRIMARY KEY (notice_id, person_id)
);
CREATE INDEX IF NOT EXISTS notice_recipients_person ON notice_recipients(person_id);

-- One optional attachment per notice: a photo (JPG/PNG) or a PDF.
CREATE TABLE IF NOT EXISTS notice_files (
  notice_id INTEGER PRIMARY KEY REFERENCES notices(id) ON DELETE CASCADE,
  name      TEXT    NOT NULL,
  mime      TEXT    NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  size      INTEGER NOT NULL,
  data      BLOB    NOT NULL
);
