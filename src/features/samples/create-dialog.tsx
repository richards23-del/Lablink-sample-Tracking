import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import type { CreateSampleInput, Priority } from '@shared/types';
import { useCreateSample, useDirectory } from '@/lib/api';
import ContactFields, {
  cleanContacts,
  validateContacts,
} from './contact-fields';
import { toDateTimeLocal } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  boundedTextError,
  collectionDateError,
  errorFields,
  errorMessage,
  Field,
  fieldClass,
  focusFirstInvalid,
  FormError,
  useDialogReturnFocus,
} from './form-fields';

type TextField =
  | 'patientName'
  | 'patientId'
  | 'testName'
  | 'sampleType'
  | 'facility'
  | 'referringDoctor'
  | 'department';

const intakeFields: {
  name: TextField;
  label: string;
  max: number;
  placeholder?: string;
}[] = [
  { name: 'patientName', label: 'Patient name', max: 160 },
  { name: 'patientId', label: 'Patient identifier', max: 80 },
  {
    name: 'testName',
    label: 'Requested test',
    max: 160,
    placeholder: 'Use your laboratory test catalog',
  },
  { name: 'sampleType', label: 'Specimen type', max: 160 },
  { name: 'facility', label: 'Referring facility', max: 160 },
  { name: 'referringDoctor', label: 'Referring doctor', max: 160 },
  { name: 'department', label: 'Laboratory department', max: 160 },
];

