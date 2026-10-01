import { createHash, randomUUID } from 'node:crypto';
import type { LabDatabase } from './database.js';
import { ApiError } from './errors.js';

export type CommunicationEvent =
  | 'received'
  | 'rejected'
  | 'delayed'
  | 'results_available'
  | 'clinician_reminder';
export type Recipient = 'patient' | 'clinician' | 'transporter';
export type Channel = 'sms' | 'email' | 'whatsapp';
export type OutboxStatus =
  | 'queued'
  | 'processing'
  | 'retry'
  | 'blocked'
  | 'failed'
  | 'preview'
  | 'accepted'
  | 'uncertain';

export interface OutboxMessage {
  id: number;
  sampleId: number;
  sampleNumber: string;
  event: CommunicationEvent;
  recipient: Recipient;
  channel: Channel;
  /** Masked; the complete destination is kept only in the server's outbox. */
  destination: string;
  message: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  providerMessageId: string | null;
}

export interface CommunicationsOptions {
  mode?: 'preview' | 'live';
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  batchSize?: number;
  twilio?: {
    accountSid?: string;
    authToken?: string;
    smsFrom?: string;
    whatsappFrom?: string;
    whatsappTemplates?: Partial<Record<Recipient, string>>;
  };
  resend?: { apiKey?: string; from?: string };
}

export interface CommunicationsStatus {
  mode: 'preview' | 'live';
  providers: {
    sms: { configured: boolean };
    email: { configured: boolean };
    whatsapp: { configured: boolean; templates: Record<Recipient, boolean> };
  };
  counts: Record<OutboxStatus, number>;
}

interface Contact {
  email?: string;
  phone?: string;
  channels?: Channel[];
}
interface SamplePayload {
  sampleNumber?: string;
  requestKind?: 'clinician' | 'self';
  recollectionReason?: string | null;
  contacts?: Partial<Record<Recipient, Contact>>;
}
interface OutboxRow {
  id: number;
  sample_id: number;
  sample_number: string;
  event: CommunicationEvent;
  recipient: Recipient;
  channel: Channel;
  destination: string;
  message: string;
  status: OutboxStatus;
  attempts: number;
  cycle_attempts: number;
  last_error: string | null;
  next_attempt_at: number | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  provider_message_id: string | null;
  idempotency_key: string;
  first_attempt_at: number | null;
  locked_until: number | null;
}

const recipients: Recipient[] = ['patient', 'clinician', 'transporter'];
const channels: Channel[] = ['sms', 'email', 'whatsapp'];
const events: CommunicationEvent[] = [
  'received',
  'rejected',
  'delayed',
  'results_available',
  'clinician_reminder',
];
const statuses: OutboxStatus[] = [
  'queued',
  'processing',
  'retry',
  'blocked',
  'failed',
  'preview',
  'accepted',
  'uncertain',
];
const phonePattern = /^\+[1-9]\d{7,14}$/;
const emailPattern = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
const contentSidPattern = /^HX[a-f\d]{32}$/i;
const uncertainMessage =
  'Provider acceptance could not be confirmed. Check the provider console before retrying to avoid duplicates.';

export function communicationsOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CommunicationsOptions {
  const mode = env.LABLINK_DELIVERY_MODE ?? 'preview';
  if (mode !== 'preview' && mode !== 'live')
    throw new Error('LABLINK_DELIVERY_MODE must be preview or live.');
  return {
    mode,
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      smsFrom: env.TWILIO_SMS_FROM,
      whatsappFrom: env.TWILIO_WHATSAPP_FROM,
      whatsappTemplates: {
        patient: env.TWILIO_WHATSAPP_PATIENT_CONTENT_SID,
        clinician: env.TWILIO_WHATSAPP_CLINICIAN_CONTENT_SID,
        transporter: env.TWILIO_WHATSAPP_TRANSPORTER_CONTENT_SID,
      },
    },
    resend: { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM },
  };
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum)
    throw new Error('Invalid communications worker configuration.');
  return result;
}

function destination(contact: Contact | undefined, channel: Channel): string {
  const value = channel === 'email' ? contact?.email : contact?.phone;
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return channel === 'email'
    ? trimmed.toLowerCase()
    : trimmed.replace(/^whatsapp:/, '');
}

