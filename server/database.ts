import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role, User } from '../shared/types.js';

export type LabDatabase = Database.Database;

export function openDatabase(filename: string): LabDatabase {
  if (filename !== ':memory:')
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  const database = new Database(filename);
  const schemaVersion = database.pragma('user_version', {
    simple: true,
  }) as number;
  if (schemaVersion > 2) {
    database.close();
    throw new Error(
      'This database was created by a newer LabLink version. Upgrade the application before opening it.',
    );
  }
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (schemaVersion === 1) {
    // Rebuild only the role-constrained parent table; preserve IDs and every dependent record.
    database.pragma('foreign_keys = OFF');
    try {
      database.transaction(() => {
        database.exec(`
          CREATE TABLE users_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin', 'technician', 'reviewer', 'clinician', 'patient', 'transporter')),
            created_at TEXT NOT NULL
          );
          INSERT INTO users_v2 SELECT id, name, email, password_hash, role, created_at FROM users;
          DROP TABLE users;
          ALTER TABLE users_v2 RENAME TO users;
        `);
        if ((database.pragma('foreign_key_check') as unknown[]).length)
          throw new Error(
            'Database migration found broken references and was rolled back.',
          );
        database.pragma('user_version = 2');
      })();
    } catch (error) {
      database.close();
      throw error;
    } finally {
      if (database.open) database.pragma('foreign_keys = ON');
    }
  }
  database.function(
    'lablink_fold',
    { deterministic: true },
    (value: unknown) =>
      typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : '',
  );
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'technician', 'reviewer', 'clinician', 'patient', 'transporter')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      urgent INTEGER NOT NULL DEFAULT 1,
      delays INTEGER NOT NULL DEFAULT 1,
      verification INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL DEFAULT 1,
      payload TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      result_entered_by INTEGER REFERENCES users(id),
      released_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS samples_updated ON samples(json_extract(payload, '$.updatedAt') DESC, id DESC);
    CREATE INDEX IF NOT EXISTS samples_status_due ON samples(json_extract(payload, '$.status'), json_extract(payload, '$.dueAt'));
    CREATE INDEX IF NOT EXISTS samples_priority ON samples(json_extract(payload, '$.priority'));
    CREATE INDEX IF NOT EXISTS samples_patient_portal ON samples(json_extract(payload, '$.contacts.patient.portalUserId'));
    CREATE INDEX IF NOT EXISTS samples_clinician_portal ON samples(json_extract(payload, '$.contacts.clinician.portalUserId'));
    CREATE INDEX IF NOT EXISTS samples_transporter_portal ON samples(json_extract(payload, '$.contacts.transporter.portalUserId'));
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sample_id INTEGER NOT NULL REFERENCES samples(id),
      actor_id INTEGER NOT NULL REFERENCES users(id),
      actor_name TEXT NOT NULL,
      label TEXT NOT NULL,
      department TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_sample ON audit_events(sample_id, id);
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sample_id INTEGER NOT NULL REFERENCES samples(id),
      author_id INTEGER NOT NULL REFERENCES users(id),
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_sample ON notes(sample_id, id);
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sample_id INTEGER NOT NULL REFERENCES samples(id),
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      blocking INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      acknowledged_by INTEGER REFERENCES users(id),
      acknowledged_at TEXT,
      resolved_by INTEGER REFERENCES users(id),
      resolved_at TEXT,
      resolution TEXT,
      UNIQUE(sample_id, kind)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      sample_id INTEGER REFERENCES samples(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
    CREATE TABLE IF NOT EXISTS security_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      subject_id INTEGER REFERENCES users(id),
      timestamp TEXT NOT NULL
    );
    PRAGMA user_version = 2;
  `);
  return database;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function getUser(database: LabDatabase, id: number): User | undefined {
  const row = database
    .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
    .get(id) as
    { id: number; name: string; email: string; role: Role } | undefined;
  if (!row) return undefined;
  const setting = (key: string, fallback: string) =>
    (
      database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value ?? fallback;
  return {
    ...row,
    workspaceName: setting('workspace_name', 'LabLink'),
    timezone: setting('timezone', 'UTC'),
  };
}

export function addUser(
  database: LabDatabase,
  input: { name: string; email: string; password: string; role: Role },
  timestamp: string,
): User {
  const result = database
    .prepare(
      'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      input.name,
      input.email.toLowerCase(),
      hashPassword(input.password),
      input.role,
      timestamp,
    );
  const id = Number(result.lastInsertRowid);
  database.prepare('INSERT INTO preferences (user_id) VALUES (?)').run(id);
  return getUser(database, id)!;
}
