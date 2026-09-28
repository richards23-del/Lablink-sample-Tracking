import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Express, Response } from 'express';
import { z } from 'zod';
import type { User } from '../shared/types.js';
import { getUser, type LabDatabase } from './database.js';
import { ApiError } from './errors.js';
import type { SampleService } from './samples.js';
import { sampleSchema } from './validation.js';

const identifier = z.string().trim().min(1).max(120);
const base = {
  source: identifier,
  eventId: identifier,
  externalSampleId: identifier,
};
const eventSchema = z.discriminatedUnion('event', [
  z
    .object({ ...base, event: z.literal('received'), sample: sampleSchema })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal('replacement_received'),
      parentExternalSampleId: identifier,
      collectedAt: z
        .string()
        .datetime({ offset: true })
        .refine(
          (value) => Number.isFinite(Date.parse(value)),
          'Use a valid timestamp.',
        )
        .transform((value) => new Date(value).toISOString()),
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal('rejected'),
      reason: z.string().trim().min(1).max(2000),
      instructions: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal('delayed'),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      ...base,
      event: z.literal('results_available'),
      resultSummary: z.string().trim().min(1).max(2000),
      releaseConfirmed: z.literal(true),
    })
    .strict(),
]);

function initialize(db: LabDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_samples (
      source TEXT NOT NULL, external_id TEXT NOT NULL,
      sample_id INTEGER NOT NULL REFERENCES samples(id),
      PRIMARY KEY(source, external_id)
    );
    CREATE TABLE IF NOT EXISTS integration_events (
      source TEXT NOT NULL, event_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
      sample_id INTEGER NOT NULL REFERENCES samples(id), received_at TEXT NOT NULL,
      PRIMARY KEY(source, event_id)
    );
  `);
}

function setting(db: LabDatabase, key: string): string | undefined {
  return (
    db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
  )?.value;
}
function saveSetting(db: LabDatabase, key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    key,
    value,
  );
}
function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

export function installIntegrationIngress(
  app: Express,
  db: LabDatabase,
  samples: SampleService,
  now: () => Date,
) {
  initialize(db);
  let windowStart = 0;
  let windowCount = 0;
  app.post('/api/integrations/events', (request, response) => {
    const expected = setting(db, 'integration_key_hash');
    const bearer = request
      .get('authorization')
      ?.match(/^Bearer (llk_[a-f0-9]{64})$/)?.[1];
    const actual = hash(bearer ?? '');
    if (
      !expected ||
      !bearer ||
      expected.length !== actual.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
    )
      throw new ApiError(
        401,
        'A valid integration key is required.',
        'INVALID_INTEGRATION_KEY',
      );
    if (setting(db, 'operating_mode') !== 'connected')
      throw new ApiError(
        403,
        'Enable connected mode before importing laboratory events.',
        'INTEGRATION_DISABLED',
      );
    const actor = getUser(db, Number(setting(db, 'integration_actor_id')));
    if (!actor || actor.role !== 'admin')
      throw new ApiError(
        403,
        'An administrator must rotate the integration key.',
        'INTEGRATION_DISABLED',
      );
    const timestamp = now().getTime();
    if (timestamp - windowStart >= 60_000) {
      windowStart = timestamp;
      windowCount = 0;
    }
    if (++windowCount > 120)
      throw new ApiError(
        429,
        'Integration request limit reached. Retry later.',
        'RATE_LIMITED',
      );
    const input = eventSchema.parse(request.body);
    const payloadHash = hash(canonical(input));
    const result = db.transaction(() => {
      const prior = db
        .prepare(
          'SELECT payload_hash, sample_id FROM integration_events WHERE source = ? AND event_id = ?',
        )
        .get(input.source, input.eventId) as
        { payload_hash: string; sample_id: number } | undefined;
      if (prior) {
        if (prior.payload_hash !== payloadHash)
          throw new ApiError(
            409,
            'This event ID was already used with different content.',
            'EVENT_CONFLICT',
          );
        return { sampleId: prior.sample_id, duplicate: true };
      }
      const mapping = db
        .prepare(
          'SELECT sample_id FROM integration_samples WHERE source = ? AND external_id = ?',
        )
        .get(input.source, input.externalSampleId) as
        { sample_id: number } | undefined;
      let sampleId: number;
      if (
        input.event === 'received' ||
        input.event === 'replacement_received'
      ) {
        if (mapping)
          throw new ApiError(
            409,
            'This external sample already exists. Reuse the original event ID for retries.',
            'SAMPLE_EXISTS',
          );
        if (input.event === 'received') {
          sampleId = samples.create(input.sample, actor).id;
        } else {
          const parent = db
            .prepare(
              'SELECT sample_id FROM integration_samples WHERE source = ? AND external_id = ?',
            )
            .get(input.source, input.parentExternalSampleId) as
            { sample_id: number } | undefined;
          if (!parent)
            throw new ApiError(
              404,
              'Import the original sample before its replacement.',
              'NOT_FOUND',
            );
          const original = samples.get(parent.sample_id, actor);
          sampleId = samples.registerReplacement(
            parent.sample_id,
            { version: original.version, collectedAt: input.collectedAt },
            actor,
          ).id;
        }
        db.prepare(
          'INSERT INTO integration_samples (source, external_id, sample_id) VALUES (?, ?, ?)',
        ).run(input.source, input.externalSampleId, sampleId);
      } else {
        if (!mapping)
          throw new ApiError(
            404,
            'Import sample reception before sending status events.',
            'NOT_FOUND',
          );
        sampleId = mapping.sample_id;
        samples.applyIntegrationEvent(sampleId, input, actor);
      }
      db.prepare(
        'INSERT INTO integration_events (source, event_id, payload_hash, sample_id, received_at) VALUES (?, ?, ?, ?, ?)',
      ).run(
        input.source,
        input.eventId,
        payloadHash,
        sampleId,
        now().toISOString(),
      );
      db.prepare(
        'INSERT INTO security_audit (actor_id, action, timestamp) VALUES (?, ?, ?)',
      ).run(actor.id, 'integration_event:' + input.event, now().toISOString());
      return { sampleId, duplicate: false };
    })();
    response.status(result.duplicate ? 200 : 201).json(result);
  });
}

export function installIntegrationManagement(
  app: Express,
  db: LabDatabase,
  requireAdmin: (response: Response) => User,
  now: () => Date,
) {
  const status = () => ({
    mode:
      setting(db, 'operating_mode') === 'connected'
        ? 'connected'
        : 'standalone',
    keyConfigured: Boolean(setting(db, 'integration_key_hash')),
    endpoint: '/api/integrations/events',
  });
  app.get('/api/integration', (_request, response) => {
    requireAdmin(response);
    response.json(status());
  });
  app.put('/api/integration', (request, response) => {
    const user = requireAdmin(response);
    const { mode } = z
      .object({ mode: z.enum(['standalone', 'connected']) })
      .strict()
      .parse(request.body);
    db.transaction(() => {
      saveSetting(db, 'operating_mode', mode);
      db.prepare(
        'INSERT INTO security_audit (actor_id, action, timestamp) VALUES (?, ?, ?)',
      ).run(user.id, 'integration_mode:' + mode, now().toISOString());
    })();
    response.json(status());
  });
  app.post('/api/integration/key', (_request, response) => {
    const user = requireAdmin(response);
    const key = 'llk_' + randomBytes(32).toString('hex');
    db.transaction(() => {
      saveSetting(db, 'integration_key_hash', hash(key));
      saveSetting(db, 'integration_actor_id', String(user.id));
      db.prepare(
        'INSERT INTO security_audit (actor_id, action, timestamp) VALUES (?, ?, ?)',
      ).run(user.id, 'integration_key_rotated', now().toISOString());
    })();
    response.status(201).json({ key });
  });
  app.delete('/api/integration/key', (_request, response) => {
    const user = requireAdmin(response);
    db.transaction(() => {
      db.prepare(
        "DELETE FROM settings WHERE key IN ('integration_key_hash', 'integration_actor_id')",
      ).run();
      db.prepare(
        'INSERT INTO security_audit (actor_id, action, timestamp) VALUES (?, ?, ?)',
      ).run(user.id, 'integration_key_revoked', now().toISOString());
    })();
    response.json(status());
  });
}