function masked(value: string, channel: Channel): string {
  if (!value) return 'Not provided';
  if (channel === 'email') {
    const [local, domain] = value.split('@');
    return domain ? `${local.slice(0, 1)}***@${domain}` : 'Invalid email';
  }
  return `***${value.slice(-4)}`;
}

function messageFor(
  recipient: Recipient,
  event: CommunicationEvent,
  sample: SamplePayload,
): string | null {
  if (recipient === 'transporter') {
    if (event === 'received') return 'The laboratory has received the sample.';
    if (event === 'results_available')
      return 'Results are ready for collection. Please coordinate collection with the laboratory.';
    return null;
  }
  if (recipient === 'patient') {
    if (event === 'received')
      return 'Your sample has been received by the laboratory.';
    if (event === 'rejected')
      return sample.requestKind === 'self'
        ? 'Your sample was rejected. Please contact the laboratory.'
        : 'Your sample was rejected. Please visit your healthcare provider.';
    if (event === 'delayed')
      return 'Your results are delayed. Please wait for a results-available update before visiting to collect them.';
    if (event === 'results_available')
      return sample.requestKind === 'self'
        ? 'Your results are available. Please contact the laboratory.'
        : 'Your results are available. Please visit your healthcare provider.';
    return null;
  }
  if (event === 'rejected') {
    const reason =
      typeof sample.recollectionReason === 'string'
        ? sample.recollectionReason.replace(/\s+/g, ' ').trim()
        : '';
    const excerpt =
      reason.length > 1100
        ? `${reason.slice(0, 1100)}… See the clinician portal for the full reason.`
        : reason;
    return `A replacement specimen is required.${excerpt ? ` Reason: ${excerpt}` : ' Please review the rejection details in the clinician portal.'} Please arrange recollection.`;
  }
  if (event === 'received') return 'The laboratory has received the sample.';
  if (event === 'delayed')
    return 'The sample has exceeded its turnaround target. Please review its status in the clinician portal.';
  if (event === 'results_available')
    return 'Results are available for review in the clinician portal.';
  return 'Reminder: results remain available for review. Please open the clinician portal.';
}

/** Durable transactional outbox; routes must restrict history and retries to administrators. */
export class CommunicationsService {
  private readonly mode: 'preview' | 'live';
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly batchSize: number;
  private processing = false;

  constructor(
    private readonly db: LabDatabase,
    private readonly options: CommunicationsOptions = communicationsOptionsFromEnv(),
  ) {
    this.mode = options.mode ?? 'preview';
    if (!['preview', 'live'].includes(this.mode))
      throw new Error('Delivery mode must be preview or live.');
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = bounded(options.timeoutMs, 10_000, 10, 30_000);
    this.maxAttempts = bounded(options.maxAttempts, 5, 1, 10);
    this.retryBaseMs = bounded(options.retryBaseMs, 60_000, 10, 3_600_000);
    this.batchSize = bounded(options.batchSize, 20, 1, 100);
    db.exec(`
      CREATE TABLE IF NOT EXISTS communication_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sample_id INTEGER NOT NULL REFERENCES samples(id), sample_number TEXT NOT NULL,
        event TEXT NOT NULL, recipient TEXT NOT NULL, channel TEXT NOT NULL,
        destination TEXT NOT NULL, message TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('queued','processing','retry','blocked','failed','preview','accepted','uncertain')),
        attempts INTEGER NOT NULL DEFAULT 0, cycle_attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, next_attempt_at INTEGER, first_attempt_at INTEGER, locked_until INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, accepted_at TEXT, provider_message_id TEXT
      );
      CREATE INDEX IF NOT EXISTS communication_outbox_pending ON communication_outbox(status, next_attempt_at, id);
      CREATE INDEX IF NOT EXISTS communication_outbox_sample ON communication_outbox(sample_id, id);
    `);
  }

