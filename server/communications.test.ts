import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommunicationsService,
  communicationsOptionsFromEnv,
  type CommunicationsOptions,
  type CommunicationEvent,
} from './communications.js';

const databases: Database.Database[] = [];
const timestamp = new Date('2026-09-27T09:00:00.000Z');
const sid = `SM${'1'.repeat(32)}`;
const emailId = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794';
const twilio = {
  accountSid: `AC${'2'.repeat(32)}`,
  authToken: 'TEST-SECRET-TOKEN',
  smsFrom: '+27820000000',
  whatsappFrom: 'whatsapp:+27820000001',
  whatsappTemplates: {
    patient: `HX${'3'.repeat(32)}`,
    clinician: `HX${'4'.repeat(32)}`,
    transporter: `HX${'5'.repeat(32)}`,
  },
};
const resend = {
  apiKey: 'TEST-RESEND-SECRET',
  from: 'LabLink <lab@example.test>',
};
const sample = {
  sampleNumber: 'LAB-0001',
  requestKind: 'clinician',
  patientName: 'PRIVATE PATIENT NAME',
  testName: 'PRIVATE TEST NAME',
  resultSummary: 'PRIVATE RESULT VALUE',
  recollectionReason: 'Specimen container leaked during transport.',
  recollectionInstructions: 'PRIVATE COLLECTION INSTRUCTIONS',
  contacts: {
    patient: {
      name: 'Patient',
      email: 'patient@example.test',
      phone: '+27821111111',
      channels: ['email', 'sms', 'whatsapp'],
    },
    clinician: {
      name: 'Clinician',
      email: 'clinician@example.test',
      phone: '+27822222222',
      channels: ['email', 'sms', 'whatsapp'],
    },
    transporter: {
      name: 'Transporter',
      email: 'transport@example.test',
      phone: '+27823333333',
      channels: ['email', 'sms', 'whatsapp'],
    },
  },
};

function database(payload: unknown = sample) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(
    'CREATE TABLE samples (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)',
  );
  db.prepare('INSERT INTO samples (id,payload) VALUES (?,?)').run(
    1,
    JSON.stringify(payload),
  );
  databases.push(db);
  return db;
}

function oneContact(
  channel: 'sms' | 'email' | 'whatsapp',
  recipient: 'patient' | 'clinician' = 'patient',
) {
  return {
    ...sample,
    contacts: {
      [recipient]: { ...sample.contacts[recipient], channels: [channel] },
    },
  };
}

function options(overrides: CommunicationsOptions = {}): CommunicationsOptions {
  return {
    mode: 'preview',
    now: () => timestamp,
    twilio,
    resend,
    fetch: vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('Unmocked network is forbidden.')),
    ...overrides,
  };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

