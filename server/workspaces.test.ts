import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getUser, openDatabase } from './database.js';
import { WorkspaceDirectory } from './workspaces.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('workspace directory', () => {
  it('creates isolated lab databases with an administrator and unique URL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lablink-workspaces-test-'));
    directories.push(directory);
    const registry = new WorkspaceDirectory(
      join(directory, 'registry.sqlite'),
      join(directory, 'labs'),
    );
    const first = registry.provision({
      name: 'First Administrator',
      email: 'first@example.test',
      password: 'a-long-test-password-2026',
      workspaceName: 'North Star Lab',
      timezone: 'Africa/Johannesburg',
    });
    const second = registry.provision({
      name: 'Second Administrator',
      email: 'second@example.test',
      password: 'a-long-test-password-2026',
      workspaceName: 'North Star Lab',
      timezone: 'Africa/Johannesburg',
    });
    expect(first).toMatchObject({
      slug: 'north-star-lab',
      url: '/w/north-star-lab',
    });
    expect(second.slug).toBe('north-star-lab-2');
    const record = registry.find(first.slug)!;
    const lab = openDatabase(record.databasePath);
    expect(getUser(lab, 1)).toMatchObject({
      name: 'First Administrator',
      role: 'admin',
      workspaceName: 'North Star Lab',
    });
    lab.close();
    registry.close();
  });
});