  enqueue(
    sampleId: number,
    event: CommunicationEvent,
    dedupeKey = '',
  ): OutboxMessage[] {
    if (
      !Number.isSafeInteger(sampleId) ||
      sampleId < 1 ||
      !events.includes(event) ||
      typeof dedupeKey !== 'string' ||
      dedupeKey.length > 256
    )
      throw new ApiError(
        400,
        'Invalid notification event.',
        'INVALID_COMMUNICATION',
      );
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT payload FROM samples WHERE id = ?')
        .get(sampleId) as { payload: string } | undefined;
      if (!row) throw new ApiError(404, 'Sample not found.', 'NOT_FOUND');
      const sample = JSON.parse(row.payload) as SamplePayload;
      const reference =
        typeof sample.sampleNumber === 'string' &&
        /^[a-z\d-]{1,64}$/i.test(sample.sampleNumber)
          ? sample.sampleNumber
          : `#${sampleId}`;
      const created: OutboxMessage[] = [];
      const timestamp = this.now().toISOString();
      for (const recipient of recipients) {
        const contact = sample.contacts?.[recipient];
        const text = messageFor(recipient, event, sample);
        if (!contact || !Array.isArray(contact.channels) || !text) continue;
        for (const channel of new Set(contact.channels)) {
          if (!channels.includes(channel)) continue;
          const address = destination(contact, channel);
          const key = createHash('sha256')
            .update(
              JSON.stringify([
                sampleId,
                event,
                recipient,
                channel,
                address,
                dedupeKey,
              ]),
            )
            .digest('hex');
          let problem: string | null = null;
          if (
            channel === 'email'
              ? !emailPattern.test(address) || address.length > 254
              : !phonePattern.test(address)
          )
            problem =
              channel === 'email'
                ? 'Provide a valid email address on the request form.'
                : 'Provide an international phone number, beginning with +, on the request form.';
          if (
            recipient === 'clinician' &&
            event === 'rejected' &&
            recipients.some(
              (other) =>
                other !== 'clinician' &&
                address &&
                destination(sample.contacts?.[other], channel) === address,
            )
          )
            problem =
              'The clinician contact matches another recipient. Correct the request contacts before sending rejection details.';
          const inserted = this.db
            .prepare(
              `INSERT OR IGNORE INTO communication_outbox
            (sample_id,sample_number,event,recipient,channel,destination,message,dedupe_key,idempotency_key,status,last_error,next_attempt_at,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              sampleId,
              reference,
              event,
              recipient,
              channel,
              address,
              `LabLink ${reference}: ${text}`,
              key,
              randomUUID(),
              problem ? 'blocked' : 'queued',
              problem,
              problem ? null : this.now().getTime(),
              timestamp,
              timestamp,
            );
          if (inserted.changes)
            created.push(
              this.publicRow(this.row(Number(inserted.lastInsertRowid))),
            );
        }
      }
      return created;
    })();
  }

  list(): OutboxMessage[] {
    return (
      this.db
        .prepare('SELECT * FROM communication_outbox ORDER BY id DESC')
        .all() as OutboxRow[]
    ).map((row) => this.publicRow(row));
  }

  retry(id: number): OutboxMessage {
    return this.db.transaction(() => {
      const row = this.row(id);
      if (!['retry', 'blocked', 'failed', 'uncertain'].includes(row.status))
        throw new ApiError(
          409,
          'Only blocked, failed, uncertain, or retrying messages can be retried. Preview and accepted messages are not resent.',
          'INVALID_RETRY',
        );
      const contactProblem = this.contactProblem(row);
      if (contactProblem)
        throw new ApiError(409, contactProblem, 'CONTACT_CORRECTION_REQUIRED');
      this.db
        .prepare(
          "UPDATE communication_outbox SET status='queued',cycle_attempts=0,last_error=NULL,next_attempt_at=?,locked_until=NULL,updated_at=? WHERE id=?",
        )
        .run(this.now().getTime(), this.now().toISOString(), id);
      return this.publicRow(this.row(id));
    })();
  }

  status(): CommunicationsStatus {
    const config = this.options.twilio;
    const credentials = Boolean(
      config?.accountSid &&
      /^AC[a-f\d]{32}$/i.test(config.accountSid) &&
      config.authToken,
    );
    const templates = Object.fromEntries(
      recipients.map((recipient) => [
        recipient,
        contentSidPattern.test(config?.whatsappTemplates?.[recipient] ?? ''),
      ]),
    ) as Record<Recipient, boolean>;
    const whatsappSender = (config?.whatsappFrom ?? '').replace(
      /^whatsapp:/,
      '',
    );
    const from =
      this.options.resend?.from?.match(/<([^<>]+)>$/)?.[1] ??
      this.options.resend?.from ??
      '';
    const counts = Object.fromEntries(
      statuses.map((status) => [status, 0]),
    ) as Record<OutboxStatus, number>;
    for (const row of this.db
      .prepare(
        'SELECT status, COUNT(*) AS count FROM communication_outbox GROUP BY status',
      )
      .all() as { status: OutboxStatus; count: number }[])
      counts[row.status] = row.count;
    return {
      mode: this.mode,
      providers: {
        sms: {
          configured: credentials && phonePattern.test(config?.smsFrom ?? ''),
        },
        email: {
          configured: Boolean(
            this.options.resend?.apiKey &&
            emailPattern.test(from) &&
            !/[\r\n]/.test(this.options.resend?.from ?? ''),
          ),
        },
        whatsapp: {
          configured:
            credentials &&
            phonePattern.test(whatsappSender) &&
            recipients.every((recipient) => templates[recipient]),
          templates,
        },
      },
      counts,
    };
  }

  async processPending(): Promise<{ processed: number }> {
    if (this.processing) return { processed: 0 };
    this.processing = true;
    let processed = 0;
    try {
      // A crashed process may have handed a message to the provider. Never silently send it twice.
      this.db
        .prepare(
          "UPDATE communication_outbox SET status='uncertain',last_error=?,next_attempt_at=NULL,locked_until=NULL,updated_at=? WHERE status='processing' AND locked_until <= ?",
        )
        .run(uncertainMessage, this.now().toISOString(), this.now().getTime());
      for (; processed < this.batchSize; processed++) {
        const row = this.db.transaction(() => {
          const pending = this.db
            .prepare(
              "SELECT * FROM communication_outbox WHERE status IN ('queued','retry') AND next_attempt_at <= ? ORDER BY id LIMIT 1",
            )
            .get(this.now().getTime()) as OutboxRow | undefined;
          if (!pending) return undefined;
          this.db
            .prepare(
              "UPDATE communication_outbox SET status='processing',locked_until=?,updated_at=? WHERE id=?",
            )
            .run(
              this.now().getTime() + this.timeoutMs + 30_000,
              this.now().toISOString(),
              pending.id,
            );
          return pending;
        })();
        if (!row) break;
        if (this.mode === 'preview') {
          this.finish(row.id, 'preview', null);
          continue;
        }
        await this.deliver(row);
      }
      return { processed };
    } finally {
      this.processing = false;
    }
  }

  /** Sends non-clinical account-security mail. It never exposes specimen data. */
  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const provider = this.status().providers.email;
    if (this.mode !== 'live' || !provider.configured) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.resend!.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: this.options.resend!.from,
            to: [to],
            subject: 'Reset your LabLink password',
            text: `Use this one-time link to set a new LabLink password: ${resetUrl}\n\nThis link expires in 30 minutes. If you did not request it, you can ignore this email.`,
          }),
          signal: controller.signal,
          redirect: 'error',
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Password reset delivery timed out.'));
          }, this.timeoutMs);
        }),
      ]);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Password reset delivery was rejected.');
      }
      await response.body?.cancel();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private row(id: number): OutboxRow {
    if (!Number.isSafeInteger(id) || id < 1)
      throw new ApiError(400, 'Use a valid notification ID.', 'INVALID_ID');
    const row = this.db
      .prepare('SELECT * FROM communication_outbox WHERE id=?')
      .get(id) as OutboxRow | undefined;
    if (!row) throw new ApiError(404, 'Notification not found.', 'NOT_FOUND');
    return row;
  }

  private publicRow(row: OutboxRow): OutboxMessage {
    return {
      id: row.id,
      sampleId: row.sample_id,
      sampleNumber: row.sample_number,
      event: row.event,
      recipient: row.recipient,
      channel: row.channel,
      destination: masked(row.destination, row.channel),
      message: row.message,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      nextAttemptAt:
        row.next_attempt_at === null
          ? null
          : new Date(row.next_attempt_at).toISOString(),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      acceptedAt: row.accepted_at,
      providerMessageId: row.provider_message_id,
    };
  }

  private contactProblem(row: OutboxRow): string | null {
    const stored = this.db
      .prepare('SELECT payload FROM samples WHERE id=?')
      .get(row.sample_id) as { payload: string } | undefined;
    if (!stored)
      return 'The sample is unavailable. Review the request before retrying.';
    const sample = JSON.parse(stored.payload) as SamplePayload;
    const contact = sample.contacts?.[row.recipient];
    if (
      !contact?.channels?.includes(row.channel) ||
      destination(contact, row.channel) !== row.destination
    )
      return 'Recipient details or channel preferences changed. Enqueue a new event from the corrected request; this message will not use its old recipient.';
    if (
      row.channel === 'email'
        ? !emailPattern.test(row.destination) || row.destination.length > 254
        : !phonePattern.test(row.destination)
    )
      return 'Correct the recipient details on the request form and enqueue the event again.';
    if (
      row.recipient === 'clinician' &&
      row.event === 'rejected' &&
      recipients.some(
        (other) =>
          other !== 'clinician' &&
          destination(sample.contacts?.[other], row.channel) ===
            row.destination,
      )
    )
      return 'The clinician contact matches another recipient. Correct the request contacts before sending rejection details.';
    return null;
  }

  private finish(
    id: number,
    status: OutboxStatus,
    error: string | null,
    providerId: string | null = null,
    nextAttemptAt: number | null = null,
  ) {
    const timestamp = this.now().toISOString();
    this.db
      .prepare(
        'UPDATE communication_outbox SET status=?,last_error=?,provider_message_id=COALESCE(?,provider_message_id),accepted_at=?,next_attempt_at=?,locked_until=NULL,updated_at=? WHERE id=?',
      )
      .run(
        status,
        error,
        providerId,
        status === 'accepted' ? timestamp : null,
        nextAttemptAt,
        timestamp,
        id,
      );
  }

  private scheduleRetry(row: OutboxRow, message: string) {
    const current = this.row(row.id);
    if (current.cycle_attempts >= this.maxAttempts) {
      this.finish(
        row.id,
        'failed',
        'Retry limit reached. Review the provider configuration before retrying.',
      );
      return;
    }
    const next =
      this.now().getTime() +
      Math.min(
        3_600_000,
        this.retryBaseMs * 2 ** Math.min(current.cycle_attempts - 1, 10),
      );
    if (
      row.channel === 'email' &&
      current.first_attempt_at !== null &&
      next - current.first_attempt_at >= 23 * 3_600_000
    ) {
      this.finish(
        row.id,
        'uncertain',
        'The email idempotency window is ending. Check the provider console before any further attempt.',
      );
      return;
    }
    this.finish(row.id, 'retry', message, null, next);
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const contactProblem = this.contactProblem(row);
    if (contactProblem) {
      this.finish(row.id, 'blocked', contactProblem);
      return;
    }
    const providers = this.status().providers;
    const twilio = this.options.twilio;
    const whatsappSender = (twilio?.whatsappFrom ?? '').replace(
      /^whatsapp:/,
      '',
    );
    const whatsappReady = Boolean(
      twilio?.accountSid &&
      /^AC[a-f\d]{32}$/i.test(twilio.accountSid) &&
      twilio.authToken &&
      phonePattern.test(whatsappSender) &&
      providers.whatsapp.templates[row.recipient],
    );
    if (
      !(row.channel === 'whatsapp'
        ? whatsappReady
        : providers[row.channel].configured)
    ) {
      this.finish(
        row.id,
        'blocked',
        row.channel === 'email'
          ? 'Configure RESEND_API_KEY and a verified RESEND_FROM sender, then retry.'
          : row.channel === 'sms'
            ? 'Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM, then retry.'
            : `Configure Twilio credentials, TWILIO_WHATSAPP_FROM and the approved ${row.recipient} WhatsApp Content SID, then retry.`,
      );
      return;
    }
    if (
      row.channel === 'email' &&
      row.first_attempt_at !== null &&
      this.now().getTime() - row.first_attempt_at >= 23 * 3_600_000
    ) {
      this.finish(
        row.id,
        'uncertain',
        'The email idempotency window has elapsed. Check the provider console; this message cannot be safely retried automatically.',
      );
      return;
    }
    let url: string;
    let request: RequestInit;
    if (row.channel === 'email') {
      url = 'https://api.resend.com/emails';
      request = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.resend!.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `lablink-${row.idempotency_key}`,
        },
        body: JSON.stringify({
          from: this.options.resend!.from,
          to: [row.destination],
          subject: `LabLink sample update ${row.sample_number}`,
          text: row.message,
        }),
      };
    } else {
      url = `https://api.twilio.com/2010-04-01/Accounts/${twilio!.accountSid}/Messages.json`;
      const body = new URLSearchParams({
        To:
          row.channel === 'whatsapp'
            ? `whatsapp:${row.destination}`
            : row.destination,
        From:
          row.channel === 'whatsapp'
            ? `whatsapp:${whatsappSender}`
            : twilio!.smsFrom!,
      });
      if (row.channel === 'whatsapp') {
        body.set('ContentSid', twilio!.whatsappTemplates![row.recipient]!);
        body.set(
          'ContentVariables',
          JSON.stringify({
            '1': row.sample_number,
            '2': row.message.slice(`LabLink ${row.sample_number}: `.length),
          }),
        );
      } else body.set('Body', row.message);
      request = {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilio!.accountSid}:${twilio!.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      };
    }
    this.db
      .prepare(
        'UPDATE communication_outbox SET attempts=attempts+1,cycle_attempts=cycle_attempts+1,first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=?',
      )
      .run(this.now().getTime(), row.id);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await this.fetcher(url, {
            ...request,
            signal: controller.signal,
            redirect: 'error',
          });
          // Provider error bodies may echo contact details, credentials or clinical information.
          if (!response.ok) {
            await response.body?.cancel();
            return { status: response.status, ok: false, body: null };
          }
          const text = await response.text();
          if (text.length > 16_384)
            throw new Error('Unexpected provider response.');
          return {
            status: response.status,
            ok: true,
            body: JSON.parse(text) as Record<string, unknown>,
          };
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Provider request timed out.'));
          }, this.timeoutMs);
        }),
      ]);
      if (!result.ok) {
        if (
          result.status === 429 ||
          (row.channel === 'email' && result.status >= 500)
        )
          this.scheduleRetry(
            row,
            'The provider is temporarily unavailable. A retry is scheduled.',
          );
        else if (result.status >= 500)
          this.finish(row.id, 'uncertain', uncertainMessage);
        else if ([401, 403].includes(result.status))
          this.finish(
            row.id,
            'blocked',
            'The provider rejected the credentials or sender permissions. Review the provider configuration, then retry.',
          );
        else
          this.finish(
            row.id,
            'failed',
            'The provider rejected this request. Verify the contact, approved template and sender configuration before retrying.',
          );
        return;
      }
      const id = row.channel === 'email' ? result.body?.id : result.body?.sid;
      const validId =
        typeof id === 'string' &&
        (row.channel === 'email'
          ? /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
          : /^(SM|MM)[a-f\d]{32}$/i.test(id));
      if (!validId) {
        this.finish(row.id, 'uncertain', uncertainMessage);
        return;
      }
      if (
        row.channel !== 'email' &&
        ['failed', 'undelivered', 'canceled'].includes(
          String(result.body?.status),
        )
      ) {
        this.finish(
          row.id,
          'failed',
          'The provider reported that the message was not accepted for delivery.',
          id as string,
        );
        return;
      }
      this.finish(row.id, 'accepted', null, id as string);
    } catch {
      if (row.channel === 'email')
        this.scheduleRetry(
          row,
          'Provider acceptance is unconfirmed. A retry using the same email idempotency key is scheduled.',
        );
      else this.finish(row.id, 'uncertain', uncertainMessage);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