describe('communications routing and privacy', () => {
  it('sends only allowed event details to each recipient and selected channel', () => {
    const service = new CommunicationsService(database(), options());
    const events: CommunicationEvent[] = [
      'received',
      'rejected',
      'delayed',
      'results_available',
      'clinician_reminder',
    ];
    for (const event of events) service.enqueue(1, event);
    const messages = service.list();
    expect(messages).toHaveLength(33);
    const patient = messages.filter(
      (message) => message.recipient === 'patient',
    );
    expect(patient).toHaveLength(12);
    for (const message of patient) {
      expect(message.message).not.toContain(sample.recollectionReason);
      expect(message.message).not.toContain(sample.resultSummary);
      expect(message.message).not.toContain(sample.recollectionInstructions);
      expect(message.message).not.toContain(sample.patientName);
      expect(message.message).not.toContain(sample.testName);
    }
    const rejection = messages.filter(
      (message) =>
        message.event === 'rejected' && message.recipient === 'clinician',
    );
    expect(rejection).toHaveLength(3);
    for (const message of rejection)
      expect(message.message).toContain(sample.recollectionReason);
    const transporter = messages.filter(
      (message) => message.recipient === 'transporter',
    );
    expect(transporter).toHaveLength(6);
    for (const message of transporter) {
      expect(['received', 'results_available']).toContain(message.event);
      expect(message.message).not.toMatch(/reject|leaked|PRIVATE/i);
    }
    expect(
      transporter.find((message) => message.event === 'results_available')
        ?.message,
    ).toContain('ready for collection');
    expect(
      messages
        .filter((message) => message.event === 'clinician_reminder')
        .every((message) => message.recipient === 'clinician'),
    ).toBe(true);
    expect(
      messages.every(
        (message) => !message.destination.includes('patient@example.test'),
      ),
    ).toBe(true);
  });

  it('respects channel choices and does not invent missing contacts', () => {
    const service = new CommunicationsService(
      database(oneContact('sms')),
      options(),
    );
    expect(service.enqueue(1, 'received')).toHaveLength(1);
    expect(service.list()[0]).toMatchObject({
      recipient: 'patient',
      channel: 'sms',
    });
    expect(service.enqueue(1, 'clinician_reminder')).toEqual([]);
    const empty = new CommunicationsService(
      database({ ...sample, contacts: undefined, requestKind: 'self' }),
      options(),
    );
    expect(empty.enqueue(1, 'received')).toEqual([]);
  });

  it('deduplicates durably while allowing one reminder for each supplied date', () => {
    const db = database();
    const service = new CommunicationsService(db, options());
    expect(service.enqueue(1, 'received')).toHaveLength(9);
    expect(service.enqueue(1, 'received')).toEqual([]);
    const restarted = new CommunicationsService(db, options());
    expect(restarted.enqueue(1, 'received')).toEqual([]);
    expect(
      restarted.enqueue(1, 'clinician_reminder', '2026-09-27'),
    ).toHaveLength(3);
    expect(restarted.enqueue(1, 'clinician_reminder', '2026-09-27')).toEqual(
      [],
    );
    expect(
      restarted.enqueue(1, 'clinician_reminder', '2026-09-28'),
    ).toHaveLength(3);
  });

  it('rolls back queued notifications with the enclosing sample transaction', () => {
    const db = database();
    const service = new CommunicationsService(db, options());
    expect(() =>
      db.transaction(() => {
        service.enqueue(1, 'received');
        throw new Error('Abort sample transition');
      })(),
    ).toThrow('Abort sample transition');
    expect(service.list()).toEqual([]);
  });

  it('blocks missing destinations and clinician rejection details addressed to a patient contact', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const payload = {
      ...sample,
      contacts: {
        patient: { email: 'patient@example.test', channels: ['email', 'sms'] },
        clinician: { email: 'patient@example.test', channels: ['email'] },
      },
    };
    const service = new CommunicationsService(
      database(payload),
      options({ mode: 'live', fetch: fetcher }),
    );
    service.enqueue(1, 'rejected');
    const blocked = service
      .list()
      .filter((message) => message.status === 'blocked');
    expect(blocked).toHaveLength(2);
    expect(
      blocked.find((message) => message.recipient === 'clinician')?.lastError,
    ).toContain('matches another recipient');
    expect(() => service.retry(blocked[0].id)).toThrow();
    // Only the generic patient email remains eligible; do not call any real provider.
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ id: emailId }), { status: 200 }),
    );
    await service.processPending();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain(
      sample.recollectionReason,
    );
  });

  it('does not send a queued snapshot after recipient contact or channel choices change', async () => {
    const db = database(oneContact('sms'));
    const fetcher = vi.fn<typeof fetch>();
    const service = new CommunicationsService(
      db,
      options({ mode: 'live', fetch: fetcher }),
    );
    service.enqueue(1, 'received');
    const changed = oneContact('sms');
    changed.contacts.patient!.channels = [];
    db.prepare('UPDATE samples SET payload=? WHERE id=1').run(
      JSON.stringify(changed),
    );
    await service.processPending();
    expect(fetcher).not.toHaveBeenCalled();
    expect(service.list()[0]).toMatchObject({ status: 'blocked', attempts: 0 });
    expect(service.list()[0].lastError).toContain('preferences changed');
  });
});

