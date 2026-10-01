import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const sourceDirectory = resolve(process.env.LABLINK_DATA_DIRECTORY ?? 'data');
const backupDirectory = resolve(
  process.env.LABLINK_BACKUP_DIRECTORY ?? 'backups',
);
if (!existsSync(sourceDirectory))
  throw new Error(`Data directory does not exist: ${sourceDirectory}`);
mkdirSync(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

async function backup(source: string) {
  const target = join(
    backupDirectory,
    `${basename(source, '.sqlite')}-${stamp}.sqlite`,
  );
  const database = new Database(source, { readonly: true });
  try {
    await database.backup(target);
    console.log(`Backed up ${basename(source)}.`);
  } finally {
    database.close();
  }
}

const databases = readdirSync(sourceDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
  .map((entry) => join(sourceDirectory, entry.name));
const workspaceDirectory = join(sourceDirectory, 'workspaces');
if (existsSync(workspaceDirectory))
  for (const entry of readdirSync(workspaceDirectory, { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.sqlite'))
      databases.push(join(workspaceDirectory, entry.name));
if (!databases.length) throw new Error('No SQLite databases found to back up.');
for (const database of databases) await backup(database);
