import type {
  Alert,
  CreateSampleInput,
  CommunicationEvent,
  DashboardSummary,
  Note,
  Notification,
  PaginatedSamples,
  Preferences,
  RecollectionInput,
  RequestContacts,
  Role,
  Sample,
  SampleAction,
  SampleDetail,
  SampleStatus,
  TransitionInput,
  User,
} from '../shared/types.js';
import { getUser, type LabDatabase } from './database.js';
import { ApiError } from './errors.js';

type SamplePayload = Omit<
  SampleDetail,
  'id' | 'version' | 'hasAlert' | 'timeline' | 'notes' | 'allowedActions'
>;
type SampleRow = {
  id: number;
  version: number;
  payload: string;
  created_by: number;
  result_entered_by: number | null;
  released_by: number | null;
};
type StoredSample = SamplePayload & { id: number; version: number };
type AlertRow = {
  id: number;
  sample_id: number;
  kind: string;
  severity: Alert['severity'];
  title: string;
  description: string;
  blocking: number;
  created_at: string;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution: string | null;
};

export const STATUS_LABELS: Record<SampleStatus, string> = {
  received: 'Received',
  processing: 'Processing',
  verification: 'Awaiting verification',
  completed: 'Completed',
  delayed: 'Delayed',
  recollection: 'Recollection required',
};
const STATUS_COLORS: Record<SampleStatus, string> = {
  received: '#2563eb',
  processing: '#0891b2',
  verification: '#7c3aed',
  completed: '#059669',
  delayed: '#d97706',
  recollection: '#dc2626',
};
const ACTIVE_STATUSES: SampleStatus[] = [
  'received',
  'processing',
  'verification',
];
export const isStaff = (user: User): boolean =>
  ['admin', 'technician', 'reviewer'].includes(user.role);
const PORTAL_ROLES = ['clinician', 'patient', 'transporter'] as const;
export type EnqueueCommunication = (
  sampleId: number,
  event: CommunicationEvent,
  dedupeKey?: string,
) => void;
export interface IntegrationEventInput {
  event: 'rejected' | 'delayed' | 'results_available';
  reason?: string;
  instructions?: string;
  resultSummary?: string;
  source: string;
}

export class SampleService {
  constructor(
    private db: LabDatabase,
    private now: () => Date,
    private turnaroundHours: Record<CreateSampleInput['priority'], number>,
    private enqueueCommunication?: EnqueueCommunication,
  ) {}

  private readRow(id: number): SampleRow {
    const row = this.db
      .prepare('SELECT * FROM samples WHERE id = ?')
      .get(id) as SampleRow | undefined;
    if (!row) throw new ApiError(404, 'Sample not found.', 'NOT_FOUND');
    return row;
  }

  private decode(row: SampleRow): StoredSample {
    const payload = JSON.parse(row.payload) as SamplePayload;
    return {
      ...payload,
      requestKind: payload.requestKind === 'self' ? 'self' : 'clinician',
      contacts: payload.contacts ?? {},
      patientResultAccess: payload.patientResultAccess === true,
      clinicalAcknowledgedAt: payload.clinicalAcknowledgedAt ?? null,
      lastClinicianReminderAt: payload.lastClinicianReminderAt ?? null,
      id: row.id,
      version: row.version,
    };
  }

  private current(id: number): StoredSample {
    return this.decode(this.readRow(id));
  }

  private requireStaff(user: User): void {
    if (!isStaff(user))
      throw new ApiError(
        403,
        'Laboratory staff access is required.',
        'FORBIDDEN',
      );
  }

  private canRead(sample: StoredSample, user: User): boolean {
    if (isStaff(user)) return true;
    if (!PORTAL_ROLES.includes(user.role as (typeof PORTAL_ROLES)[number]))
      return false;
    return (
      sample.contacts[user.role as keyof RequestContacts]?.portalUserId ===
      user.id
    );
  }

  private authorized(id: number, user: User): StoredSample {
    const sample = this.current(id);
    if (!this.canRead(sample, user))
      throw new ApiError(404, 'Sample not found.', 'NOT_FOUND');
    return sample;
  }

  private validateContacts(contacts: RequestContacts): void {
    for (const role of PORTAL_ROLES) {
      const userId = contacts[role]?.portalUserId;
      if (userId !== undefined && getUser(this.db, userId)?.role !== role)
        throw new ApiError(
          400,
          `The linked ${role} account does not exist or has the wrong role.`,
          'INVALID_PORTAL_ASSIGNMENT',
        );
    }
  }

  private visibleLink(id: number | null, user: User): number | null {
    if (id === null || isStaff(user)) return id;
    const row = this.db
      .prepare('SELECT * FROM samples WHERE id = ?')
      .get(id) as SampleRow | undefined;
    return row && this.canRead(this.decode(row), user) ? id : null;
  }

  private save(sample: StoredSample): void {
    const { id, version, ...payload } = sample;
    const result = this.db
      .prepare(
        'UPDATE samples SET payload = ?, version = version + 1 WHERE id = ? AND version = ?',
      )
      .run(JSON.stringify(payload), id, version);
    if (result.changes !== 1)
      throw new ApiError(
        409,
        'This sample changed. Refresh it before trying again.',
        'VERSION_CONFLICT',
      );
  }

  private checkVersion(sample: StoredSample, version: number): void {
    if (sample.version !== version)
      throw new ApiError(
        409,
        'This sample changed. Refresh it before trying again.',
        'VERSION_CONFLICT',
      );
  }

