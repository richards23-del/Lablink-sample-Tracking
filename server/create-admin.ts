import 'dotenv/config';
import { resolve } from 'node:path';
import { addUser, openDatabase } from './database.js';
import { setupSchema } from './validation.js';

const input = setupSchema.safeParse({
  name: process.env.LABLINK_ADMIN_NAME,
  email: process.env.LABLINK_ADMIN_EMAIL,
  password: process.env.LABLINK_ADMIN_PASSWORD,
  workspaceName: process.env.LABLINK_WORKSPACE_NAME ?? 'LabLink',
  timezone: process.env.LABLINK_TIMEZONE ?? 'Africa/Johannesburg',
});
if (!input.success) {
  console.error(
    'Set LABLINK_ADMIN_NAME, LABLINK_ADMIN_EMAIL, and LABLINK_ADMIN_PASSWORD (12–128 characters). Optional: LABLINK_WORKSPACE_NAME and LABLINK_TIMEZONE.',
  );
  process.exitCode = 1;
} else {
  const database = openDatabase(
    process.env.DATABASE_PATH ?? resolve('data/lablink.sqlite'),
  );
  try {
    const admin = database.transaction(() => {
      if (database.prepare('SELECT 1 FROM users LIMIT 1').get())
        throw new Error(
          'Workspace is already initialized. Use the authenticated administrator interface to add accounts.',
        );
      database
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('workspace_name', input.data.workspaceName);
      database
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('timezone', input.data.timezone);
      const timestamp = new Date().toISOString();
      const user = addUser(
        database,
        { ...input.data, role: 'admin' },
        timestamp,
      );
      database
        .prepare(
          'INSERT INTO security_audit (actor_id, action, subject_id, timestamp) VALUES (?, ?, ?, ?)',
        )
        .run(user.id, 'cli_workspace_setup', user.id, timestamp);
      return user;
    })();
    console.log(`Administrator account created for ${admin.email}.`);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Administrator account could not be created.',
    );
    process.exitCode = 1;
  } finally {
    delete process.env.LABLINK_ADMIN_PASSWORD;
    database.close();
  }
}
