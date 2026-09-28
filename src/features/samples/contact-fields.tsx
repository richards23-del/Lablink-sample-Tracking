import type {
  CreateSampleInput,
  DeliveryChannel,
  DirectoryUser,
  RecipientContact,
} from '@shared/types';
import { Field, fieldClass } from './form-fields';

type Contacts = NonNullable<CreateSampleInput['contacts']>;
type Recipient = keyof Contacts;
const recipients: { key: Recipient; label: string; description: string }[] = [
  {
    key: 'patient',
    label: 'Patient',
    description:
      'Status and availability updates. Messages contain no result values.',
  },
  {
    key: 'clinician',
    label: 'Clinician',
    description: 'Request updates, result availability and patient reminders.',
  },
  {
    key: 'transporter',
    label: 'Transporter',
    description:
      'Specimen movement and recollection updates without clinical results.',
  },
];
const channelLabels: Record<DeliveryChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

export function validateContacts(contacts: Contacts): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const { key } of recipients) {
    const contact = contacts[key];
    if (!contact) continue;
    if (contact.name && contact.name.trim().length > 160)
      fields[`contacts.${key}.name`] = 'Use 160 characters or fewer.';
    if (
      contact.email &&
      (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) ||
        contact.email.length > 254)
    )
      fields[`contacts.${key}.email`] = 'Enter a valid email address.';
    if (contact.phone && !/^\+[1-9]\d{7,14}$/.test(contact.phone.trim()))
      fields[`contacts.${key}.phone`] =
        'Use an international number, for example +27821234567.';
    if (contact.channels.includes('email') && !contact.email?.trim())
      fields[`contacts.${key}.email`] =
        'An email address is required for email updates.';
    if (
      contact.channels.some(
        (channel) => channel === 'sms' || channel === 'whatsapp',
      ) &&
      !contact.phone?.trim()
    )
      fields[`contacts.${key}.phone`] =
        'A phone number is required for SMS or WhatsApp updates.';
  }
  return fields;
}

export function cleanContacts(contacts: Contacts): Contacts {
  return Object.fromEntries(
    Object.entries(contacts).flatMap(([key, contact]) => {
      if (!contact) return [];
      const trimmed: RecipientContact = { channels: contact.channels };
      if (contact.name?.trim()) trimmed.name = contact.name.trim();
      if (contact.email?.trim()) trimmed.email = contact.email.trim();
      if (contact.phone?.trim()) trimmed.phone = contact.phone.trim();
      if (contact.portalUserId) trimmed.portalUserId = contact.portalUserId;
      return Object.keys(trimmed).length > 1 || trimmed.channels.length
        ? [[key, trimmed]]
        : [];
    }),
  );
}

export default function ContactFields({
  contacts,
  directory,
  errors,
  onChange,
}: {
  contacts: Contacts;
  directory: DirectoryUser[];
  errors: Record<string, string>;
  onChange: (contacts: Contacts) => void;
}) {
  function update(key: Recipient, patch: Partial<RecipientContact>) {
    onChange({
      ...contacts,
      [key]: { channels: [], ...contacts[key], ...patch },
    });
  }
  return (
    <div className="space-y-4">
      {recipients.map(({ key, label, description }) => {
        const contact = contacts[key] ?? { channels: [] };
        const available = directory.filter((user) => user.role === key);
        return (
          <fieldset key={key} className="rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-semibold">
              {label} contact
            </legend>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id={`contact-${key}-name`}
                label={`${label} contact name`}
                error={errors[`contacts.${key}.name`]}
              >
                <input
                  id={`contact-${key}-name`}
                  value={contact.name ?? ''}
                  onChange={(event) =>
                    update(key, { name: event.target.value })
                  }
                  maxLength={160}
                  className={fieldClass}
                  aria-invalid={!!errors[`contacts.${key}.name`]}
                  aria-describedby={
                    errors[`contacts.${key}.name`]
                      ? `contact-${key}-name-error`
                      : undefined
                  }
                />
              </Field>
              <Field
                id={`contact-${key}-account`}
                label={`${label} portal account`}
                hint="Optional. Only this linked account can open the request in its portal."
                error={errors[`contacts.${key}.portalUserId`]}
              >
                <select
                  id={`contact-${key}-account`}
                  value={contact.portalUserId ?? ''}
                  onChange={(event) => {
                    const selected = available.find(
                      (user) => user.id === Number(event.target.value),
                    );
                    update(key, {
                      portalUserId: selected?.id,
                      ...(selected
                        ? { name: selected.name, email: selected.email }
                        : {}),
                    });
                  }}
                  className={fieldClass}
                  aria-invalid={!!errors[`contacts.${key}.portalUserId`]}
                  aria-describedby={`contact-${key}-account-hint${errors[`contacts.${key}.portalUserId`] ? ` contact-${key}-account-error` : ''}`}
                >
                  <option value="">No portal account linked</option>
                  {available.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id={`contact-${key}-email`}
                label={`${label} email`}
                error={errors[`contacts.${key}.email`]}
              >
                <input
                  id={`contact-${key}-email`}
                  type="email"
                  value={contact.email ?? ''}
                  maxLength={254}
                  onChange={(event) =>
                    update(key, { email: event.target.value })
                  }
                  className={fieldClass}
                  aria-invalid={!!errors[`contacts.${key}.email`]}
                  aria-describedby={
                    errors[`contacts.${key}.email`]
                      ? `contact-${key}-email-error`
                      : undefined
                  }
                />
              </Field>
              <Field
                id={`contact-${key}-phone`}
                label={`${label} mobile number`}
                error={errors[`contacts.${key}.phone`]}
              >
                <input
                  id={`contact-${key}-phone`}
                  type="tel"
                  value={contact.phone ?? ''}
                  maxLength={16}
                  placeholder="+27821234567"
                  onChange={(event) =>
                    update(key, { phone: event.target.value })
                  }
                  className={fieldClass}
                  aria-invalid={!!errors[`contacts.${key}.phone`]}
                  aria-describedby={
                    errors[`contacts.${key}.phone`]
                      ? `contact-${key}-phone-error`
                      : undefined
                  }
                />
              </Field>
            </div>
            <fieldset className="mt-4">
              <legend className="mb-2 text-xs font-semibold">
                {label} message channels
              </legend>
              <div className="flex flex-wrap gap-4">
                {(['email', 'sms', 'whatsapp'] as DeliveryChannel[]).map(
                  (channel) => (
                    <label
                      key={channel}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={contact.channels.includes(channel)}
                        onChange={(event) =>
                          update(key, {
                            channels: event.target.checked
                              ? [...contact.channels, channel]
                              : contact.channels.filter(
                                  (value) => value !== channel,
                                ),
                          })
                        }
                      />
                      {channelLabels[channel]}
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          </fieldset>
        );
      })}
    </div>
  );
}
