import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

const instances: ReturnType<typeof createApp>[] = [];
afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
});
const password = 'Isolated-test-password-2026!';
const specimen = {
  patientName: 'Integration Patient',
  patientId: 'SYNTHETIC-001',
  testName: 'Test assay',
  sampleType: 'Blood',
  facility: 'Test Clinic',
  referringDoctor: 'Test Clinician',
  department: 'Chemistry',
  priority: 'routine',
  collectedAt: '2026-09-25T11:00:00.000Z',
  requestKind: 'clinician',
  contacts: {
    patient: { email: 'patient@example.test', channels: ['email'] },
    clinician: { phone: '+15555550123', channels: ['sms'] },
    transporter: { phone: '+15555550124', channels: ['whatsapp'] },
  },
};

async function initialized() {
  const instance = createApp({
    databasePath: ':memory:',
    production: false,
    now: () => new Date('2026-09-25T12:00:00.000Z'),
    communications: { mode: 'preview' },
  });
  instances.push(instance);
  const admin = request.agent(instance.app);
  const session = await admin.get('/api/auth/session');
  const setup = await admin
    .post('/api/auth/setup')
    .set('X-CSRF-Token', session.body.csrfToken)
    .send({
      name: 'Test Admin',
      email: 'admin@example.test',
      password,
      workspaceName: 'Synthetic Lab',
      timezone: 'UTC',
    });
  expect(setup.status).toBe(201);
  const csrf = setup.body.csrfToken as string;
  const keyResponse = await admin
    .post('/api/integration/key')
    .set('X-CSRF-Token', csrf)
    .send({});
  expect(keyResponse.status).toBe(201);
  const key = keyResponse.body.key as string;
  expect(
    (
      await admin
        .put('/api/integration')
        .set('X-CSRF-Token', csrf)
        .send({ mode: 'connected' })
    ).status,
  ).toBe(200);
  const send = (body: object, token = key) =>
    request(instance.app)
      .post('/api/integrations/events')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const received = {
    source: 'test-lis',
    eventId: 'receive-1',
    externalSampleId: 'EXT-1',
    event: 'received',
    sample: specimen,
  };
  return { ...instance, admin, csrf, key, send, received };
}