describe('communications processing', () => {
  it('defaults to preview, never calls providers, and never resends previews after switching to live', async () => {
    const db = database(oneContact('email'));
    const fetcher = vi.fn<typeof fetch>();
    const service = new CommunicationsService(db, options({ fetch: fetcher }));
    service.enqueue(1, 'received');
    expect(await service.processPending()).toEqual({ processed: 1 });
    expect(service.list()[0]).toMatchObject({
      status: 'preview',
      attempts: 0,
      acceptedAt: null,
      providerMessageId: null,
    });
    const live = new CommunicationsService(
      db,
      options({ mode: 'live', fetch: fetcher }),
    );
    expect(await live.processPending()).toEqual({ processed: 0 });
    expect(() => live.retry(service.list()[0].id)).toThrow(
      /Preview and accepted/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires explicit delivery mode and reports configuration without revealing secrets', async () => {
    expect(communicationsOptionsFromEnv({}).mode).toBe('preview');
    expect(() =>
      communicationsOptionsFromEnv({ LABLINK_DELIVERY_MODE: 'enable' }),
    ).toThrow(/preview or live/);
    const fetcher = vi.fn<typeof fetch>();
    const service = new CommunicationsService(
      database(),
      options({ mode: 'live', twilio: {}, resend: {}, fetch: fetcher }),
    );
    service.enqueue(1, 'received');
    await service.processPending();
    expect(
      service
        .list()
        .every(
          (message) => message.status === 'blocked' && message.attempts === 0,
        ),
    ).toBe(true);
    expect(service.status()).toMatchObject({
      mode: 'live',
      providers: {
        sms: { configured: false },
        email: { configured: false },
        whatsapp: { configured: false },
      },
      counts: { blocked: 9 },
    });
    expect(fetcher).not.toHaveBeenCalled();
    const configured = new CommunicationsService(database(), options());
    expect(JSON.stringify(configured.status())).not.toContain(twilio.authToken);
    expect(JSON.stringify(configured.status())).not.toContain(resend.apiKey);
  });

  it('uses SMS parameters and approved role-specific WhatsApp templates, recording acceptance only', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ sid, status: 'queued' }), {
          status: 201,
        }),
    );
    const payload = {
      ...sample,
      contacts: {
        patient: { ...sample.contacts.patient, channels: ['sms', 'whatsapp'] },
      },
    };
    const service = new CommunicationsService(
      database(payload),
      options({ mode: 'live', fetch: fetcher }),
    );
    service.enqueue(1, 'rejected');
    await service.processPending();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const sms = new URLSearchParams(String(fetcher.mock.calls[0][1]?.body));
    expect(sms.get('To')).toBe(sample.contacts.patient.phone);
    expect(sms.get('Body')).toContain(
      'Your sample was rejected. Please visit your healthcare provider.',
    );
    const whatsapp = new URLSearchParams(
      String(fetcher.mock.calls[1][1]?.body),
    );
    expect(whatsapp.get('To')).toBe(
      `whatsapp:${sample.contacts.patient.phone}`,
    );
    expect(whatsapp.get('From')).toBe(twilio.whatsappFrom);
    expect(whatsapp.get('ContentSid')).toBe(twilio.whatsappTemplates.patient);
    expect(whatsapp.has('Body')).toBe(false);
    expect(JSON.parse(whatsapp.get('ContentVariables')!)).toEqual({
      '1': sample.sampleNumber,
      '2': 'Your sample was rejected. Please visit your healthcare provider.',
    });
    expect(
      service
        .list()
        .every(
          (message) =>
            message.status === 'accepted' &&
            message.providerMessageId === sid &&
            message.acceptedAt === timestamp.toISOString(),
        ),
    ).toBe(true);
    expect(() => service.retry(service.list()[0].id)).toThrow(/not resent/);
  });

  it('does not fall back to unrestricted WhatsApp text when a template is missing', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new CommunicationsService(
      database(oneContact('whatsapp')),
      options({
        mode: 'live',
        twilio: { ...twilio, whatsappTemplates: {} },
        fetch: fetcher,
      }),
    );
    service.enqueue(1, 'received');
    await service.processPending();
    expect(fetcher).not.toHaveBeenCalled();
    expect(service.list()[0]).toMatchObject({ status: 'blocked', attempts: 0 });
    expect(service.list()[0].lastError).toContain(
      'approved patient WhatsApp Content SID',
    );
  });

  it('persists exponential retry scheduling and a bounded attempt count, then permits an explicit retry', async () => {
    let now = timestamp.getTime();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sid, status: 'queued' }), {
          status: 201,
        }),
      );
    const service = new CommunicationsService(
      database(oneContact('sms')),
      options({
        mode: 'live',
        fetch: fetcher,
        now: () => new Date(now),
        maxAttempts: 2,
        retryBaseMs: 100,
      }),
    );
    service.enqueue(1, 'received');
    await service.processPending();
    expect(service.list()[0]).toMatchObject({
      status: 'retry',
      attempts: 1,
      nextAttemptAt: new Date(now + 100).toISOString(),
    });
    expect(await service.processPending()).toEqual({ processed: 0 });
    now += 100;
    await service.processPending();
    expect(service.list()[0]).toMatchObject({ status: 'failed', attempts: 2 });
    service.retry(service.list()[0].id);
    await service.processPending();
    expect(service.list()[0]).toMatchObject({
      status: 'accepted',
      attempts: 3,
    });
  });

  it('retries email with an unchanged request and stable idempotency key', async () => {
    let now = timestamp.getTime();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('temporary provider error', { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: emailId }), { status: 200 }),
      );
    const db = database(oneContact('email', 'clinician'));
    const service = new CommunicationsService(
      db,
      options({
        mode: 'live',
        fetch: fetcher,
        now: () => new Date(now),
        retryBaseMs: 100,
      }),
    );
    service.enqueue(1, 'rejected');
    await service.processPending();
    expect(service.list()[0].status).toBe('retry');
    now += 100;
    const restarted = new CommunicationsService(
      db,
      options({
        mode: 'live',
        fetch: fetcher,
        now: () => new Date(now),
        retryBaseMs: 100,
      }),
    );
    await restarted.processPending();
    const first = fetcher.mock.calls[0];
    const second = fetcher.mock.calls[1];
    expect(first[0]).toBe('https://api.resend.com/emails');
    expect(new Headers(first[1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(second[1]?.headers).get('Idempotency-Key'),
    );
    expect(second[1]?.body).toBe(first[1]?.body);
    expect(JSON.parse(String(first[1]?.body))).toMatchObject({
      to: [sample.contacts.clinician.email],
      text: expect.stringContaining(sample.recollectionReason),
    });
    expect(restarted.list()[0]).toMatchObject({
      status: 'accepted',
      providerMessageId: emailId,
      attempts: 2,
    });
  });

  it('keeps ambiguous SMS timeouts uncertain and bounds requests that never resolve', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>(() => {}));
    const service = new CommunicationsService(
      database(oneContact('sms')),
      options({ mode: 'live', fetch: fetcher, timeoutMs: 20 }),
    );
    service.enqueue(1, 'received');
    await service.processPending();
    expect(service.list()[0]).toMatchObject({
      status: 'uncertain',
      attempts: 1,
      acceptedAt: null,
    });
    expect(service.list()[0].lastError).toContain('avoid duplicates');
    await service.processPending();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('does not retry email beyond the provider idempotency window', async () => {
    let now = timestamp.getTime();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('Private provider error'));
    const service = new CommunicationsService(
      database(oneContact('email')),
      options({ mode: 'live', fetch: fetcher, now: () => new Date(now) }),
    );
    service.enqueue(1, 'received');
    await service.processPending();
    expect(service.list()[0].status).toBe('retry');
    now += 24 * 3_600_000;
    await service.processPending();
    expect(service.list()[0].status).toBe('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sanitizes provider failures, rejects false success responses, and never logs clinical content or secrets', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sensitive = `${sample.resultSummary} ${sample.recollectionReason} ${resend.apiKey}`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: sensitive }), { status: 400 }),
      );
    const service = new CommunicationsService(
      database(oneContact('email')),
      options({ mode: 'live', fetch: fetcher }),
    );
    service.enqueue(1, 'received');
    await service.processPending();
    expect(service.list()[0].status).toBe('failed');
    expect(service.list()[0].lastError).not.toContain(sensitive);
    expect(errorLog).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const malformed = new CommunicationsService(
      database(oneContact('sms')),
      options({
        mode: 'live',
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('{}', { status: 200 })),
      }),
    );
    malformed.enqueue(1, 'received');
    await malformed.processPending();
    expect(malformed.list()[0].status).toBe('uncertain');
  });

  it('claims each message only once across concurrent workers and reconciles expired claims conservatively', async () => {
    const db = database(oneContact('sms'));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ sid, status: 'queued' }), {
          status: 201,
        }),
    );
    const first = new CommunicationsService(
      db,
      options({ mode: 'live', fetch: fetcher }),
    );
    const second = new CommunicationsService(
      db,
      options({ mode: 'live', fetch: fetcher }),
    );
    first.enqueue(1, 'received');
    await Promise.all([first.processPending(), second.processPending()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.list()[0].status).toBe('accepted');
    first.enqueue(1, 'delayed');
    db.prepare(
      "UPDATE communication_outbox SET status='processing',locked_until=?,attempts=1 WHERE event='delayed'",
    ).run(timestamp.getTime() - 1);
    await second.processPending();
    expect(
      first.list().find((message) => message.event === 'delayed')?.status,
    ).toBe('uncertain');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
