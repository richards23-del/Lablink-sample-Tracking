import { afterEach, describe, expect, it, vi } from 'vitest';
import request, { type Response } from 'supertest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Express } from 'express';
import type {
  CreateSampleInput,
  SampleDetail,
  Session,
} from '../shared/types.js';
import { createApp, type AppOptions } from './app.js';

const INITIAL_TIME = '2026-09-22T12:00:00.000Z';
const PASSWORD = 'a-real-test-password-27';
const WORKSPACE = {
  name: 'Test Administrator',
  email: 'admin@example.test',
  password: PASSWORD,
  workspaceName: 'Test Laboratory',
  timezone: 'Africa/Johannesburg',
};
const SAMPLE: CreateSampleInput = {
  patientName: 'Test Patient',
  patientId: 'TEST-001',
  testName: 'Test assay',
  sampleType: 'Test specimen',
  facility: 'Test Facility',
  referringDoctor: 'Test Referrer',
  department: 'Test Department',
  priority: 'routine',
  collectedAt: '2026-09-22T11:00:00.000Z',
};

class Client {
  cookie = '';
  csrf = '';
  constructor(public app: Express) {}
  remember(response: Response) {
    const cookies = response.headers['set-cookie'];
    const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
    if (cookie) this.cookie = cookie.split(';')[0];
    if ('csrfToken' in response.body) this.csrf = response.body.csrfToken ?? '';
    return response;
  }
  async session() {
    return this.remember(await this.get('/api/auth/session'));
  }
  get(path: string) {
    return request(this.app).get(path).set('Cookie', this.cookie);
  }
  async post(path: string, body: object = {}) {
    return this.remember(
      await request(this.app)
        .post(path)
        .set('Cookie', this.cookie)
        .set('X-CSRF-Token', this.csrf)
        .set('Origin', 'http://127.0.0.1:5173')
        .send(body),
    );
  }
  async put(path: string, body: object) {
    return this.remember(
      await request(this.app)
        .put(path)
        .set('Cookie', this.cookie)
        .set('X-CSRF-Token', this.csrf)
        .set('Origin', 'http://127.0.0.1:5173')
        .send(body),
    );
  }
}

const applications = new Set<ReturnType<typeof createApp>>();
const directories: string[] = [];
function backend(options: Partial<AppOptions> = {}) {
  let currentTime = new Date(INITIAL_TIME);
  const instance = createApp({
    databasePath: ':memory:',
    production: false,
    now: () => currentTime,
    ...options,
  });
  applications.add(instance);
  return {
    ...instance,
    setTime: (iso: string) => {
      currentTime = new Date(iso);
    },
    client: () => new Client(instance.app),
    stop: () => {
      instance.close();
      applications.delete(instance);
    },
  };
}
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'lablink-server-test-'));
  directories.push(directory);
  return directory;
}
async function initialized(options: Partial<AppOptions> = {}) {
  const instance = backend(options);
  const admin = instance.client();
  expect((await admin.session()).status).toBe(200);
  const setup = await admin.post('/api/auth/setup', WORKSPACE);
  expect(setup.status).toBe(201);
  return { ...instance, admin, adminUser: (setup.body as Session).user! };
}
async function account(
  app: Express,
  admin: Client,
  role: 'technician' | 'reviewer',
) {
  const email = `${role}@example.test`;
  const created = await admin.post('/api/users', {
    name: `Test ${role}`,
    email,
    password: PASSWORD,
    role,
  });
  expect(created.status).toBe(201);
  const client = new Client(app);
  await client.session();
  const login = await client.post('/api/auth/login', {
    email,
    password: PASSWORD,
  });
  expect(login.status).toBe(200);
  return client;
}
async function createSample(
  client: Client,
  input: Partial<CreateSampleInput> = {},
): Promise<SampleDetail> {
  const response = await client.post('/api/samples', { ...SAMPLE, ...input });
  expect(response.status).toBe(201);
  return response.body as SampleDetail;
}