describe('Existing laboratory system integration', () => {
  it('imports reception atomically, retries idempotently and keeps secrets hashed', async () => {
    const instance = await initialized();
    const first = await instance.send(instance.received);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      sampleId: expect.any(Number),
      duplicate: false,
    });
    const repeated = await instance.send(instance.received);
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual({
      sampleId: first.body.sampleId,
      duplicate: true,
    });
    expect(
      (
        await instance.send({
          ...instance.received,
          sample: { ...specimen, patientName: 'Altered' },
        })
      ).status,
    ).toBe(409);
    expect(
      instance.database.prepare('SELECT COUNT(*) AS count FROM samples').get(),
    ).toEqual({ count: 1 });
    const rows = instance.database.prepare('SELECT value FROM settings').all();
    expect(JSON.stringify(rows)).not.toContain(instance.key);
    const status = await instance.admin.get('/api/integration');
    expect(status.body).toEqual({
      mode: 'connected',
      keyConfigured: true,
      endpoint: '/api/integrations/events',
    });
    await instance.communications.processPending();
    const outbox = await instance.admin.get('/api/communications');
    expect(outbox.status).toBe(200);
    expect(outbox.body.messages).toHaveLength(3);
    expect(
      outbox.body.messages.every(
        (message: { status: string }) => message.status === 'preview',
      ),
    ).toBe(true);
  });

  it('requires a valid key, rejects disabled mode and invalidates rotated or revoked keys', async () => {
    const instance = await initialized();
    expect((await instance.send(instance.received, 'invalid')).status).toBe(
      401,
    );
    expect(
      (
        await instance.admin
          .post('/api/integrations/events')
          .send(instance.received)
      ).status,
    ).toBe(401);
    expect(
      (await instance.admin.post('/api/integration/key').send({})).status,
    ).toBe(403);
    await instance.admin
      .put('/api/integration')
      .set('X-CSRF-Token', instance.csrf)
      .send({ mode: 'standalone' });
    expect((await instance.send(instance.received)).status).toBe(403);
    await instance.admin
      .put('/api/integration')
      .set('X-CSRF-Token', instance.csrf)
      .send({ mode: 'connected' });
    const rotated = await instance.admin
      .post('/api/integration/key')
      .set('X-CSRF-Token', instance.csrf)
      .send({});
    expect((await instance.send(instance.received)).status).toBe(401);
    expect(
      (await instance.send(instance.received, rotated.body.key)).status,
    ).toBe(201);
    expect(
      (
        await instance.admin
          .delete('/api/integration/key')
          .set('X-CSRF-Token', instance.csrf)
      ).status,
    ).toBe(200);
    expect(
      (await instance.send(instance.received, rotated.body.key)).status,
    ).toBe(401);
  });

  it('imports authorized results with external provenance and no clinical content in patient messages', async () => {
    const instance = await initialized();
    const first = await instance.send(instance.received);
    const event = {
      source: 'test-lis',
      eventId: 'release-1',
      externalSampleId: 'EXT-1',
      event: 'results_available',
      resultSummary: 'PRIVATE-CLINICAL-RESULT',
      releaseConfirmed: true,
    };
    expect(
      (await instance.send({ ...event, releaseConfirmed: false })).status,
    ).toBe(400);
    expect((await instance.send(event)).status).toBe(201);
    const detail = await instance.admin.get(
      `/api/samples/${first.body.sampleId}`,
    );
    expect(detail.body.status).toBe('completed');
    expect(detail.body.resultSummary).toBe('PRIVATE-CLINICAL-RESULT');
    expect(detail.body.qualityChecked).toBe(false);
    expect(detail.body.releasedBy).toContain('External LIS');
    expect(detail.body.patientResultAccess).toBe(false);
    const messages = instance.communications.list();
    expect(
      messages.filter((message) => message.event === 'results_available'),
    ).toHaveLength(3);
    expect(JSON.stringify(messages)).not.toContain('PRIVATE-CLINICAL-RESULT');
    expect(
      (await instance.send({ ...event, eventId: 'duplicate-release' })).status,
    ).toBe(409);
  });

  it('tracks rejected samples and their imported replacements without notifying transporters of rejection', async () => {
    const instance = await initialized();
    const received = await instance.send(instance.received);
    const rejected = await instance.send({
      source: 'test-lis',
      eventId: 'reject-1',
      externalSampleId: 'EXT-1',
      event: 'rejected',
      reason: 'CLINICIAN-ONLY-REASON',
      instructions: 'Arrange a new collection',
    });
    expect(rejected.status).toBe(201);
    const rejectionMessages = instance.communications
      .list()
      .filter((message) => message.event === 'rejected');
    expect(rejectionMessages).toHaveLength(2);
    expect(
      rejectionMessages.find((message) => message.recipient === 'patient')
        ?.message,
    ).not.toContain('CLINICIAN-ONLY-REASON');
    const replacement = await instance.send({
      source: 'test-lis',
      eventId: 'replace-1',
      externalSampleId: 'EXT-2',
      parentExternalSampleId: 'EXT-1',
      event: 'replacement_received',
      collectedAt: '2026-09-25T11:30:00.000Z',
    });
    expect(replacement.status).toBe(201);
    const original = await instance.admin.get(
      `/api/samples/${received.body.sampleId}`,
    );
    const child = await instance.admin.get(
      `/api/samples/${replacement.body.sampleId}`,
    );
    expect(original.body.replacementSampleId).toBe(child.body.id);
    expect(child.body.parentSampleId).toBe(original.body.id);
    expect((await instance.admin.get('/api/followups')).body).toHaveLength(0);
    expect(
      (
        await instance.send({
          source: 'test-lis',
          eventId: 'early-release',
          externalSampleId: 'UNKNOWN',
          event: 'results_available',
          resultSummary: 'Result',
          releaseConfirmed: true,
        })
      ).status,
    ).toBe(404);
  });
});
