import { z } from 'zod';

const text = (max = 160) =>
  z.string().trim().min(1, 'This field is required.').max(max);
export const timezoneSchema = text(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, 'Use a valid IANA timezone, such as Africa/Johannesburg.');
export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128);
export const userSchema = z
  .object({
    name: text(),
    email: emailSchema,
    password: passwordSchema,
    role: z.enum([
      'admin',
      'technician',
      'reviewer',
      'clinician',
      'patient',
      'transporter',
    ]),
  })
  .strict();
export const setupSchema = userSchema
  .omit({ role: true })
  .extend({ workspaceName: text(), timezone: timezoneSchema })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
/** Public registration deliberately excludes every laboratory staff role. */
export const portalRegistrationSchema = z
  .object({
    name: text(),
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(['patient', 'clinician', 'transporter']),
  })
  .strict();
export const preferencesSchema = z
  .object({
    urgent: z.boolean(),
    delays: z.boolean(),
    verification: z.boolean(),
  })
  .strict();
export const versionSchema = z.number().int().positive();
export const collectedAtSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    'Use a valid collection date and UTC offset.',
  )
  .transform((value) => new Date(value).toISOString());
export const recipientContactSchema = z
  .object({
    name: text().optional(),
    email: emailSchema.optional(),
    phone: z
      .string()
      .trim()
      .regex(
        /^\+[1-9]\d{7,14}$/,
        'Use an international phone number beginning with + and the country code.',
      )
      .optional(),
    channels: z
      .array(z.enum(['sms', 'email', 'whatsapp']))
      .max(3)
      .refine(
        (channels) => new Set(channels).size === channels.length,
        'Select each delivery channel once.',
      ),
    portalUserId: z.number().int().positive().safe().optional(),
  })
  .strict()
  .superRefine((contact, context) => {
    if (contact.channels.includes('email') && !contact.email)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['email'],
        message: 'An email address is required for email delivery.',
      });
    if (
      contact.channels.some(
        (channel) => channel === 'sms' || channel === 'whatsapp',
      ) &&
      !contact.phone
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phone'],
        message: 'A phone number is required for SMS or WhatsApp delivery.',
      });
  });
export const requestContactsSchema = z
  .object({
    patient: recipientContactSchema.optional(),
    clinician: recipientContactSchema.optional(),
    transporter: recipientContactSchema.optional(),
  })
  .strict();
export const sampleSchema = z
  .object({
    requestKind: z.enum(['clinician', 'self']).optional(),
    contacts: requestContactsSchema.optional(),
    patientName: text(),
    patientId: text(80),
    testName: text(),
    sampleType: text(),
    facility: text(),
    referringDoctor: text(),
    department: text(),
    priority: z.enum(['routine', 'high', 'urgent']),
    collectedAt: collectedAtSchema,
  })
  .strict();
export const transitionSchema = z.discriminatedUnion('action', [
  z
    .object({ version: versionSchema, action: z.literal('start_processing') })
    .strict(),
  z
    .object({
      version: versionSchema,
      action: z.literal('submit_verification'),
      resultSummary: text(2000),
      qualityChecked: z.literal(true, {
        errorMap: () => ({
          message:
            'Confirm the quality check before submitting for verification.',
        }),
      }),
    })
    .strict(),
  z
    .object({
      version: versionSchema,
      action: z.literal('release'),
      releaseConfirmed: z.literal(true, {
        errorMap: () => ({
          message: 'Confirm that you reviewed the recorded result.',
        }),
      }),
    })
    .strict(),
]);
export const noteSchema = z.object({ text: text(2000) }).strict();
export const recollectionSchema = z
  .object({
    version: versionSchema,
    reason: text(2000),
    instructions: text(2000),
  })
  .strict();
export const replacementSchema = z
  .object({ version: versionSchema, collectedAt: collectedAtSchema })
  .strict();
export const resolutionSchema = z.object({ resolution: text(2000) }).strict();
export const patientAccessSchema = z
  .object({ version: versionSchema, allowed: z.boolean() })
  .strict();
export const portalActionSchema = z.object({ version: versionSchema }).strict();
export const filtersSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z
      .enum([
        '',
        'received',
        'processing',
        'verification',
        'completed',
        'delayed',
        'recollection',
      ])
      .optional(),
    priority: z.enum(['', 'routine', 'high', 'urgent']).optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