  private blockingAlert(sampleId: number): boolean {
    return Boolean(
      this.db
        .prepare(
          'SELECT 1 FROM alerts WHERE sample_id = ? AND blocking = 1 AND resolved_at IS NULL LIMIT 1',
        )
        .get(sampleId),
    );
  }

  private actions(sample: StoredSample, user: User): SampleAction[] {
    if (!isStaff(user)) return [];
    const actions: SampleAction[] = [];
    const canProcess = user.role === 'admin' || user.role === 'technician';
    if (ACTIVE_STATUSES.includes(sample.status))
      actions.push('request_recollection');
    if (
      sample.status === 'recollection' &&
      !sample.replacementSampleId &&
      canProcess
    )
      actions.push('register_replacement');
    if (this.blockingAlert(sample.id)) return actions;
    if (sample.status === 'received' && canProcess)
      actions.push('start_processing');
    if (sample.status === 'processing' && canProcess)
      actions.push('submit_verification');
    if (
      sample.status === 'verification' &&
      (user.role === 'reviewer' || user.role === 'admin') &&
      sample.qualityChecked &&
      sample.resultSummary
    )
      actions.push('release');
    return actions;
  }

  private summary(sample: StoredSample, user: User): Sample {
    const {
      resultSummary: _result,
      qualityChecked: _qc,
      resultEnteredBy: _entered,
      releasedBy: _released,
      recollectionReason: _reason,
      recollectionInstructions: _instructions,
      requestKind: _requestKind,
      contacts: _contacts,
      patientResultAccess: _access,
      clinicalAcknowledgedAt: _acknowledged,
      lastClinicianReminderAt: _reminder,
      ...summary
    } = sample;
    return {
      ...summary,
      ...(user.role === 'transporter'
        ? {
            patientName: '',
            patientId: '',
            testName: '',
            referringDoctor: '',
            department: '',
          }
        : {}),
      parentSampleId: this.visibleLink(sample.parentSampleId, user),
      replacementSampleId: this.visibleLink(sample.replacementSampleId, user),
      hasAlert: Boolean(
        this.db
          .prepare(
            'SELECT 1 FROM alerts WHERE sample_id = ? AND resolved_at IS NULL LIMIT 1',
          )
          .get(sample.id),
      ),
    };
  }

  get(id: number, user: User): SampleDetail {
    const sample = this.authorized(id, user);
    if (!isStaff(user)) {
      const mayReadResult =
        sample.status === 'completed' &&
        (user.role === 'clinician' ||
          (user.role === 'patient' &&
            (sample.requestKind === 'self' || sample.patientResultAccess)));
      const ownContact = sample.contacts[user.role as keyof RequestContacts];
      return {
        ...sample,
        ...this.summary(sample, user),
        contacts: ownContact ? { [user.role]: ownContact } : {},
        resultSummary: mayReadResult ? sample.resultSummary : null,
        qualityChecked: mayReadResult && sample.qualityChecked,
        resultEnteredBy: mayReadResult ? sample.resultEnteredBy : null,
        releasedBy: mayReadResult ? sample.releasedBy : null,
        recollectionReason: null,
        recollectionInstructions: null,
        patientResultAccess:
          user.role === 'transporter' ? false : sample.patientResultAccess,
        clinicalAcknowledgedAt:
          user.role === 'transporter' ? null : sample.clinicalAcknowledgedAt,
        lastClinicianReminderAt:
          user.role === 'transporter' ? null : sample.lastClinicianReminderAt,
        notes: [],
        timeline: [],
        allowedActions: [],
      };
    }
    const notes = this.db
      .prepare(
        'SELECT id, author_name AS author, text, created_at AS createdAt FROM notes WHERE sample_id = ? ORDER BY id ASC',
      )
      .all(id) as Note[];
    const events = this.db
      .prepare(
        'SELECT id, label, actor_name AS actor, department, timestamp, detail FROM audit_events WHERE sample_id = ? ORDER BY id ASC',
      )
      .all(id) as Omit<SampleDetail['timeline'][number], 'completed'>[];
    return {
      ...sample,
      hasAlert: this.summary(sample, user).hasAlert,
      notes,
      timeline: events.map((event) => ({ ...event, completed: true })),
      allowedActions: this.actions(sample, user),
    };
  }

  private audit(
    sample: StoredSample,
    user: User,
    label: string,
    detail: string | null,
    timestamp: string,
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_events (sample_id, actor_id, actor_name, label, department, timestamp, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        sample.id,
        user.id,
        user.name,
        label,
        sample.department,
        timestamp,
        detail,
      );
  }

  preferences(userId: number): Preferences {
    const row = this.db
      .prepare(
        'SELECT urgent, delays, verification FROM preferences WHERE user_id = ?',
      )
      .get(userId) as { urgent: number; delays: number; verification: number };
    return {
      urgent: Boolean(row.urgent),
      delays: Boolean(row.delays),
      verification: Boolean(row.verification),
    };
  }

  setPreferences(userId: number, preferences: Preferences): Preferences {
    this.db
      .prepare(
        'UPDATE preferences SET urgent = ?, delays = ?, verification = ? WHERE user_id = ?',
      )
      .run(
        Number(preferences.urgent),
        Number(preferences.delays),
        Number(preferences.verification),
        userId,
      );
    return this.preferences(userId);
  }

