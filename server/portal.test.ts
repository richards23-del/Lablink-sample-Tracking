import { afterEach, describe, expect, it, vi } from 'vitest';
import request, { type Response } from 'supertest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Express } from 'express';
import type {
  CreateSampleInput,
  Role,
  SampleDetail,
  User,
} from '../shared/types.js';
import { createApp, type AppOptions } from './app.js';

const PASSWORD = 'portal-integration-test-password';
const NOW = '2026-09-27T12:00:00.000Z';
const SAMPLE: CreateSampleInput = {
  patientName: 'Confidential Patient',
  patientId: 'PRIVATE-123',
  testName: 'Sensitive assay',
  sampleType: 'Specimen tube',
  facility: 'Collection facility',
  referringDoctor: 'Referring doctor',
  department: 'Private department',
  priority: 'routine',
  collectedAt: '2026-09-27T11:00:00.000Z',
};

class Client {
  cookie = '';
  csrf = '';
  user!: User;
  email = '';
  constructor(public app: Express) {}
  remember(response: Response) {
    const cookies = response.headers['set-cookie'];
    const cookie = Array.isArray(cookies) ? cookies[0] : cookies;
    if (cookie) this.cookie = cookie.split(';')[0];
    if ('csrfToken' in response.body) this.csrf = response.body.csrfToken ?? '';
    if (response.body.user) this.user = response.body.user;
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
  async login() {
    await this.session();
    expect(
      (
        await this.post('/api/auth/login', {
          email: this.email,
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
  }
}
const applications = new Set<ReturnType<typeof createApp>>();
const directories: string[] = [];
function backend(options: Partial<AppOptions> = {}) {
  let now = new Date(NOW);
  const instance = createApp({
    databasePath: ':memory:',
    production: false,
    communications: { mode: 'preview' },
    now: () => now,
    ...options,
  });
  applications.add(instance);
  return {
    ...instance,
    setTime: (timestamp: string) => {
      now = new Date(timestamp);
    },
    stop: () => {
      instance.close();
      applications.delete(instance);
    },
  };
}
async function initialized(options: Partial<AppOptions> = {}) {
  const instance = backend(options);
  const admin = new Client(instance.app);
  admin.email = 'admin@portal.test';
  await admin.session();
  expect(
    (
      await admin.post('/api/auth/setup', {
        name: 'Test admin',
        email: admin.email,
        password: PASSWORD,
        workspaceName: 'Portal tests',
        timezone: 'Africa/Johannesburg',
      })
    ).status,
  ).toBe(201);
  const account = async (role: Role, suffix = '') => {
    const email = `${role}${suffix}@portal.test`;
    const created = await admin.post('/api/users', {
      role,
      email,
      name: `Test ${role}${suffix}`,
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
    const client = new Client(instance.app);
    client.email = email;
    await client.login();
    return client;
  };
  const create = async (patch: Partial<CreateSampleInput> = {}) => {
    const response = await admin.post('/api/samples', { ...SAMPLE, ...patch });
    expect(response.status).toBe(201);
    return response.body as SampleDetail;
  };
  const release = async (sample: SampleDetail) => {
    const processing = await admin.post(
      `/api/samples/${sample.id}/transition`,
      { version: sample.version, action: 'start_processing' },
    );
    expect(processing.status).toBe(200);
    const verification = await admin.post(
      `/api/samples/${sample.id}/transition`,
      {
        version: processing.body.version,
        action: 'submit_verification',
        resultSummary: 'STRICTLY PRIVATE RELEASED RESULT',
        qualityChecked: true,
      },
    );
    expect(verification.status).toBe(200);
    const completed = await admin.post(`/api/samples/${sample.id}/transition`, {
      version: verification.body.version,
      action: 'release',
      releaseConfirmed: true,
    });
    expect(completed.status).toBe(200);
    return completed.body as SampleDetail;
  };
  return { ...instance, admin, account, create, release };
}
function contact(client: Client) {
  return {
    name: client.user.name,
    email: client.email,
    channels: [] as [],
    portalUserId: client.user.id,
  };
}

afterEach(() => {
  for (const app of applications) app.close();
  applications.clear();
  for (const directory of directories.splice(0)) {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !directory.includes('lablink-portal-test-')
    )
      throw new Error('Unexpected temporary test directory.');
    rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('portal authorization and privacy', () => {
  it('scopes every external role by explicit assignment and never infers access from names or email', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const clinician = await instance.account('clinician');
    const transporter = await instance.account('transporter');
    const otherPatient = await instance.account('patient', '2');
    const assigned = await instance.create({
      contacts: {
        patient: contact(patient),
        clinician: contact(clinician),
        transporter: contact(transporter),
      },
    });
    const unassigned = await instance.create({
      patientName: patient.user.name,
      contacts: {
        patient: {
          name: patient.user.name,
          email: patient.email,
          channels: [],
        },
      },
    });
    for (const client of [patient, clinician, transporter]) {
      const listing = await client.get('/api/samples');
      expect(listing.status).toBe(200);
      expect(listing.body.total).toBe(1);
      expect(listing.body.items[0].id).toBe(assigned.id);
      expect((await client.get(`/api/samples/${unassigned.id}`)).status).toBe(
        404,
      );
      expect((await client.get(`/api/samples/${assigned.id}`)).status).toBe(
        200,
      );
      expect(
        (await client.get('/api/samples?search=PRIVATE-123')).body.total,
      ).toBe(client === transporter ? 0 : 1);
    }
    expect((await otherPatient.get('/api/samples')).body.total).toBe(0);
    expect((await otherPatient.get(`/api/samples/${assigned.id}`)).status).toBe(
      404,
    );
  });

  it('blocks external access to staff pages, account directories and every clinical mutation', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const clinician = await instance.account('clinician');
    const transporter = await instance.account('transporter');
    const sample = await instance.create({
      contacts: {
        patient: contact(patient),
        clinician: contact(clinician),
        transporter: contact(transporter),
      },
    });
    for (const client of [patient, clinician, transporter]) {
      for (const path of [
        '/api/dashboard',
        '/api/alerts',
        '/api/users',
        '/api/directory',
        '/api/followups',
        '/api/communications',
        '/api/integration',
      ])
        expect(
          (await client.get(path)).status,
          `${client.user.role}: ${path}`,
        ).toBe(403);
      expect((await client.post('/api/samples', SAMPLE)).status).toBe(403);
      expect(
        (
          await client.post(`/api/samples/${sample.id}/transition`, {
            version: sample.version,
            action: 'start_processing',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await client.post(`/api/samples/${sample.id}/notes`, {
            text: 'Forged clinical note',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await client.post(`/api/samples/${sample.id}/recollection`, {
            version: sample.version,
            reason: 'Forged issue',
            instructions: 'Forged instruction',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await client.post(`/api/samples/${sample.id}/replacement`, {
            version: sample.version,
            collectedAt: NOW,
          })
        ).status,
      ).toBe(403);
      expect((await client.post('/api/alerts/1/acknowledge')).status).toBe(403);
      expect(
        (
          await client.post('/api/alerts/1/resolve', {
            resolution: 'Forged resolution',
          })
        ).status,
      ).toBe(403);
      expect((await client.post('/api/communications/1/retry')).status).toBe(
        403,
      );
    }
    const technician = await instance.account('technician');
    const directory = await technician.get('/api/directory');
    expect(directory.status).toBe(200);
    expect(Object.keys(directory.body[0]).sort()).toEqual([
      'email',
      'id',
      'name',
      'role',
    ]);
    expect((await technician.get('/api/users')).status).toBe(403);
  });

  it('validates assigned roles and selected communication destinations without trusting submitted identity metadata', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const invalidContacts = [
      { clinician: contact(patient) },
      { patient: { channels: [], portalUserId: 9999 } },
      { patient: { channels: ['email'] } },
      { clinician: { channels: ['sms'], phone: '0821234567' } },
      {
        transporter: {
          channels: ['whatsapp'],
          phone: '+27821234567',
          unexpected: true,
        },
      },
      {
        patient: { channels: ['email', 'email'], email: 'valid@example.test' },
      },
    ];
    for (const contacts of invalidContacts)
      expect(
        (await instance.admin.post('/api/samples', { ...SAMPLE, contacts }))
          .status,
      ).toBe(400);
    expect(
      (
        await instance.admin.post('/api/samples', {
          ...SAMPLE,
          patientResultAccess: true,
        })
      ).status,
    ).toBe(400);
    expect((await instance.admin.get('/api/samples')).body.total).toBe(0);
  });

  it('hides clinical notes, audit text and unreleased results and exposes only logistics to transporters', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const clinician = await instance.account('clinician');
    const transporter = await instance.account('transporter');
    let sample = await instance.create({
      contacts: {
        patient: contact(patient),
        clinician: contact(clinician),
        transporter: contact(transporter),
      },
    });
    sample = (
      await instance.admin.post(`/api/samples/${sample.id}/notes`, {
        text: 'Private note containing diagnosis',
      })
    ).body;
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
        resultSummary: 'SECRET UNRELEASED RESULT',
        qualityChecked: true,
      })
    ).body;
    for (const client of [patient, clinician, transporter]) {
      const detail = (await client.get(`/api/samples/${sample.id}`)).body;
      expect(detail).toMatchObject({
        resultSummary: null,
        resultEnteredBy: null,
        qualityChecked: false,
        notes: [],
        timeline: [],
        allowedActions: [],
      });
      expect(Object.keys(detail.contacts)).toEqual([client.user.role]);
      expect(JSON.stringify(detail)).not.toContain('SECRET UNRELEASED RESULT');
      expect(JSON.stringify(detail)).not.toContain('Private note');
    }
    const logistics = (await transporter.get(`/api/samples/${sample.id}`)).body;
    for (const field of [
      'patientName',
      'patientId',
      'testName',
      'referringDoctor',
      'department',
    ])
      expect(logistics[field]).toBe('');
    const listing = (await transporter.get('/api/samples')).body;
    expect(JSON.stringify(listing)).not.toContain(SAMPLE.patientName);
    expect(JSON.stringify(listing)).not.toContain(SAMPLE.testName);
    expect(
      (await transporter.get('/api/samples?search=Sensitive')).body.total,
    ).toBe(0);
    expect(
      (await transporter.get('/api/samples?search=Specimen')).body.total,
    ).toBe(1);
  });

  it('allows only the assigned clinician to grant or withdraw patient access to released clinician-requested results', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const clinician = await instance.account('clinician');
    const otherClinician = await instance.account('clinician', '2');
    let sample = await instance.release(
      await instance.create({
        contacts: { patient: contact(patient), clinician: contact(clinician) },
      }),
    );
    expect(
      (await clinician.get(`/api/samples/${sample.id}`)).body.resultSummary,
    ).toBe('STRICTLY PRIVATE RELEASED RESULT');
    expect(
      (await patient.get(`/api/samples/${sample.id}`)).body.resultSummary,
    ).toBeNull();
    expect(
      (
        await instance.admin.post(`/api/samples/${sample.id}/patient-access`, {
          version: sample.version,
          allowed: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await otherClinician.post(`/api/samples/${sample.id}/patient-access`, {
          version: sample.version,
          allowed: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await patient.post(`/api/samples/${sample.id}/patient-access`, {
          version: sample.version,
          allowed: true,
        })
      ).status,
    ).toBe(403);
    const granted = await clinician.post(
      `/api/samples/${sample.id}/patient-access`,
      { version: sample.version, allowed: true },
    );
    expect(granted.status).toBe(200);
    sample = granted.body;
    expect(
      (await patient.get(`/api/samples/${sample.id}`)).body.resultSummary,
    ).toBe('STRICTLY PRIVATE RELEASED RESULT');
    expect(
      (
        await clinician.post(`/api/samples/${sample.id}/patient-access`, {
          version: sample.version - 1,
          allowed: false,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await clinician.post(`/api/samples/${sample.id}/patient-access`, {
          version: sample.version,
          allowed: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (await patient.get(`/api/samples/${sample.id}`)).body.resultSummary,
    ).toBeNull();
    expect(
      (await instance.admin.get(`/api/samples/${sample.id}`)).body.timeline.map(
        (item: { label: string }) => item.label,
      ),
    ).toContain('Patient result access withdrawn');
  });

  it('makes released self-requested results available only to the assigned patient without clinician permission', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    let sample = await instance.create({
      requestKind: 'self',
      contacts: { patient: contact(patient) },
    });
    expect(
      (await patient.get(`/api/samples/${sample.id}`)).body.resultSummary,
    ).toBeNull();
    sample = await instance.release(sample);
    expect((await patient.get(`/api/samples/${sample.id}`)).body).toMatchObject(
      {
        requestKind: 'self',
        patientResultAccess: false,
        resultSummary: 'STRICTLY PRIVATE RELEASED RESULT',
      },
    );
    expect(
      (
        await patient.post(`/api/samples/${sample.id}/remind-clinician`, {
          version: sample.version,
        })
      ).status,
    ).toBe(409);
  });

  it('preserves portal assignments on replacement without copying result access, acknowledgement or old clinical text', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const clinician = await instance.account('clinician');
    let sample = await instance.create({
      contacts: { patient: contact(patient), clinician: contact(clinician) },
    });
    sample = (
      await clinician.post(`/api/samples/${sample.id}/patient-access`, {
        version: sample.version,
        allowed: true,
      })
    ).body;
    sample = (
      await instance.admin.post(`/api/samples/${sample.id}/recollection`, {
        version: sample.version,
        reason: 'Private reason with clinical details',
        instructions: 'Private recollection instructions',
      })
    ).body;
    expect(
      (await patient.get(`/api/samples/${sample.id}`)).body.recollectionReason,
    ).toBeNull();
    const replacement = await instance.admin.post(
      `/api/samples/${sample.id}/replacement`,
      { version: sample.version, collectedAt: NOW },
    );
    expect(replacement.status).toBe(201);
    expect(replacement.body).toMatchObject({
      parentSampleId: sample.id,
      patientResultAccess: false,
      clinicalAcknowledgedAt: null,
      resultSummary: null,
    });
    expect(
      (await patient.get(`/api/samples/${replacement.body.id}`)).status,
    ).toBe(200);
    expect(
      (await clinician.get(`/api/samples/${replacement.body.id}`)).status,
    ).toBe(200);
    expect((await patient.get('/api/samples')).body.total).toBe(2);
  });

  it('never broadcasts staff messages to portals and redacts legacy notification content and revoked assignments', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const sample = await instance.create({
      priority: 'urgent',
      contacts: { patient: contact(patient) },
    });
    await instance.create({ priority: 'urgent' });
    instance.database
      .prepare(
        'INSERT INTO notifications (user_id, sample_id, kind, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        patient.user.id,
        sample.id,
        'sample',
        'Private result in old title',
        'Private diagnosis in old message',
        NOW,
      );
    const notifications = (await patient.get('/api/notifications')).body;
    expect(notifications).toHaveLength(2);
    expect(
      notifications.every(
        (item: { sampleId: number }) => item.sampleId === sample.id,
      ),
    ).toBe(true);
    expect(JSON.stringify(notifications)).not.toContain('Private');
    const read = await patient.post(
      `/api/notifications/${notifications[0].id}/read`,
    );
    expect(JSON.stringify(read.body)).not.toContain('Private');
    instance.database
      .prepare(
        "UPDATE samples SET payload = json_remove(payload, '$.contacts.patient.portalUserId') WHERE id = ?",
      )
      .run(sample.id);
    expect((await patient.get('/api/notifications')).body).toEqual([]);
    expect(
      (await patient.post(`/api/notifications/${notifications[0].id}/read`))
        .status,
    ).toBe(404);
    expect((await patient.get(`/api/samples/${sample.id}`)).status).toBe(404);
  });
});

describe('follow-up, integration and durable upgrades', () => {
  it('records patient reminders with a 24-hour cooldown and stops follow-up on clinician acknowledgement', async () => {
    const events: string[] = [];
    const instance = await initialized({
      enqueueCommunication: (_id, event) => {
        events.push(event);
      },
    });
    const patient = await instance.account('patient');
    const clinician = await instance.account('clinician');
    let sample = await instance.release(
      await instance.create({
        contacts: { patient: contact(patient), clinician: contact(clinician) },
      }),
    );
    expect(
      (await instance.admin.get('/api/followups')).body.map(
        (item: { id: number }) => item.id,
      ),
    ).toContain(sample.id);
    const remind = await patient.post(
      `/api/samples/${sample.id}/remind-clinician`,
      { version: sample.version },
    );
    expect(remind.status).toBe(200);
    sample = remind.body;
    expect(sample.lastClinicianReminderAt).toBe(NOW);
    expect(
      (
        await patient.post(`/api/samples/${sample.id}/remind-clinician`, {
          version: sample.version,
        })
      ).body.code,
    ).toBe('REMINDER_COOLDOWN');
    expect(
      events.filter((event) => event === 'clinician_reminder'),
    ).toHaveLength(1);
    expect(
      (
        await patient.post(`/api/samples/${sample.id}/acknowledge-results`, {
          version: sample.version,
        })
      ).status,
    ).toBe(403);
    const acknowledged = await clinician.post(
      `/api/samples/${sample.id}/acknowledge-results`,
      { version: sample.version },
    );
    expect(acknowledged.status).toBe(200);
    sample = acknowledged.body;
    expect(sample.clinicalAcknowledgedAt).toBe(NOW);
    expect(
      (
        await patient.post(`/api/samples/${sample.id}/remind-clinician`, {
          version: sample.version,
        })
      ).body.code,
    ).toBe('REMINDER_UNAVAILABLE');
    expect((await instance.admin.get('/api/followups')).body).toEqual([]);
  });

  it('schedules only due clinician reminders once and stops after acknowledgement', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const clinician = await instance.account('clinician');
    const sample = await instance.release(
      await instance.create({
        contacts: {
          patient: contact(patient),
          clinician: { ...contact(clinician), channels: ['email'] },
        },
      }),
    );
    instance.samples.refreshClinicalReminders();
    expect(
      instance.communications
        .list()
        .filter((message) => message.event === 'clinician_reminder'),
    ).toHaveLength(0);
    instance.setTime('2026-09-28T12:00:00.000Z');
    instance.samples.refreshClinicalReminders();
    instance.samples.refreshClinicalReminders();
    const reminders = instance.communications
      .list()
      .filter((message) => message.event === 'clinician_reminder');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].recipient).toBe('clinician');
    await clinician.login();
    const current = (await clinician.get(`/api/samples/${sample.id}`)).body;
    expect(
      (
        await clinician.post(`/api/samples/${sample.id}/acknowledge-results`, {
          version: current.version,
        })
      ).status,
    ).toBe(200);
    instance.setTime('2026-09-30T12:00:00.000Z');
    instance.samples.refreshClinicalReminders();
    expect(
      instance.communications
        .list()
        .filter((message) => message.event === 'clinician_reminder'),
    ).toHaveLength(1);
  });

  it('imports released LIS results with provenance and no false local quality-check claim', async () => {
    const instance = await initialized();
    const patient = await instance.account('patient');
    const sample = await instance.create({
      requestKind: 'self',
      contacts: { patient: contact(patient) },
    });
    const result = instance.samples.applyIntegrationEvent(
      sample.id,
      {
        event: 'results_available',
        resultSummary: 'EXTERNAL RELEASED RESULT',
        source: 'Test LIS',
      },
      instance.admin.user,
    );
    expect(result).toMatchObject({
      status: 'completed',
      qualityChecked: false,
      resultEnteredBy: 'External LIS (Test LIS)',
      releasedBy: 'External LIS (Test LIS)',
    });
    expect(
      result.timeline.some(
        (event) =>
          event.label === 'Released result imported from external LIS' &&
          event.detail?.includes('no local quality check'),
      ),
    ).toBe(true);
    expect(
      (await patient.get(`/api/samples/${sample.id}`)).body.resultSummary,
    ).toBe('EXTERNAL RELEASED RESULT');
    expect(() =>
      instance.samples.applyIntegrationEvent(
        sample.id,
        { event: 'delayed', reason: 'Invalid late event', source: 'Test LIS' },
        instance.admin.user,
      ),
    ).toThrow('completed or recollection');
    expect(() =>
      instance.samples.applyIntegrationEvent(
        sample.id,
        {
          event: 'results_available',
          resultSummary: 'FORGED',
          source: 'Test LIS',
        },
        patient.user,
      ),
    ).toThrow('administrator-bound');
  });

  it('rolls back specimen, audit, portal notifications and outbox together when an enqueue callback fails', async () => {
    const instance = await initialized({
      enqueueCommunication: () => {
        throw new Error('Simulated outbox failure');
      },
    });
    const patient = await instance.account('patient');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      (
        await instance.admin.post('/api/samples', {
          ...SAMPLE,
          contacts: { patient: { ...contact(patient), channels: ['email'] } },
        })
      ).status,
    ).toBe(500);
    for (const table of [
      'samples',
      'audit_events',
      'notifications',
      'communication_outbox',
    ])
      expect(
        instance.database
          .prepare(`SELECT COUNT(*) AS total FROM ${table}`)
          .get(),
      ).toEqual({ total: 0 });
  });

  it('migrates schema 1 while preserving user IDs, hashes, sessions, specimen history and foreign keys', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lablink-portal-test-'));
    directories.push(directory);
    const databasePath = join(directory, 'legacy.sqlite');
    const first = await initialized({ databasePath });
    const sample = await first.create();
    await first.admin.post(`/api/samples/${sample.id}/notes`, {
      text: 'Legacy audit note',
    });
    const oldCookie = first.admin.cookie;
    const hash = (
      first.database
        .prepare('SELECT password_hash FROM users WHERE id = ?')
        .get(first.admin.user.id) as { password_hash: string }
    ).password_hash;
    first.stop();
    const legacy = new Database(databasePath);
    legacy.pragma('foreign_keys = OFF');
    legacy.exec(`CREATE TABLE users_v1 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','technician','reviewer')), created_at TEXT NOT NULL);
      INSERT INTO users_v1 SELECT * FROM users; DROP TABLE users; ALTER TABLE users_v1 RENAME TO users;
      UPDATE samples SET payload = json_remove(payload, '$.requestKind', '$.contacts', '$.patientResultAccess', '$.clinicalAcknowledgedAt', '$.lastClinicianReminderAt');
      PRAGMA user_version = 1;`);
    legacy.close();
    const second = backend({ databasePath });
    const admin = new Client(second.app);
    admin.cookie = oldCookie;
    admin.email = 'admin@portal.test';
    await admin.session();
    expect(admin.user.id).toBe(first.admin.user.id);
    expect(second.database.pragma('user_version', { simple: true })).toBe(2);
    expect(second.database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(second.database.pragma('foreign_key_check')).toEqual([]);
    expect(
      (
        second.database
          .prepare('SELECT password_hash FROM users WHERE id = ?')
          .get(admin.user.id) as { password_hash: string }
      ).password_hash,
    ).toBe(hash);
    const restored = (await admin.get(`/api/samples/${sample.id}`)).body;
    expect(restored).toMatchObject({
      requestKind: 'clinician',
      contacts: {},
      patientResultAccess: false,
      clinicalAcknowledgedAt: null,
      lastClinicianReminderAt: null,
    });
    expect(restored.notes[0].text).toBe('Legacy audit note');
    expect(restored.timeline).toHaveLength(2);
    const added = await admin.post('/api/users', {
      role: 'patient',
      name: 'New patient',
      email: 'new@portal.test',
      password: PASSWORD,
    });
    expect(added.status).toBe(201);
    expect(added.body.id).toBeGreaterThan(admin.user.id);
  });
});
