import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { ApiError } from './errors.js';
import { WorkspaceDirectory } from './workspaces.js';
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
// Render provides its public HTTPS address at runtime. APP_ORIGIN remains the
// explicit setting for all other production deployments.
const applicationOrigin =
  process.env.APP_ORIGIN ?? process.env.RENDER_EXTERNAL_URL;
const configuredOrigins = applicationOrigin
  ?.split(',')
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

const directory = new WorkspaceDirectory(
  process.env.WORKSPACE_REGISTRY_PATH ?? resolve('data/workspaces.sqlite'),
  process.env.WORKSPACE_DIRECTORY ?? resolve('data/workspaces'),
);
const appOptions = {
  databasePath: process.env.DATABASE_PATH ?? resolve('data/lablink.sqlite'),
  production,
  allowedOrigins: configuredOrigins,
  staticDirectory: production ? staticDirectory : undefined,
  turnaroundHours: {
    routine: Number(process.env.LABLINK_TAT_ROUTINE_HOURS ?? 24),
    high: Number(process.env.LABLINK_TAT_HIGH_HOURS ?? 8),
    urgent: Number(process.env.LABLINK_TAT_URGENT_HOURS ?? 2),
  },
};
const root = createApp({
  ...appOptions,
  workspaceProvisioner: { provision: (input) => directory.provision(input) },
});
const workers = [startWorker(root.samples, root.communications)];
const workspaces = new Map<string, ReturnType<typeof createApp>>();
const app = express();
app.get('/healthz', (_request, response) => {
  try {
    root.database.prepare('SELECT 1').get();
    response.status(200).json({ status: 'ok' });
  } catch {
    response.status(503).json({ status: 'unavailable' });
  }
});
app.use('/w/:workspace', (request, response, next) => {
  const record = directory.find(request.params.workspace);
  if (!record)
    return next(
      new ApiError(404, 'Laboratory workspace not found.', 'NOT_FOUND'),
    );
  let workspace = workspaces.get(record.slug);
  if (!workspace) {
    workspace = createApp({
      ...appOptions,
      databasePath: record.databasePath,
      cookiePath: `/w/${record.slug}`,
    });
    workspaces.set(record.slug, workspace);
    workers.push(startWorker(workspace.samples, workspace.communications));
  }
  workspace.app(request, response, next);
});
app.use(root.app);
const server = app.listen(port, host, () =>
  console.log(`LabLink API listening on http://${host}:${port}`),
);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    await Promise.all(workers.map((worker) => worker.stop()));
    for (const workspace of workspaces.values()) workspace.close();
    root.close();
    directory.close();
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 15_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