export default function CreateSampleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: number) => void;
}) {
  const create = useCreateSample();
  const directory = useDirectory();
  const returnFocus = useDialogReturnFocus();
  const [values, setValues] = useState<CreateSampleInput>({
    patientName: '',
    patientId: '',
    testName: '',
    sampleType: '',
    facility: '',
    referringDoctor: '',
    department: '',
    priority: 'routine',
    collectedAt: '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [requestKind, setRequestKind] = useState<'clinician' | 'self'>(
    'clinician',
  );
  const [contacts, setContacts] = useState<
    NonNullable<CreateSampleInput['contacts']>
  >({});
  const [contactsOpen, setContactsOpen] = useState(false);

  function change(name: TextField | 'priority' | 'collectedAt', value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFields((current) => ({ ...current, [name]: '' }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    const form = event.currentTarget;
    const nextFields: Record<string, string> = validateContacts(contacts);
    if (Object.keys(nextFields).length) setContactsOpen(true);
    for (const field of intakeFields) {
      const error = boundedTextError(
        values[field.name],
        field.label,
        field.max,
      );
      if (error) nextFields[field.name] = error;
    }
    const dateError = collectionDateError(values.collectedAt);
    if (dateError) nextFields.collectedAt = dateError;
    setFields(nextFields);
    setMessage('');
    if (Object.keys(nextFields).length) {
      focusFirstInvalid(form);
      return;
    }
    const input = {
      ...values,
      requestKind,
      contacts: cleanContacts(contacts),
      collectedAt: new Date(values.collectedAt).toISOString(),
    };
    for (const field of intakeFields)
      input[field.name] = input[field.name].trim();
    try {
      const sample = await create.mutateAsync(input);
      onCreated(sample.id);
    } catch (error) {
      setFields(errorFields(error));
      setMessage(errorMessage(error));
      focusFirstInvalid(form);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-2xl"
        onCloseAutoFocus={returnFocus}
        onEscapeKeyDown={(event) => {
          if (create.isPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (create.isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Register a sample</DialogTitle>
          <DialogDescription>
            Record the received specimen. Specimen fields are required; add
            contact details and portal access when available.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={submit}
          noValidate
          className="space-y-5"
          aria-busy={create.isPending}
        >
          <FormError message={message} />
          <fieldset
            disabled={create.isPending}
            className="grid gap-4 sm:grid-cols-2"
          >
            {intakeFields.map((field) => (
              <Field
                key={field.name}
                id={`intake-${field.name}`}
                label={field.label}
                error={fields[field.name]}
              >
                <input
                  id={`intake-${field.name}`}
                  name={field.name}
                  data-testid={`input-${field.name}`}
                  className={fieldClass}
                  required
                  maxLength={field.max}
                  placeholder={field.placeholder}
                  value={values[field.name]}
                  onChange={(event) => change(field.name, event.target.value)}
                  autoComplete="off"
                  aria-invalid={!!fields[field.name]}
                  aria-describedby={
                    fields[field.name]
                      ? `intake-${field.name}-error`
                      : undefined
                  }
                />
              </Field>
            ))}
            <Field
              id="intake-priority"
              label="Priority"
              error={fields.priority}
            >
              <select
                id="intake-priority"
                className={fieldClass}
                value={values.priority}
                onChange={(event) =>
                  change('priority', event.target.value as Priority)
                }
                aria-invalid={!!fields.priority}
                aria-describedby={
                  fields.priority ? 'intake-priority-error' : undefined
                }
              >
                <option value="routine">Routine</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field
                id="intake-collectedAt"
                label="Collected at"
                hint="Enter the time shown in this device’s local time zone."
                error={fields.collectedAt}
              >
                <input
                  id="intake-collectedAt"
                  name="collectedAt"
                  type="datetime-local"
                  required
                  max={toDateTimeLocal(new Date().toISOString())}
                  className={fieldClass}
                  value={values.collectedAt}
                  onChange={(event) =>
                    change('collectedAt', event.target.value)
                  }
                  aria-invalid={!!fields.collectedAt}
                  aria-describedby={`intake-collectedAt-hint${fields.collectedAt ? ' intake-collectedAt-error' : ''}`}
                />
              </Field>
            </div>
          </fieldset>
          <fieldset disabled={create.isPending} className="space-y-4">
            <Field id="intake-request-kind" label="Request origin">
              <select
                id="intake-request-kind"
                value={requestKind}
                onChange={(event) => {
                  const kind = event.target.value as 'clinician' | 'self';
                  setRequestKind(kind);
                  if (kind === 'self' && !values.referringDoctor.trim())
                    change('referringDoctor', 'Self-request');
                  if (
                    kind === 'clinician' &&
                    values.referringDoctor === 'Self-request'
                  )
                    change('referringDoctor', '');
                }}
                className={fieldClass}
              >
                <option value="clinician">Clinician request</option>
                <option value="self">Patient self-request</option>
              </select>
            </Field>
            <p className="rounded-lg bg-secondary/70 p-3 text-xs leading-relaxed text-muted-foreground">
              {requestKind === 'self'
                ? 'The linked patient can view their result after laboratory release.'
                : 'The assigned clinician reviews released results and decides when the linked patient may view them.'}{' '}
              Patient messages contain availability updates, never result
              values.
            </p>
            <details
              open={contactsOpen}
              onToggle={(event) => setContactsOpen(event.currentTarget.open)}
              className="rounded-xl border border-border p-4"
            >
              <summary className="cursor-pointer text-sm font-semibold">
                Contacts and notification preferences (optional)
              </summary>
              <div className="mt-4 space-y-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Select the recipient’s agreed channels. A portal account must
                  be explicitly linked for online access; entering an email
                  address alone does not grant access. Administrators create
                  accounts in Settings.
                </p>
                {directory.isError && (
                  <p role="alert" className="text-xs text-destructive">
                    Portal accounts could not be loaded. Contact details can
                    still be entered.{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => directory.refetch()}
                    >
                      Retry account lookup
                    </button>
                  </p>
                )}
                {directory.isLoading && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Loading portal accounts…
                  </p>
                )}
                <ContactFields
                  contacts={contacts}
                  directory={directory.data ?? []}
                  errors={fields}
                  onChange={(next) => {
                    setContacts(next);
                    setFields((current) =>
                      Object.fromEntries(
                        Object.entries(current).filter(
                          ([key]) => !key.startsWith('contacts.'),
                        ),
                      ),
                    );
                  }}
                />
              </div>
            </details>
          </fieldset>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending}
              data-testid="button-submit-sample"
            >
              {create.isPending && <Loader2 className="animate-spin" />}Register
              sample
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
