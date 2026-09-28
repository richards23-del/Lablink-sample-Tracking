export type Role =
  'admin' | 'technician' | 'reviewer' | 'clinician' | 'patient' | 'transporter';
export type DeliveryChannel = 'sms' | 'email' | 'whatsapp';
export interface RecipientContact {
  name?: string;
  email?: string;
  phone?: string;
  channels: DeliveryChannel[];
  portalUserId?: number;
}
export interface RequestContacts {
  patient?: RecipientContact;
  clinician?: RecipientContact;
  transporter?: RecipientContact;
}
export type CommunicationEvent =
  | 'received'
  | 'rejected'
  | 'delayed'
  | 'results_available'
  | 'clinician_reminder';
export type SampleStatus =
  | 'received'
  | 'processing'
  | 'verification'
  | 'completed'
  | 'delayed'
  | 'recollection';
export type Priority = 'routine' | 'high' | 'urgent';
export type SampleAction =
  | 'start_processing'
  | 'submit_verification'
  | 'release'
  | 'request_recollection'
  | 'register_replacement';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  workspaceName: string;
  timezone: string;
}
export type DirectoryUser = Pick<User, 'id' | 'name' | 'email' | 'role'>;

export interface Session {
  user: User | null;
  csrfToken: string | null;
  setupRequired: boolean;
  setupAllowed: boolean;
}

export interface Preferences {
  urgent: boolean;
  delays: boolean;
  verification: boolean;
}

export interface Sample {
  id: number;
  version: number;
  sampleNumber: string;
  requestNumber: string;
  patientName: string;
  patientId: string;
  testName: string;
  sampleType: string;
  facility: string;
  referringDoctor: string;
  department: string;
  priority: Priority;
  status: SampleStatus;
  statusLabel: string;
  hasAlert: boolean;
  collectedAt: string;
  receivedAt: string;
  dueAt: string;
  updatedAt: string;
  completedAt: string | null;
  parentSampleId: number | null;
  replacementSampleId: number | null;
}

export interface AuditEvent {
  id: number;
  label: string;
  actor: string;
  department: string;
  timestamp: string;
  detail: string | null;
  completed: boolean;
}

export interface Note {
  id: number;
  author: string;
  text: string;
  createdAt: string;
}

export interface SampleDetail extends Sample {
  requestKind: 'clinician' | 'self';
  contacts: RequestContacts;
  patientResultAccess: boolean;
  clinicalAcknowledgedAt: string | null;
  lastClinicianReminderAt: string | null;
  timeline: AuditEvent[];
  notes: Note[];
  allowedActions: SampleAction[];
  resultSummary: string | null;
  qualityChecked: boolean;
  resultEnteredBy: string | null;
  releasedBy: string | null;
  recollectionReason: string | null;
  recollectionInstructions: string | null;
}

export interface CreateSampleInput {
  requestKind?: 'clinician' | 'self';
  contacts?: RequestContacts;
  patientName: string;
  patientId: string;
  testName: string;
  sampleType: string;
  facility: string;
  referringDoctor: string;
  department: string;
  priority: Priority;
  collectedAt: string;
}

export interface TransitionInput {
  version: number;
  action: 'start_processing' | 'submit_verification' | 'release';
  resultSummary?: string;
  qualityChecked?: boolean;
  releaseConfirmed?: boolean;
}

export interface RecollectionInput {
  version: number;
  reason: string;
  instructions: string;
}

export interface SampleFilters {
  search?: string;
  status?: SampleStatus | '';
  priority?: Priority | '';
  page?: number;
  pageSize?: number;
}

export interface PaginatedSamples {
  items: Sample[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Alert {
  id: number;
  sampleId: number;
  sampleNumber: string;
  patientName: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  action: string;
  createdAt: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolved: boolean;
  resolution: string | null;
}

export interface Notification {
  id: number;
  sampleId: number | null;
  sampleNumber: string | null;
  kind: 'alert' | 'verification' | 'sample';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface DashboardSummary {
  receivedToday: number;
  processing: number;
  delayed: number;
  awaitingVerification: number;
  completedToday: number;
  turnaroundRate: number;
  recollections: number;
  weeklyVolume: {
    day: string;
    date: string;
    received: number;
    completed: number;
  }[];
  statusBreakdown: {
    status: SampleStatus;
    label: string;
    count: number;
    color: string;
  }[];
}

export interface ApiErrorBody {
  message: string;
  code?: string;
  fields?: Record<string, string>;
}
