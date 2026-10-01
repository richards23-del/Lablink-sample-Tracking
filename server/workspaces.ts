import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { addUser, openDatabase } from './database.js';
import { ApiError } from './errors.js';

export interface WorkspaceInput {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
  timezone: string;
}

export interface WorkspaceRecord {
  slug: string;
  name: string;
  databasePath: string;
  createdAt: string;
}

export interface ProvisionedWorkspace {
  slug: string;
  name: string;
  url: string;
}

function workspaceSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return slug.length >= 3 ? slug : 'lab';
}

/** Maps public lab-space URLs to fully isolated per-laboratory databases. */
export class WorkspaceDirectory {
  private readonly db: Database.Database;

  constructor(
    registryPath: string,
    private readonly workspaceDirectory: string,
  ) {
    mkdirSync(dirname(resolve(registryPath)), { recursive: true });
    mkdirSync(workspaceDirectory, { recursive: true });
    this.db = new Database(registryPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_registry (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        database_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `);
  }

  find(slug: string): WorkspaceRecord | undefined {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return undefined;
    const row = this.db
      .prepare(
        'SELECT slug, name, database_path, created_at FROM workspace_registry WHERE slug = ?',
      )
      .get(slug) as
      | {
          slug: string;
          name: string;
          database_path: string;
          created_at: string;
        }
      | undefined;
    return row
      ? {
          slug: row.slug,
          name: row.name,
          databasePath: row.database_path,
          createdAt: row.created_at,
        }
      : undefined;
  }

  provision(input: WorkspaceInput, now = new Date()): ProvisionedWorkspace {
    const base = workspaceSlug(input.workspaceName);
    let slug = base;
    for (let suffix = 2; this.find(slug); suffix += 1) {
      if (suffix > 1000)
        throw new ApiError(
          409,
          'Choose a more distinctive laboratory name.',
          'SLUG_CONFLICT',
        );
      slug = `${base}-${suffix}`;
    }
    const databasePath = join(this.workspaceDirectory, `${slug}.sqlite`);
    const timestamp = now.toISOString();
    let initialized = false;
    try {
      const database = openDatabase(databasePath);
      try {
        database.transaction(() => {
          database
            .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
            .run('workspace_name', input.workspaceName);
          database
            .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
            .run('timezone', input.timezone);
          const admin = addUser(
            database,
            { ...input, role: 'admin' },
            timestamp,
          );
          database
            .prepare(
              'INSERT INTO security_audit (actor_id, action, subject_id, timestamp) VALUES (?, ?, ?, ?)',
            )
            .run(admin.id, 'public_workspace_created', admin.id, timestamp);
        })();
        initialized = true;
      } finally {
        database.close();
      }
      this.db
        .prepare(
          'INSERT INTO workspace_registry (slug, name, database_path, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(slug, input.workspaceName, databasePath, timestamp);
    } catch (error) {
      if (initialized) rmSync(databasePath, { force: true });
      throw error;
    }
    return { slug, name: input.workspaceName, url: `/w/${slug}` };
  }

  close() {
    this.db.close();
  }
}
