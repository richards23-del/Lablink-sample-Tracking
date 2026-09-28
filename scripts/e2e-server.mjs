import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Every browser run gets a fresh database, separate from data/lablink.sqlite.
const directory = mkdtempSync(join(tmpdir(), 'lablink-e2e-'));
const env = {
  ...process.env,
  NODE_ENV: 'test',
  LABLINK_DELIVERY_MODE: 'preview',
  PORT: '3101',
  FRONTEND_PORT: '5180',
  HOST: '127.0.0.1',
  APP_ORIGIN: 'http://127.0.0.1:5180',
  DATABASE_PATH: join(directory, 'test.sqlite'),
};
const children = [
  spawn(
    process.execPath,
    [resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'],
    { env, stdio: 'inherit' },
  ),
  spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js')], {
    env,
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
