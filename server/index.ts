import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { startWorker } from './worker.js';

const production = process.env.NODE_ENV === 'production';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a valid TCP port.');
const staticDirectory = resolve('dist/public');
if (production && !existsSync(resolve(staticDirectory, 'index.html')))
  throw new Error(
    'Build the frontend with npm run build before starting production mode.',
  );
const configuredOrigins = process.env.APP_ORIGIN?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (production && (!configuredOrigins || configuredOrigins.length === 0))
  throw new Error(
    'Set APP_ORIGIN to the exact trusted application origin before starting production mode.',
  );
if (configuredOrigins)
  for (const origin of configuredOrigins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error(
        'APP_ORIGIN must contain comma-separated exact http(s) origins with no trailing slash.',
      );
    if (
      production &&
      url.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      throw new Error('Production application origins must use HTTPS.');
  }

const { app, close, samples, communications } = createApp({
  databasePath: process.env.DATABASE_PATH ?? resolve('data/lablink.sqlite'),
  production,
  allowedOrigins: configuredOrigins,
  staticDirectory: production ? staticDirectory : undefined,
  turnaroundHours: {
    routine: Number(process.env.LABLINK_TAT_ROUTINE_HOURS ?? 24),
    high: Number(process.env.LABLINK_TAT_HIGH_HOURS ?? 8),
    urgent: Number(process.env.LABLINK_TAT_URGENT_HOURS ?? 2),
  },
});
const worker = startWorker(samples, communications);
const server = app.listen(port, host, () =>
  console.log(`LabLink API listening on http://${host}:${port}`),
);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    await worker.stop();
    close();
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 15_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