  private notify(
    sample: StoredSample,
    preference: keyof Preferences,
    kind: Notification['kind'],
    title: string,
    message: string,
    timestamp: string,
  ): void {
    // Column names come from this internal union, never a request parameter.
    const users = this.db
      .prepare(
        `SELECT preferences.user_id FROM preferences JOIN users ON users.id = preferences.user_id WHERE preferences.${preference} = 1 AND users.role IN ('admin', 'technician', 'reviewer')`,
      )
      .all() as { user_id: number }[];
    const insert = this.db.prepare(
      'INSERT INTO notifications (user_id, sample_id, kind, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const { user_id } of users)
      insert.run(user_id, sample.id, kind, title, message, timestamp);
  }

  private event(
    sample: StoredSample,
    event: CommunicationEvent,
    dedupeKey?: string,
  ): void {
    const titles: Record<CommunicationEvent, string> = {
      received: 'Sample received',
      rejected: 'Recollection required',
      delayed: 'Turnaround update',
      results_available: 'Results update available',
      clinician_reminder: 'Result follow-up reminder',
    };
    const preference: keyof Preferences =
      event === 'results_available' || event === 'clinician_reminder'
        ? 'verification'
        : event === 'received'
          ? 'urgent'
          : 'delays';
    for (const role of PORTAL_ROLES) {
      if (event === 'clinician_reminder' && role !== 'clinician') continue;
      if (
        role === 'transporter' &&
        !['received', 'results_available'].includes(event)
      )
        continue;
      const userId = sample.contacts[role]?.portalUserId;
      if (
        !userId ||
        getUser(this.db, userId)?.role !== role ||
        (!(event === 'received' && sample.priority !== 'urgent') &&
          !this.preferences(userId)[preference])
      )
        continue;
      this.db
        .prepare(
          'INSERT INTO notifications (user_id, sample_id, kind, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          userId,
          sample.id,
          event === 'results_available' ? 'verification' : 'sample',
          titles[event],
          `There is an update for ${sample.sampleNumber}. Sign in to view the information available to your account.`,
          this.now().toISOString(),
        );
    }
    this.enqueueCommunication?.(sample.id, event, dedupeKey);
  }

  private validateCollection(collectedAt: string, earliest?: string): void {
    if (Date.parse(collectedAt) > this.now().getTime())
      throw new ApiError(
        400,
        'Collection time cannot be in the future.',
        'INVALID_COLLECTION_TIME',
      );
    if (earliest && Date.parse(collectedAt) < Date.parse(earliest))
      throw new ApiError(
        400,
        'Replacement collection time cannot precede the original collection.',
        'INVALID_COLLECTION_TIME',
      );
  }

  private insert(
    input: CreateSampleInput,
    user: User,
    parentSampleId: number | null = null,
  ): StoredSample {
    this.validateCollection(input.collectedAt);
    this.validateContacts(input.contacts ?? {});
    const timestamp = this.now().toISOString();
    const id = Number(
      this.db
        .prepare('INSERT INTO samples (payload, created_by) VALUES (?, ?)')
        .run('{}', user.id).lastInsertRowid,
    );
    const sample: SamplePayload = {
      ...input,
      requestKind: input.requestKind ?? 'clinician',
      contacts: input.contacts ?? {},
      patientResultAccess: false,
      clinicalAcknowledgedAt: null,
      lastClinicianReminderAt: null,
      sampleNumber: `LL-${this.now().getUTCFullYear()}-${String(id).padStart(6, '0')}`,
      requestNumber: `REQ-${String(id).padStart(6, '0')}`,
      status: 'received',
      statusLabel: STATUS_LABELS.received,
      receivedAt: timestamp,
      dueAt: new Date(
        this.now().getTime() + this.turnaroundHours[input.priority] * 3_600_000,
      ).toISOString(),
      updatedAt: timestamp,
      completedAt: null,
      parentSampleId,
      replacementSampleId: null,
      resultSummary: null,
      qualityChecked: false,
      resultEnteredBy: null,
      releasedBy: null,
      recollectionReason: null,
      recollectionInstructions: null,
    };
    this.db
      .prepare('UPDATE samples SET payload = ? WHERE id = ?')
      .run(JSON.stringify(sample), id);
    const stored = { ...sample, id, version: 1 };
    this.audit(
      stored,
      user,
      'Sample received',
      parentSampleId
        ? `Replacement for sample ${this.current(parentSampleId).sampleNumber}.`
        : null,
      timestamp,
    );
    if (input.priority === 'urgent')
      this.notify(
        stored,
        'urgent',
        'sample',
        'Urgent sample received',
        `${stored.sampleNumber} is ready for processing.`,
        timestamp,
      );
    this.event(stored, 'received', `received:${id}`);
    return stored;
  }

  create(input: CreateSampleInput, user: User): SampleDetail {
    if (!['admin', 'technician'].includes(user.role))
      throw new ApiError(
        403,
        'A technician or administrator must register samples.',
        'FORBIDDEN',
      );
    const sample = this.db.transaction(() => this.insert(input, user))();
    return this.get(sample.id, user);
  }

  transition(id: number, input: TransitionInput, user: User): SampleDetail {
    this.requireStaff(user);
    this.db.transaction(() => {
      const sample = this.current(id);
      this.checkVersion(sample, input.version);
      if (
        input.action === 'release'
          ? user.role === 'technician'
          : user.role === 'reviewer'
      )
        throw new ApiError(
          403,
          'Your role cannot perform this action.',
          'FORBIDDEN',
        );
      if (this.blockingAlert(id))
        throw new ApiError(
          409,
          'Resolve blocking alerts before advancing this sample.',
          'BLOCKING_ALERT',
        );
      if (!this.actions(sample, user).includes(input.action))
        throw new ApiError(
          409,
          'This action is not allowed at the current sample stage.',
          'INVALID_TRANSITION',
        );
      const timestamp = this.now().toISOString();
      if (input.action === 'start_processing') {
        sample.status = 'processing';
        this.audit(sample, user, 'Processing started', null, timestamp);
      } else if (input.action === 'submit_verification') {
        if (!input.resultSummary?.trim() || input.qualityChecked !== true)
          throw new ApiError(
            400,
            'A result summary and confirmed quality check are required.',
            'RESULT_REQUIRED',
          );
        sample.status = 'verification';
        sample.resultSummary = input.resultSummary.trim();
        sample.qualityChecked = true;
        sample.resultEnteredBy = user.name;
        this.db
          .prepare('UPDATE samples SET result_entered_by = ? WHERE id = ?')
          .run(user.id, id);
        this.audit(
          sample,
          user,
          'Submitted for verification',
          'Result summary recorded; quality check confirmed.',
          timestamp,
        );
        this.notify(
          sample,
          'verification',
          'verification',
          'Result awaiting verification',
          `${sample.sampleNumber} has a recorded result ready for review.`,
          timestamp,
        );
      } else {
        if (input.releaseConfirmed !== true)
          throw new ApiError(
            400,
            'Confirm your review before releasing the result.',
            'REVIEW_REQUIRED',
          );
        sample.status = 'completed';
        sample.completedAt = timestamp;
        sample.releasedBy = user.name;
        this.db
          .prepare('UPDATE samples SET released_by = ? WHERE id = ?')
          .run(user.id, id);
        this.audit(
          sample,
          user,
          'Result released',
          'Recorded result and quality check reviewed and confirmed.',
          timestamp,
        );
        this.notify(
          sample,
          'verification',
          'verification',
          'Result released',
          `${sample.sampleNumber} has been completed.`,
          timestamp,
        );
      }
      sample.statusLabel = STATUS_LABELS[sample.status];
      sample.updatedAt = timestamp;
      this.save(sample);
      if (input.action === 'release')
        this.event(sample, 'results_available', `results:${sample.id}`);
    })();
    return this.get(id, user);
  }

  addNote(id: number, text: string, user: User): SampleDetail {
    this.requireStaff(user);
    this.db.transaction(() => {
      const sample = this.current(id);
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          'INSERT INTO notes (sample_id, author_id, author_name, text, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, user.id, user.name, text, timestamp);
      this.audit(sample, user, 'Note added', null, timestamp);
      sample.updatedAt = timestamp;
      this.save(sample);
    })();
    return this.get(id, user);
  }

  requestRecollection(
    id: number,
    input: RecollectionInput,
    user: User,
  ): SampleDetail {
    this.requireStaff(user);
    this.db.transaction(() => {
      const sample = this.current(id);
      this.checkVersion(sample, input.version);
      if (!this.actions(sample, user).includes('request_recollection'))
        throw new ApiError(
          409,
          'Recollection can only be requested for an active sample.',
          'INVALID_TRANSITION',
        );
      const timestamp = this.now().toISOString();
      sample.status = 'recollection';
      sample.statusLabel = STATUS_LABELS.recollection;
      sample.recollectionReason = input.reason;
      sample.recollectionInstructions = input.instructions;
      sample.updatedAt = timestamp;
      this.save(sample);
      this.audit(
        sample,
        user,
        'Recollection requested',
        `Reason: ${input.reason}\nInstructions: ${input.instructions}`,
        timestamp,
      );
      this.db
        .prepare(
          'INSERT INTO alerts (sample_id, kind, severity, title, description, blocking, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          'recollection',
          'critical',
          'Recollection required',
          input.reason,
          1,
          timestamp,
        );
      this.notify(
        sample,
        'delays',
        'alert',
        'Recollection required',
        `${sample.sampleNumber}: ${input.reason}`,
        timestamp,
      );
      this.event(sample, 'rejected', `rejected:${id}`);
    })();
    return this.get(id, user);
  }

  registerReplacement(
    id: number,
    input: { version: number; collectedAt: string },
    user: User,
  ): SampleDetail {
    this.requireStaff(user);
    const replacement = this.db.transaction(() => {
      const original = this.current(id);
      this.checkVersion(original, input.version);
      if (!['admin', 'technician'].includes(user.role))
        throw new ApiError(
          403,
          'A technician or administrator must register replacements.',
          'FORBIDDEN',
        );
      if (!this.actions(original, user).includes('register_replacement'))
        throw new ApiError(
          409,
          'A replacement can only be registered once for a sample requiring recollection.',
          'INVALID_TRANSITION',
        );
      this.validateCollection(input.collectedAt, original.collectedAt);
      const replacement = this.insert(
        {
          patientName: original.patientName,
          patientId: original.patientId,
          testName: original.testName,
          sampleType: original.sampleType,
          facility: original.facility,
          referringDoctor: original.referringDoctor,
          department: original.department,
          priority: original.priority,
          collectedAt: input.collectedAt,
          requestKind: original.requestKind,
          contacts: original.contacts,
        },
        user,
        id,
      );
      const timestamp = this.now().toISOString();
      original.replacementSampleId = replacement.id;
      original.updatedAt = timestamp;
      this.save(original);
      this.audit(
        original,
        user,
        'Replacement sample registered',
        `Linked to ${replacement.sampleNumber}. Original specimen remains in recollection status.`,
        timestamp,
      );
      this.db
        .prepare(
          "UPDATE alerts SET resolved_by = ?, resolved_at = ?, resolution = ? WHERE sample_id = ? AND kind = 'recollection' AND resolved_at IS NULL",
        )
        .run(
          user.id,
          timestamp,
          `Replacement ${replacement.sampleNumber} registered.`,
          id,
        );
      return replacement;
    })();
    return this.get(replacement.id, user);
  }

  private all(): StoredSample[] {
    return (
      this.db
        .prepare('SELECT * FROM samples ORDER BY id DESC')
        .all() as SampleRow[]
    ).map((row) => this.decode(row));
  }

  setPatientAccess(
    id: number,
    input: { version: number; allowed: boolean },
    user: User,
  ): SampleDetail {
    this.db.transaction(() => {
      const sample = this.authorized(id, user);
      if (
        user.role !== 'clinician' ||
        sample.contacts.clinician?.portalUserId !== user.id
      )
        throw new ApiError(
          403,
          'Only the assigned clinician can change patient result access.',
          'FORBIDDEN',
        );
      if (sample.requestKind !== 'clinician')
        throw new ApiError(
          409,
          'Self-requested results become available to the patient when released.',
          'INVALID_REQUEST_KIND',
        );
      this.checkVersion(sample, input.version);
      if (sample.patientResultAccess === input.allowed) return;
      sample.patientResultAccess = input.allowed;
      sample.updatedAt = this.now().toISOString();
      this.save(sample);
      this.audit(
        sample,
        user,
        input.allowed
          ? 'Patient result access granted'
          : 'Patient result access withdrawn',
        null,
        sample.updatedAt,
      );
    })();
    return this.get(id, user);
  }

  acknowledgeResults(
    id: number,
    input: { version: number },
    user: User,
  ): SampleDetail {
    this.db.transaction(() => {
      const sample = this.authorized(id, user);
      if (
        user.role !== 'clinician' ||
        sample.contacts.clinician?.portalUserId !== user.id
      )
        throw new ApiError(
          403,
          'Only the assigned clinician can acknowledge results.',
          'FORBIDDEN',
        );
      this.checkVersion(sample, input.version);
      if (sample.status !== 'completed')
        throw new ApiError(
          409,
          'Results must be released before acknowledgement.',
          'RESULTS_NOT_RELEASED',
        );
      if (sample.clinicalAcknowledgedAt) return;
      const timestamp = this.now().toISOString();
      sample.clinicalAcknowledgedAt = timestamp;
      sample.updatedAt = timestamp;
      this.save(sample);
      this.audit(
        sample,
        user,
        'Released results acknowledged by clinician',
        null,
        timestamp,
      );
    })();
    return this.get(id, user);
  }

  private hasClinicianRecipient(sample: StoredSample): boolean {
    const contact = sample.contacts.clinician;
    return Boolean(
      contact && (contact.portalUserId || contact.channels.length),
    );
  }

  remindClinician(
    id: number,
    input: { version: number },
    user: User,
  ): SampleDetail {
    this.db.transaction(() => {
      const sample = this.authorized(id, user);
      if (
        user.role !== 'patient' ||
        sample.contacts.patient?.portalUserId !== user.id
      )
        throw new ApiError(
          403,
          'Only the assigned patient can request clinician follow-up.',
          'FORBIDDEN',
        );
      this.checkVersion(sample, input.version);
      if (
        sample.requestKind !== 'clinician' ||
        sample.status !== 'completed' ||
        sample.clinicalAcknowledgedAt
      )
        throw new ApiError(
          409,
          'Follow-up is available for released results awaiting clinician acknowledgement.',
          'REMINDER_UNAVAILABLE',
        );
      if (!this.hasClinicianRecipient(sample))
        throw new ApiError(
          409,
          'The laboratory must link a clinician contact before a reminder can be sent.',
          'NO_CLINICIAN_CONTACT',
        );
      if (
        sample.lastClinicianReminderAt &&
        this.now().getTime() - Date.parse(sample.lastClinicianReminderAt) <
          86_400_000
      )
        throw new ApiError(
          409,
          'A reminder has already been recorded. Wait 24 hours before requesting another.',
          'REMINDER_COOLDOWN',
        );
      const timestamp = this.now().toISOString();
      sample.lastClinicianReminderAt = timestamp;
      sample.updatedAt = timestamp;
      this.save(sample);
      this.audit(
        sample,
        user,
        'Patient requested clinician follow-up',
        null,
        timestamp,
      );
      this.event(
        sample,
        'clinician_reminder',
        `clinician-reminder:${id}:${timestamp}`,
      );
    })();
    return this.get(id, user);
  }

  refreshClinicalReminders(): void {
    this.db.transaction(() => {
      const timestamp = this.now().toISOString();
      const threshold = new Date(
        this.now().getTime() - 86_400_000,
      ).toISOString();
      const rows = this.db
        .prepare(
          `SELECT * FROM samples WHERE json_extract(payload, '$.status') = 'completed'
        AND COALESCE(json_extract(payload, '$.requestKind'), 'clinician') = 'clinician'
        AND json_extract(payload, '$.clinicalAcknowledgedAt') IS NULL
        AND COALESCE(json_extract(payload, '$.lastClinicianReminderAt'), json_extract(payload, '$.completedAt')) <= ?`,
        )
        .all(threshold) as SampleRow[];
      for (const row of rows) {
        const sample = this.decode(row);
        if (!this.hasClinicianRecipient(sample)) continue;
        sample.lastClinicianReminderAt = timestamp;
        sample.updatedAt = timestamp;
        this.save(sample);
        this.db
          .prepare(
            'INSERT INTO security_audit (actor_id, action, timestamp) VALUES (NULL, ?, ?)',
          )
          .run(`automatic_clinician_reminder:${sample.id}`, timestamp);
        this.event(
          sample,
          'clinician_reminder',
          `clinician-reminder:${sample.id}:${timestamp}`,
        );
      }
    })();
  }

  followups(user: User): Sample[] {
    this.requireStaff(user);
    const rows = this.db
      .prepare(
        `SELECT * FROM samples WHERE
      (json_extract(payload, '$.status') = 'completed' AND COALESCE(json_extract(payload, '$.requestKind'), 'clinician') = 'clinician' AND json_extract(payload, '$.clinicalAcknowledgedAt') IS NULL)
      OR (json_extract(payload, '$.status') = 'recollection' AND json_extract(payload, '$.replacementSampleId') IS NULL)
      ORDER BY json_extract(payload, '$.updatedAt') ASC, id ASC`,
      )
      .all() as SampleRow[];
    return rows.map((row) => this.summary(this.decode(row), user));
  }

  applyIntegrationEvent(
    id: number,
    input: IntegrationEventInput,
    user: User,
  ): SampleDetail {
    if (user.role !== 'admin')
      throw new ApiError(
        403,
        'An administrator-bound integration is required.',
        'FORBIDDEN',
      );
    this.db.transaction(() => {
      const sample = this.current(id);
      if (!ACTIVE_STATUSES.includes(sample.status))
        throw new ApiError(
          409,
          'The integration event cannot change a completed or recollection specimen.',
          'INVALID_TRANSITION',
        );
      const timestamp = this.now().toISOString();
      const source = input.source.trim();
      if (!source || source.length > 120)
        throw new ApiError(
          400,
          'A valid external LIS source is required.',
          'INVALID_INTEGRATION_EVENT',
        );
      if (input.event === 'rejected') {
        if (!input.reason?.trim() || !input.instructions?.trim())
          throw new ApiError(
            400,
            'A rejection reason and recollection instructions are required.',
            'INVALID_INTEGRATION_EVENT',
          );
        this.requestRecollection(
          id,
          {
            version: sample.version,
            reason: input.reason,
            instructions: input.instructions,
          },
          user,
        );
        this.audit(
          sample,
          user,
          'External LIS rejection imported',
          `Source: ${source}. Recollection requested by the authenticated integration.`,
          timestamp,
        );
      } else if (input.event === 'delayed') {
        if (!input.reason?.trim())
          throw new ApiError(
            400,
            'A delay reason is required.',
            'INVALID_INTEGRATION_EVENT',
          );
        const inserted = this.db
          .prepare(
            'INSERT OR IGNORE INTO alerts (sample_id, kind, severity, title, description, blocking, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
          )
          .run(
            id,
            'delay',
            'warning',
            'External LIS delay',
            input.reason,
            timestamp,
          );
        sample.updatedAt = timestamp;
        this.save(sample);
        this.audit(
          sample,
          user,
          'External LIS delay imported',
          `Source: ${source}. ${input.reason}`,
          timestamp,
        );
        if (inserted.changes) {
          this.notify(
            sample,
            'delays',
            'alert',
            'Sample delay reported',
            `${sample.sampleNumber} requires attention.`,
            timestamp,
          );
          this.event(sample, 'delayed', `delayed:${id}`);
        }
      } else {
        if (!input.resultSummary?.trim() || input.resultSummary.length > 2000)
          throw new ApiError(
            400,
            'A bounded released result summary is required.',
            'INVALID_INTEGRATION_EVENT',
          );
        if (this.blockingAlert(id))
          throw new ApiError(
            409,
            'Resolve blocking alerts before importing released results.',
            'BLOCKING_ALERT',
          );
        sample.status = 'completed';
        sample.statusLabel = STATUS_LABELS.completed;
        sample.resultSummary = input.resultSummary.trim();
        sample.qualityChecked = false;
        sample.resultEnteredBy = `External LIS (${source})`;
        sample.releasedBy = `External LIS (${source})`;
        sample.completedAt = timestamp;
        sample.updatedAt = timestamp;
        this.db
          .prepare(
            'UPDATE samples SET result_entered_by = NULL, released_by = NULL WHERE id = ?',
          )
          .run(id);
        this.save(sample);
        this.audit(
          sample,
          user,
          'Released result imported from external LIS',
          `Source: ${source}. Release confirmed by the trusted integration; no local quality check is claimed.`,
          timestamp,
        );
        this.notify(
          sample,
          'verification',
          'verification',
          'Released result imported',
          `${sample.sampleNumber} has a released result from the connected laboratory.`,
          timestamp,
        );
        this.event(sample, 'results_available', `results:${id}`);
      }
    })();
    return this.get(id, user);
  }
  private overdue(sample: StoredSample): boolean {
    return (
      ACTIVE_STATUSES.includes(sample.status) &&
      Date.parse(sample.dueAt) < this.now().getTime()
    );
  }

  list(
    filters: {
      search?: string;
      status?: string;
      priority?: string;
      page: number;
      pageSize: number;
    },
    user: User,
  ): PaginatedSamples {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (!isStaff(user)) {
      if (!PORTAL_ROLES.includes(user.role as (typeof PORTAL_ROLES)[number]))
        throw new ApiError(
          403,
          'This account cannot access samples.',
          'FORBIDDEN',
        );
      conditions.push(
        `json_extract(payload, '$.contacts.${user.role}.portalUserId') = ?`,
      );
      parameters.push(user.id);
    }
    if (filters.status === 'delayed') {
      conditions.push(
        "json_extract(payload, '$.status') IN ('received', 'processing', 'verification') AND json_extract(payload, '$.dueAt') < ?",
      );
      parameters.push(this.now().toISOString());
    } else if (filters.status) {
      conditions.push("json_extract(payload, '$.status') = ?");
      parameters.push(filters.status);
    }
    if (filters.priority) {
      conditions.push("json_extract(payload, '$.priority') = ?");
      parameters.push(filters.priority);
    }
    if (filters.search) {
      // Field names are fixed here; only values enter SQL bindings. instr treats % and _ literally.
      const fields =
        user.role === 'transporter'
          ? ['sampleNumber', 'requestNumber', 'facility', 'sampleType']
          : [
              'sampleNumber',
              'requestNumber',
              'patientName',
              'patientId',
              'testName',
              'facility',
            ];
      conditions.push(
        `(${fields.map((field) => `instr(lablink_fold(json_extract(payload, '$.${field}')), lablink_fold(?)) > 0`).join(' OR ')})`,
      );
      parameters.push(...fields.map(() => filters.search!));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = this.db.transaction(() => {
      const { total } = this.db
        .prepare(`SELECT COUNT(*) AS total FROM samples ${where}`)
        .get(...parameters) as { total: number };
      const rows = this.db
        .prepare(
          `SELECT * FROM samples ${where} ORDER BY json_extract(payload, '$.updatedAt') DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(
          ...parameters,
          filters.pageSize,
          (filters.page - 1) * filters.pageSize,
        ) as SampleRow[];
      return { total, rows };
    })();
    return {
      items: result.rows.map((row) => this.summary(this.decode(row), user)),
      total: result.total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  refreshOverdueAlerts(): void {
    this.db.transaction(() => {
      const timestamp = this.now().toISOString();
      const newlyOverdue = this.db
        .prepare(
          `
        SELECT * FROM samples
        WHERE json_extract(payload, '$.status') IN ('received', 'processing', 'verification')
          AND json_extract(payload, '$.dueAt') < ?
          AND NOT EXISTS (SELECT 1 FROM alerts WHERE sample_id = samples.id AND kind = 'delay')
      `,
        )
        .all(timestamp) as SampleRow[];
      for (const row of newlyOverdue) {
        const sample = this.decode(row);
        const inserted = this.db
          .prepare(
            'INSERT OR IGNORE INTO alerts (sample_id, kind, severity, title, description, blocking, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            sample.id,
            'delay',
            'warning',
            'Turnaround target exceeded',
            `${sample.sampleNumber} has exceeded its configured turnaround target.`,
            0,
            timestamp,
          );
        if (inserted.changes) {
          this.notify(
            sample,
            'delays',
            'alert',
            'Turnaround target exceeded',
            `${sample.sampleNumber} requires attention.`,
            timestamp,
          );
          this.event(sample, 'delayed', `delayed:${sample.id}`);
        }
      }
    })();
  }

  alerts(): Alert[] {
    const rows = this.db
      .prepare('SELECT * FROM alerts ORDER BY id DESC')
      .all() as AlertRow[];
    return rows.map((row) => {
      const sample = this.current(row.sample_id);
      const acknowledgedBy = row.acknowledged_by
        ? (
            this.db
              .prepare('SELECT name FROM users WHERE id = ?')
              .get(row.acknowledged_by) as { name: string }
          ).name
        : null;
      return {
        id: row.id,
        sampleId: sample.id,
        sampleNumber: sample.sampleNumber,
        patientName: sample.patientName,
        severity: row.severity,
        title: row.title,
        description: row.description,
        action:
          row.kind === 'recollection'
            ? 'Register replacement'
            : 'Review sample',
        createdAt: row.created_at,
        acknowledged: row.acknowledged_at !== null,
        acknowledgedAt: row.acknowledged_at,
        acknowledgedBy,
        resolved: row.resolved_at !== null,
        resolution: row.resolution,
      };
    });
  }

  acknowledgeAlert(id: number, user: User): Alert {
    this.requireStaff(user);
    this.db.transaction(() => {
      const alert = this.db
        .prepare('SELECT * FROM alerts WHERE id = ?')
        .get(id) as AlertRow | undefined;
      if (!alert) throw new ApiError(404, 'Alert not found.', 'NOT_FOUND');
      if (alert.acknowledged_at) return;
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          'UPDATE alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ?',
        )
        .run(user.id, timestamp, id);
      this.audit(
        this.current(alert.sample_id),
        user,
        'Alert acknowledged',
        alert.title,
        timestamp,
      );
    })();
    return this.alerts().find((alert) => alert.id === id)!;
  }

  resolveAlert(id: number, resolution: string, user: User): Alert {
    if (!['admin', 'reviewer'].includes(user.role))
      throw new ApiError(
        403,
        'A reviewer or administrator must resolve alerts.',
        'FORBIDDEN',
      );
    this.db.transaction(() => {
      const alert = this.db
        .prepare('SELECT * FROM alerts WHERE id = ?')
        .get(id) as AlertRow | undefined;
      if (!alert) throw new ApiError(404, 'Alert not found.', 'NOT_FOUND');
      if (alert.resolved_at) return;
      if (
        alert.kind === 'recollection' &&
        !this.current(alert.sample_id).replacementSampleId
      )
        throw new ApiError(
          409,
          'Register a replacement specimen before resolving the recollection alert.',
          'REPLACEMENT_REQUIRED',
        );
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          'UPDATE alerts SET resolved_by = ?, resolved_at = ?, resolution = ? WHERE id = ?',
        )
        .run(user.id, timestamp, resolution, id);
      this.audit(
        this.current(alert.sample_id),
        user,
        'Alert resolved',
        `${alert.title}: ${resolution}`,
        timestamp,
      );
    })();
    return this.alerts().find((alert) => alert.id === id)!;
  }

  notifications(userId: number): Notification[] {
    const user = getUser(this.db, userId);
    if (!user)
      throw new ApiError(401, 'Sign in to continue.', 'UNAUTHENTICATED');
    const rows = this.db
      .prepare(
        'SELECT id, sample_id, kind, title, message, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC',
      )
      .all(userId) as {
      id: number;
      sample_id: number | null;
      kind: Notification['kind'];
      title: string;
      message: string;
      created_at: string;
      read_at: string | null;
    }[];
    return rows
      .filter(
        (row) =>
          isStaff(user) ||
          (row.sample_id !== null &&
            this.canRead(this.current(row.sample_id), user)),
      )
      .map((row) => ({
        id: row.id,
        sampleId: row.sample_id,
        sampleNumber: row.sample_id
          ? this.current(row.sample_id).sampleNumber
          : null,
        kind: row.kind,
        title: isStaff(user) ? row.title : 'Sample update available',
        message: isStaff(user)
          ? row.message
          : 'Sign in to view the information available to your account.',
        createdAt: row.created_at,
        read: row.read_at !== null,
      }));
  }

  readNotification(id: number, userId: number): Notification {
    const user = getUser(this.db, userId);
    if (!user)
      throw new ApiError(401, 'Sign in to continue.', 'UNAUTHENTICATED');
    const exists = this.db
      .prepare(
        'SELECT id, sample_id FROM notifications WHERE id = ? AND user_id = ?',
      )
      .get(id, userId) as { id: number; sample_id: number | null } | undefined;
    if (
      !exists ||
      (!isStaff(user) &&
        (exists.sample_id === null ||
          !this.canRead(this.current(exists.sample_id), user)))
    )
      throw new ApiError(404, 'Notification not found.', 'NOT_FOUND');
    this.db
      .prepare(
        'UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?',
      )
      .run(this.now().toISOString(), id, userId);
    const row = this.db
      .prepare(
        'SELECT sample_id, kind, title, message, created_at FROM notifications WHERE id = ?',
      )
      .get(id) as {
      sample_id: number | null;
      kind: Notification['kind'];
      title: string;
      message: string;
      created_at: string;
    };
    return {
      id,
      sampleId: row.sample_id,
      sampleNumber: row.sample_id
        ? this.current(row.sample_id).sampleNumber
        : null,
      kind: row.kind,
      title: isStaff(user) ? row.title : 'Sample update available',
      message: isStaff(user)
        ? row.message
        : 'Sign in to view the information available to your account.',
      createdAt: row.created_at,
      read: true,
    };
  }

  dashboard(timezone: string): DashboardSummary {
    const samples = this.all();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dateKey = (value: string | Date) => formatter.format(new Date(value));
    const today = dateKey(this.now());
    const completed = samples.filter((sample) => sample.status === 'completed');
    const completedToday = completed.filter(
      (sample) => sample.completedAt && dateKey(sample.completedAt) === today,
    );
    const weeklyVolume = Array.from({ length: 7 }, (_, index) => {
      // Calendar arithmetic in UTC avoids local daylight-saving offsets after determining today's workspace date.
      const day = new Date(`${today}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() - 6 + index);
      const date = day.toISOString().slice(0, 10);
      return {
        day: new Intl.DateTimeFormat('en', {
          weekday: 'short',
          timeZone: 'UTC',
        }).format(day),
        date,
        received: samples.filter(
          (sample) => dateKey(sample.receivedAt) === date,
        ).length,
        completed: completed.filter(
          (sample) =>
            sample.completedAt && dateKey(sample.completedAt) === date,
        ).length,
      };
    });
    return {
      receivedToday: samples.filter(
        (sample) => dateKey(sample.receivedAt) === today,
      ).length,
      processing: samples.filter((sample) => sample.status === 'processing')
        .length,
      delayed: samples.filter((sample) => this.overdue(sample)).length,
      awaitingVerification: samples.filter(
        (sample) => sample.status === 'verification',
      ).length,
      completedToday: completedToday.length,
      turnaroundRate: completedToday.length
        ? Math.round(
            (completedToday.filter(
              (sample) => sample.completedAt! <= sample.dueAt,
            ).length /
              completedToday.length) *
              100,
          )
        : 0,
      recollections: samples.filter(
        (sample) =>
          sample.status === 'recollection' && !sample.replacementSampleId,
      ).length,
      weeklyVolume,
      statusBreakdown: (
        [
          'received',
          'processing',
          'verification',
          'completed',
          'recollection',
        ] as SampleStatus[]
      ).map((status) => ({
        status,
        label: STATUS_LABELS[status],
        count: samples.filter((sample) => sample.status === status).length,
        color: STATUS_COLORS[status],
      })),
    };
  }
}