afterEach(() => {
  for (const instance of applications) instance.close();
  applications.clear();
  for (const directory of directories.splice(0)) {
    // Each cleanup target is an exact directory created by this test in the system temporary directory.
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !directory.includes('lablink-server-test-')
    )
      throw new Error('Unexpected temporary directory.');
    rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('authentication and request boundaries', () => {
  it('starts empty, requires authentication and sets protected sessions with hashed credentials', async () => {
    const instance = backend();
    const client = instance.client();
    expect((await client.get('/api/samples')).status).toBe(401);
    const session = await client.session();
    expect(session.body).toMatchObject({
      user: null,
      setupRequired: true,
      setupAllowed: true,
    });
    expect(session.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(session.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(session.headers['set-cookie'][0]).toContain('SameSite=Strict');
    const firstCookie = client.cookie;
    const setup = await client.post('/api/auth/setup', WORKSPACE);
    expect(setup.status).toBe(201);
    expect(setup.body).toMatchObject({
      setupRequired: false,
      user: { name: WORKSPACE.name, role: 'admin' },
    });
    expect(client.cookie).not.toBe(firstCookie);
    expect((await client.get('/api/samples')).body).toMatchObject({
      items: [],
      total: 0,
    });
    const passwordRecord = instance.database
      .prepare('SELECT password_hash FROM users')
      .get() as { password_hash: string };
    expect(passwordRecord.password_hash).not.toContain(PASSWORD);
    expect(passwordRecord.password_hash).toMatch(
      /^[a-f0-9]{32}:[a-f0-9]{128}$/,
    );
    const tokenRecord = instance.database
      .prepare('SELECT token_hash FROM sessions WHERE user_id IS NOT NULL')
      .get() as { token_hash: string };
    expect(tokenRecord.token_hash).not.toBe(client.cookie.split('=')[1]);
    expect((await client.post('/api/auth/setup', WORKSPACE)).status).toBe(409);
  });

  it('requires CSRF tokens and trusted origins for setup and every mutation', async () => {
    const instance = backend();
    const client = instance.client();
    await client.session();
    expect(
      (
        await request(instance.app)
          .post('/api/auth/setup')
          .set('Cookie', client.cookie)
          .send(WORKSPACE)
      ).body.code,
    ).toBe('CSRF_REJECTED');
    const rejected = await request(instance.app)
      .post('/api/auth/setup')
      .set('Cookie', client.cookie)
      .set('X-CSRF-Token', client.csrf)
      .set('Origin', 'https://untrusted.example')
      .send(WORKSPACE);
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe('ORIGIN_REJECTED');
    expect((await client.post('/api/auth/setup', WORKSPACE)).status).toBe(201);
    expect(
      (
        await request(instance.app)
          .post('/api/samples')
          .set('Cookie', client.cookie)
          .set('X-CSRF-Token', 'invalid')
          .send(SAMPLE)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(instance.app)
          .post('/api/samples')
          .set('Cookie', client.cookie)
          .set('X-CSRF-Token', client.csrf)
          .set('Sec-Fetch-Site', 'cross-site')
          .send(SAMPLE)
      ).status,
    ).toBe(403);
    expect((await client.get('/api/samples')).headers['cache-control']).toBe(
      'no-store',
    );
  });

  it('lets portal users self-register but never grants laboratory staff roles', async () => {
    const instance = await initialized();
    const patient = instance.client();
    await patient.session();
    const registered = await patient.post('/api/auth/register', {
      name: 'Self registered patient',
      email: 'patient-register@example.test',
      password: PASSWORD,
      role: 'patient',
    });
    expect(registered.status).toBe(201);
    expect(registered.body).toMatchObject({
      user: {
        name: 'Self registered patient',
        email: 'patient-register@example.test',
        role: 'patient',
      },
    });
    expect(
      instance.database
        .prepare('SELECT action FROM security_audit WHERE subject_id = ?')
        .all(registered.body.user.id),
    ).toContainEqual({ action: 'portal_self_registered:patient' });
    expect(
      (
        await patient.post('/api/auth/register', {
          name: 'Self registered patient',
          email: 'patient-register@example.test',
          password: PASSWORD,
          role: 'patient',
        })
      ).body.code,
    ).toBe('EMAIL_EXISTS');
    const other = instance.client();
    await other.session();
    for (const role of ['admin', 'technician', 'reviewer']) {
      const response = await other.post('/api/auth/register', {
        name: `Forged ${role}`,
        email: `${role}-register@example.test`,
        password: PASSWORD,
        role,
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('does not permit portal registration before the first administrator exists', async () => {
    const instance = backend();
    const client = instance.client();
    await client.session();
    const response = await client.post('/api/auth/register', {
      name: 'Uninitialized patient',
      email: 'uninitialized@example.test',
      password: PASSWORD,
      role: 'patient',
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('SETUP_REQUIRED');
  });

  it('disables browser setup in production and serves built routes without falling back for API paths', async () => {
    const directory = temporaryDirectory();
    writeFileSync(
      join(directory, 'index.html'),
      '<html>Test application</html>',
    );
    const instance = backend({
      production: true,
      staticDirectory: directory,
      allowedOrigins: ['https://lab.example'],
    });
    const client = instance.client();
    const session = await client.session();
    expect(session.body.setupAllowed).toBe(false);
    expect(session.headers['set-cookie'][0]).toContain('Secure');
    const setup = await request(instance.app)
      .post('/api/auth/setup')
      .set('Cookie', client.cookie)
      .set('X-CSRF-Token', client.csrf)
      .set('Origin', 'https://lab.example')
      .send(WORKSPACE);
    expect(setup.status).toBe(403);
    expect(setup.body.code).toBe('SETUP_DISABLED');
    const page = await client.get('/samples/123');
    expect(page.text).toContain('Test application');
    expect(page.headers['content-security-policy']).toContain(
      "script-src 'self'",
    );
    const api = await client.get('/api/missing');
    expect(api.headers['content-type']).toContain('application/json');
    expect(api.text).not.toContain('<html>');
  });

  it('rotates sessions on sign-in, invalidates logout and expires sessions', async () => {
    const instance = await initialized();
    const previousCookie = instance.admin.cookie;
    expect(
      (await instance.admin.post('/api/auth/logout')).body.user,
    ).toBeNull();
    expect(
      (
        await request(instance.app)
          .get('/api/samples')
          .set('Cookie', previousCookie)
      ).status,
    ).toBe(401);
    expect(
      (
        await instance.admin.post('/api/auth/login', {
          email: 'ADMIN@EXAMPLE.TEST',
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
    expect(instance.admin.cookie).not.toBe(previousCookie);
    instance.setTime('2026-09-23T01:00:00.000Z');
    expect((await instance.admin.get('/api/samples')).status).toBe(401);
    expect((await instance.admin.session()).body.user).toBeNull();
  });

  it('limits failed login attempts and allows a later retry without revealing account existence', async () => {
    const instance = await initialized({ loginMaxAttempts: 3 });
    const client = instance.client();
    await client.session();
    for (let attempt = 0; attempt < 3; attempt++) {
      const failure = await client.post('/api/auth/login', {
        email: WORKSPACE.email,
        password: 'wrong-password',
      });
      expect(failure.status).toBe(401);
      expect(failure.body.message).toBe('Email or password is incorrect.');
    }
    const limit = await client.post('/api/auth/login', {
      email: WORKSPACE.email,
      password: PASSWORD,
    });
    expect(limit.status).toBe(429);
    expect(limit.headers['retry-after']).toBe('900');
    instance.setTime('2026-09-22T12:16:00.000Z');
    expect(
      (
        await client.post('/api/auth/login', {
          email: WORKSPACE.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
  });

  it('enforces administrator account management and strict input validation', async () => {
    const instance = await initialized();
    const technician = await account(
      instance.app,
      instance.admin,
      'technician',
    );
    expect((await technician.get('/api/users')).status).toBe(403);
    expect(
      (
        await technician.post('/api/users', {
          name: 'Attacker',
          email: 'other@example.test',
          password: PASSWORD,
          role: 'admin',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await instance.admin.post('/api/users', {
          name: 'Duplicate',
          email: 'TECHNICIAN@EXAMPLE.TEST',
          password: PASSWORD,
          role: 'reviewer',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await instance.admin.post('/api/users', {
          name: 'Invalid',
          email: 'invalid',
          password: 'short',
          role: 'admin',
        })
      ).status,
    ).toBe(400);
    const users = await instance.admin.get('/api/users');
    expect(users.body).toHaveLength(2);
    expect(JSON.stringify(users.body)).not.toContain('password');
    expect((await instance.admin.get('/api/not-a-route')).status).toBe(404);
  });

  it('allows repeated successful sign-ins without consuming the failed-attempt limit', async () => {
    const instance = await initialized({ loginMaxAttempts: 3 });
    const client = instance.client();
    await client.session();
    for (let attempt = 0; attempt < 12; attempt++) {
      expect(
        (
          await client.post('/api/auth/login', {
            email: WORKSPACE.email,
            password: PASSWORD,
          })
        ).status,
      ).toBe(200);
      expect((await client.post('/api/auth/logout')).status).toBe(200);
    }
    for (let failure = 0; failure < 3; failure++) {
      expect(
        (
          await client.post('/api/auth/login', {
            email: 'missing@example.test',
            password: 'wrong-password',
          })
        ).status,
      ).toBe(401);
    }
    expect(
      (
        await client.post('/api/auth/login', {
          email: WORKSPACE.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(429);
  });
});

describe('specimen lifecycle and audit integrity', () => {
  it('validates sample fields, timestamps, identifiers and bounded pagination', async () => {
    const instance = await initialized();
    for (const patch of [
      { patientName: ' ' },
      { patientId: 'x'.repeat(81) },
      { patientName: 'x'.repeat(161) },
      { priority: 'invalid' },
      { collectedAt: 'not-a-date' },
      { collectedAt: '2026-09-22T12:00:00+99:99' },
      { collectedAt: '2026-09-23T00:00:00.000Z' },
      { status: 'completed' },
    ])
      expect(
        (await instance.admin.post('/api/samples', { ...SAMPLE, ...patch }))
          .status,
      ).toBe(400);
    for (const id of ['0', '-1', '1.2', 'abc', '9007199254740992'])
      expect((await instance.admin.get(`/api/samples/${id}`)).status).toBe(400);
    for (const query of [
      'page=0',
      'pageSize=101',
      'status=invalid',
      'search=' + 'x'.repeat(201),
      'page=1&page=2',
    ])
      expect((await instance.admin.get(`/api/samples?${query}`)).status).toBe(
        400,
      );
    expect((await instance.admin.get('/api/samples/1')).status).toBe(404);
    const sample = await createSample(instance.admin, {
      patientName: '  Test Patient  ',
    });
    expect(sample.patientName).toBe('Test Patient');
    expect(sample.receivedAt).toBe(INITIAL_TIME);
    expect(sample.dueAt).toBe('2026-09-23T12:00:00.000Z');
    expect(sample.timeline[0]).toMatchObject({
      label: 'Sample received',
      actor: WORKSPACE.name,
      timestamp: INITIAL_TIME,
    });
  });

  it('requires processing, recorded results, quality checks and authorized confirmed release', async () => {
    const instance = await initialized();
    const technician = await account(
      instance.app,
      instance.admin,
      'technician',
    );
    const reviewer = await account(instance.app, instance.admin, 'reviewer');
    expect((await reviewer.post('/api/samples', SAMPLE)).status).toBe(403);
    let sample = await createSample(technician);
    const transition = `/api/samples/${sample.id}/transition`;
    expect(
      (
        await reviewer.post(transition, {
          version: sample.version,
          action: 'start_processing',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await technician.post(transition, {
          version: sample.version,
          action: 'submit_verification',
          resultSummary: 'Test result recorded.',
          qualityChecked: true,
        })
      ).status,
    ).toBe(409);
    sample = (
      await technician.post(transition, {
        version: sample.version,
        action: 'start_processing',
      })
    ).body;
    expect(sample.status).toBe('processing');
    expect(
      (
        await technician.post(transition, {
          version: sample.version,
          action: 'submit_verification',
          resultSummary: 'Test result recorded.',
          qualityChecked: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await technician.post(transition, {
          version: sample.version,
          action: 'submit_verification',
          qualityChecked: true,
        })
      ).status,
    ).toBe(400);
    sample = (
      await technician.post(transition, {
        version: sample.version,
        action: 'submit_verification',
        resultSummary: 'Test result recorded.',
        qualityChecked: true,
      })
    ).body;
    expect(sample).toMatchObject({
      status: 'verification',
      resultSummary: 'Test result recorded.',
      qualityChecked: true,
      resultEnteredBy: 'Test technician',
    });
    expect(sample.allowedActions).not.toContain('release');
    expect(
      (
        await technician.post(transition, {
          version: sample.version,
          action: 'release',
          releaseConfirmed: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await reviewer.post(transition, {
          version: sample.version,
          action: 'release',
        })
      ).status,
    ).toBe(400);
    expect(
      (await reviewer.get(`/api/samples/${sample.id}`)).body.allowedActions,
    ).toContain('release');
    const released = await reviewer.post(transition, {
      version: sample.version,
      action: 'release',
      releaseConfirmed: true,
    });
    expect(released.status).toBe(200);
    sample = released.body;
    expect(sample).toMatchObject({
      status: 'completed',
      completedAt: INITIAL_TIME,
      releasedBy: 'Test reviewer',
      allowedActions: [],
    });
    expect(sample.timeline.map((event) => event.label)).toEqual([
      'Sample received',
      'Processing started',
      'Submitted for verification',
      'Result released',
    ]);
    expect(
      (
        await instance.admin.post(transition, {
          version: sample.version,
          action: 'start_processing',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await instance.admin.post(`/api/samples/${sample.id}/recollection`, {
          version: sample.version,
          reason: 'Test reason',
          instructions: 'Test instructions',
        })
      ).status,
    ).toBe(409);
  });

  it('rejects competing transitions with a version conflict and records the action once', async () => {
    const instance = await initialized();
    const sample = await createSample(instance.admin);
    const results = await Promise.all([
      instance.admin.post(`/api/samples/${sample.id}/transition`, {
        version: sample.version,
        action: 'start_processing',
      }),
      instance.admin.post(`/api/samples/${sample.id}/transition`, {
        version: sample.version,
        action: 'start_processing',
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)!.body.code).toBe(
      'VERSION_CONFLICT',
    );
    const final = (await instance.admin.get(`/api/samples/${sample.id}`))
      .body as SampleDetail;
    expect(final.version).toBe(2);
    expect(
      final.timeline.filter((event) => event.label === 'Processing started'),
    ).toHaveLength(1);
  });

  it('rolls back state changes if their audit event cannot be saved', async () => {
    const instance = await initialized();
    const sample = await createSample(instance.admin);
    instance.database.exec(
      "CREATE TRIGGER reject_processing_audit BEFORE INSERT ON audit_events WHEN NEW.label = 'Processing started' BEGIN SELECT RAISE(ABORT, 'Test failure'); END;",
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      (
        await instance.admin.post(`/api/samples/${sample.id}/transition`, {
          version: sample.version,
          action: 'start_processing',
        })
      ).status,
    ).toBe(500);
    const final = (await instance.admin.get(`/api/samples/${sample.id}`))
      .body as SampleDetail;
    expect(final).toMatchObject({ version: 1, status: 'received' });
    expect(final.timeline).toHaveLength(1);
  });

  it('appends concurrent notes with actual authenticated authors and rejects fabricated metadata', async () => {
    const instance = await initialized();
    const technician = await account(
      instance.app,
      instance.admin,
      'technician',
    );
    const sample = await createSample(instance.admin);
    expect(
      (
        await technician.post(`/api/samples/${sample.id}/notes`, {
          text: 'Test note',
          author: 'Fabricated person',
        })
      ).status,
    ).toBe(400);
    const results = await Promise.all([
      instance.admin.post(`/api/samples/${sample.id}/notes`, {
        text: 'Administrator test note',
      }),
      technician.post(`/api/samples/${sample.id}/notes`, {
        text: 'Technician test note',
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    const final = (await instance.admin.get(`/api/samples/${sample.id}`))
      .body as SampleDetail;
    expect(final.version).toBe(3);
    expect(final.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          author: WORKSPACE.name,
          text: 'Administrator test note',
          createdAt: INITIAL_TIME,
        }),
        expect.objectContaining({
          author: 'Test technician',
          text: 'Technician test note',
          createdAt: INITIAL_TIME,
        }),
      ]),
    );
    expect(new Set(final.notes.map((note) => note.id)).size).toBe(2);
    expect(
      (
        await instance.admin.post(`/api/samples/${sample.id}/transition`, {
          version: sample.version,
          action: 'start_processing',
        })
      ).status,
    ).toBe(409);
  });

  it('keeps recollection history, persistent acknowledgement and exactly one linked replacement', async () => {
    const instance = await initialized();
    const technician = await account(
      instance.app,
      instance.admin,
      'technician',
    );
    const reviewer = await account(instance.app, instance.admin, 'reviewer');
    let sample = await createSample(technician);
    const originalId = sample.id;
    sample = (
      await technician.post(`/api/samples/${originalId}/recollection`, {
        version: sample.version,
        reason: 'Test specimen issue',
        instructions: 'Collect a replacement test specimen',
      })
    ).body;
    expect(sample).toMatchObject({
      status: 'recollection',
      hasAlert: true,
      recollectionReason: 'Test specimen issue',
    });
    expect(sample.allowedActions).toEqual(['register_replacement']);
    const [alert] = (await technician.get('/api/alerts')).body;
    const acknowledgement = await technician.post(
      `/api/alerts/${alert.id}/acknowledge`,
    );
    expect(acknowledgement.body).toMatchObject({
      acknowledged: true,
      acknowledgedBy: 'Test technician',
      acknowledgedAt: INITIAL_TIME,
      resolved: false,
    });
    expect(
      (await technician.get(`/api/samples/${originalId}`)).body.hasAlert,
    ).toBe(true);
    expect(
      (
        await technician.post(`/api/samples/${originalId}/transition`, {
          version: sample.version,
          action: 'start_processing',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await technician.post(`/api/alerts/${alert.id}/resolve`, {
          resolution: 'Reviewed test issue',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await reviewer.post(`/api/alerts/${alert.id}/resolve`, {
          resolution: 'Reviewed test issue',
        })
      ).body.code,
    ).toBe('REPLACEMENT_REQUIRED');
    const replaced = await technician.post(
      `/api/samples/${originalId}/replacement`,
      { version: sample.version, collectedAt: INITIAL_TIME },
    );
    expect(replaced.status).toBe(201);
    const replacement = replaced.body as SampleDetail;
    expect(replacement).toMatchObject({
      parentSampleId: originalId,
      status: 'received',
      resultSummary: null,
    });
    expect(replacement.id).not.toBe(originalId);
    const original = (await technician.get(`/api/samples/${originalId}`))
      .body as SampleDetail;
    expect(original).toMatchObject({
      status: 'recollection',
      replacementSampleId: replacement.id,
      allowedActions: [],
      hasAlert: false,
    });
    expect(
      original.timeline.some(
        (event) => event.label === 'Replacement sample registered',
      ),
    ).toBe(true);
    expect((await technician.get('/api/alerts')).body[0]).toMatchObject({
      acknowledged: true,
      resolved: true,
    });
    expect(
      (
        await technician.post(`/api/samples/${originalId}/replacement`, {
          version: original.version,
          collectedAt: INITIAL_TIME,
        })
      ).status,
    ).toBe(409);
    expect((await technician.get('/api/samples')).body.total).toBe(2);
  });

  it('requires resolution of blocking alerts even after acknowledgement', async () => {
    const instance = await initialized();
    const sample = await createSample(instance.admin);
    const alertId = Number(
      instance.database
        .prepare(
          'INSERT INTO alerts (sample_id, kind, severity, title, description, blocking, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          sample.id,
          'test_quality',
          'critical',
          'Test quality issue',
          'Test blocking condition',
          1,
          INITIAL_TIME,
        ).lastInsertRowid,
    );
    await instance.admin.post(`/api/alerts/${alertId}/acknowledge`);
    const blocked = await instance.admin.post(
      `/api/samples/${sample.id}/transition`,
      { version: sample.version, action: 'start_processing' },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('BLOCKING_ALERT');
    expect(
      (await instance.admin.get(`/api/samples/${sample.id}`)).body
        .allowedActions,
    ).not.toContain('start_processing');
    expect(
      (
        await instance.admin.post(`/api/alerts/${alertId}/resolve`, {
          resolution: 'Test quality issue corrected and reviewed',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await instance.admin.post(`/api/samples/${sample.id}/transition`, {
          version: sample.version,
          action: 'start_processing',
        })
      ).status,
    ).toBe(200);
  });
});

describe('persistence, notifications and operational summaries', () => {
  it('paginates matching rows by most recent update and supports literal Unicode search', async () => {
    const instance = await initialized();
    const first = await createSample(instance.admin, {
      patientName: 'Élodie Test',
      patientId: 'PERCENT_%',
    });
    const second = await createSample(instance.admin, {
      patientName: 'Another Test',
    });
    expect(
      (await instance.admin.get('/api/samples?pageSize=1')).body.items[0].id,
    ).toBe(second.id);
    instance.setTime('2026-09-22T12:01:00.000Z');
    await instance.admin.post(`/api/samples/${first.id}/notes`, {
      text: 'A later update',
    });
    const page = (await instance.admin.get('/api/samples?pageSize=1')).body;
    expect(page).toMatchObject({ total: 2, pageSize: 1 });
    expect(page.items[0].id).toBe(first.id);
    expect(
      (await instance.admin.get('/api/samples?pageSize=1&page=2')).body.items[0]
        .id,
    ).toBe(second.id);
    expect(
      (
        await instance.admin.get(
          '/api/samples?search=' + encodeURIComponent('élodie'),
        )
      ).body.total,
    ).toBe(1);
    expect(
      (
        await instance.admin.get(
          '/api/samples?search=' + encodeURIComponent('_%'),
        )
      ).body.total,
    ).toBe(1);
    expect(
      (
        await instance.admin.get(
          '/api/samples?search=' + encodeURIComponent("' OR 1=1 --"),
        )
      ).body.total,
    ).toBe(0);
  });

  it('calculates turnaround compliance from results completed today in the workspace timezone', async () => {
    const instance = await initialized();
    async function prepare(sample: SampleDetail) {
      const processing = await instance.admin.post(
        `/api/samples/${sample.id}/transition`,
        { version: sample.version, action: 'start_processing' },
      );
      return (
        await instance.admin.post(`/api/samples/${sample.id}/transition`, {
          version: processing.body.version,
          action: 'submit_verification',
          resultSummary: 'Test result',
          qualityChecked: true,
        })
      ).body as SampleDetail;
    }
    const yesterday = await prepare(await createSample(instance.admin));
    expect(
      (
        await instance.admin.post(`/api/samples/${yesterday.id}/transition`, {
          version: yesterday.version,
          action: 'release',
          releaseConfirmed: true,
        })
      ).status,
    ).toBe(200);
    instance.setTime('2026-09-22T22:30:00.000Z');
    const today = await prepare(
      await createSample(instance.admin, { priority: 'urgent' }),
    );
    instance.setTime('2026-09-23T01:00:00.000Z');
    await instance.admin.session();
    await instance.admin.post('/api/auth/login', {
      email: WORKSPACE.email,
      password: PASSWORD,
    });
    expect(
      (
        await instance.admin.post(`/api/samples/${today.id}/transition`, {
          version: today.version,
          action: 'release',
          releaseConfirmed: true,
        })
      ).status,
    ).toBe(200);
    const dashboard = (await instance.admin.get('/api/dashboard')).body;
    expect(dashboard).toMatchObject({ completedToday: 1, turnaroundRate: 0 });
    expect(dashboard.weeklyVolume[6]).toMatchObject({
      date: '2026-09-23',
      completed: 1,
    });
  });

  it('uses the delays preference for recollection notifications independently of urgent intake', async () => {
    const instance = await initialized();
    await instance.admin.put('/api/preferences', {
      urgent: false,
      delays: true,
      verification: false,
    });
    const first = await createSample(instance.admin);
    expect(
      (
        await instance.admin.post(`/api/samples/${first.id}/recollection`, {
          version: first.version,
          reason: 'Test collection issue',
          instructions: 'Collect again',
        })
      ).status,
    ).toBe(200);
    expect((await instance.admin.get('/api/notifications')).body).toHaveLength(
      1,
    );
    await instance.admin.put('/api/preferences', {
      urgent: true,
      delays: false,
      verification: false,
    });
    const second = await createSample(instance.admin);
    expect(
      (
        await instance.admin.post(`/api/samples/${second.id}/recollection`, {
          version: second.version,
          reason: 'Another test issue',
          instructions: 'Collect again',
        })
      ).status,
    ).toBe(200);
    const notifications = (await instance.admin.get('/api/notifications')).body;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Recollection required');
  });

  it('persists identities, preferences, notes, sessions and acknowledgement through a database reopen', async () => {
    const directory = temporaryDirectory();
    const filename = join(directory, 'lablink.sqlite');
    const first = await initialized({ databasePath: filename });
    const sample = await createSample(first.admin);
    await first.admin.put('/api/preferences', {
      urgent: false,
      delays: true,
      verification: false,
    });
    await first.admin.post(`/api/samples/${sample.id}/notes`, {
      text: 'Persisted test note',
    });
    await first.admin.post(`/api/samples/${sample.id}/recollection`, {
      version: 2,
      reason: 'Test issue',
      instructions: 'Test replacement instruction',
    });
    const alert = (await first.admin.get('/api/alerts')).body[0];
    await first.admin.post(`/api/alerts/${alert.id}/acknowledge`);
    const cookie = first.admin.cookie;
    first.stop();
    const second = backend({ databasePath: filename });
    const client = second.client();
    client.cookie = cookie;
    expect((await client.session()).body.user.name).toBe(WORKSPACE.name);
    expect((await client.get('/api/preferences')).body).toEqual({
      urgent: false,
      delays: true,
      verification: false,
    });
    const restored = (await client.get(`/api/samples/${sample.id}`))
      .body as SampleDetail;
    expect(restored.notes[0]).toMatchObject({
      text: 'Persisted test note',
      author: WORKSPACE.name,
    });
    expect(restored.status).toBe('recollection');
    expect(
      restored.timeline.some((event) => event.label === 'Alert acknowledged'),
    ).toBe(true);
    expect((await client.get('/api/alerts')).body[0].acknowledged).toBe(true);
    expect(readFileSync(filename).length).toBeGreaterThan(0);
  });

  it('applies each preference to future in-app events and isolates notification read state', async () => {
    const instance = await initialized();
    const technician = await account(
      instance.app,
      instance.admin,
      'technician',
    );
    await technician.put('/api/preferences', {
      urgent: false,
      delays: false,
      verification: false,
    });
    let sample = await createSample(instance.admin, { priority: 'urgent' });
    sample = (
      await instance.admin.post(`/api/samples/${sample.id}/transition`, {
        version: sample.version,
        action: 'start_processing',
      })
    ).body;
    sample = (
      await instance.admin.post(`/api/samples/${sample.id}/transition`, {
        version: sample.version,
        action: 'submit_verification',
        resultSummary: 'Test result',
        qualityChecked: true,
      })
    ).body;
    instance.setTime('2026-09-22T15:00:00.000Z');
    const adminNotifications = (await instance.admin.get('/api/notifications'))
      .body;
    expect(
      adminNotifications.map(
        (notification: { title: string }) => notification.title,
      ),
    ).toEqual(
      expect.arrayContaining([
        'Urgent sample received',
        'Result awaiting verification',
        'Turnaround target exceeded',
      ]),
    );
    expect((await technician.get('/api/notifications')).body).toEqual([]);
    expect(
      (
        await technician.post(
          `/api/notifications/${adminNotifications[0].id}/read`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await instance.admin.post(
          `/api/notifications/${adminNotifications[0].id}/read`,
        )
      ).body.read,
    ).toBe(true);
    await technician.put('/api/preferences', {
      urgent: true,
      delays: false,
      verification: false,
    });
    await createSample(instance.admin, { priority: 'urgent' });
    const next = (await technician.get('/api/notifications')).body;
    expect(next).toHaveLength(1);
    expect(next[0].title).toBe('Urgent sample received');
    expect((await instance.admin.get('/api/preferences')).body).toEqual({
      urgent: true,
      delays: true,
      verification: true,
    });
  });

  it('creates overdue alerts once and preserves actual workflow stages in the delayed filter', async () => {
    const instance = await initialized();
    const sample = await createSample(instance.admin, { priority: 'urgent' });
    instance.setTime('2026-09-22T15:00:00.000Z');
    const delayed = await instance.admin.get('/api/samples?status=delayed');
    expect(delayed.body.items[0]).toMatchObject({
      id: sample.id,
      status: 'received',
      hasAlert: true,
    });
    const alert = (await instance.admin.get('/api/alerts')).body[0];
    expect(
      (
        await instance.admin.post(`/api/alerts/${alert.id}/resolve`, {
          resolution: 'Test delay reviewed',
        })
      ).status,
    ).toBe(200);
    const alerts = (await instance.admin.get('/api/alerts')).body;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].resolved).toBe(true);
    expect((await instance.admin.get('/api/dashboard')).body.delayed).toBe(1);
    expect(
      (await instance.admin.get('/api/notifications')).body.filter(
        (item: { title: string }) =>
          item.title === 'Turnaround target exceeded',
      ),
    ).toHaveLength(1);
  });

  it('keeps older unread notifications visible instead of silently truncating them', async () => {
    const instance = await initialized();
    const insert = instance.database.prepare(
      'INSERT INTO notifications (user_id, sample_id, kind, title, message, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
    );
    instance.database.transaction(() => {
      for (let index = 0; index < 205; index++)
        insert.run(
          instance.adminUser.id,
          'sample',
          `Test notification ${index}`,
          'Test event',
          INITIAL_TIME,
        );
    })();
    const notifications = (await instance.admin.get('/api/notifications')).body;
    expect(notifications).toHaveLength(205);
    expect(notifications[204]).toMatchObject({
      title: 'Test notification 0',
      read: false,
    });
    expect(
      (
        await instance.admin.post(
          `/api/notifications/${notifications[204].id}/read`,
        )
      ).body.read,
    ).toBe(true);
  });

  it('returns finite empty charts and counts days in the workspace timezone', async () => {
    const instance = await initialized();
    const empty = (await instance.admin.get('/api/dashboard')).body;
    expect(empty.turnaroundRate).toBe(0);
    expect(empty.weeklyVolume).toHaveLength(7);
    expect(
      empty.statusBreakdown.every(
        (item: { count: number }) => item.count === 0,
      ),
    ).toBe(true);
    instance.setTime('2026-09-22T22:30:00.000Z');
    await createSample(instance.admin);
    const dashboard = (await instance.admin.get('/api/dashboard')).body;
    expect(dashboard.receivedToday).toBe(1);
    expect(dashboard.weeklyVolume[6]).toMatchObject({
      date: '2026-09-23',
      received: 1,
    });
    expect(
      (
        await instance.admin.get(
          '/api/samples?search=test-001&priority=routine&pageSize=1',
        )
      ).body.total,
    ).toBe(1);
    expect(
      (await instance.admin.get('/api/samples?search=does-not-exist')).body
        .total,
    ).toBe(0);
  });
});
