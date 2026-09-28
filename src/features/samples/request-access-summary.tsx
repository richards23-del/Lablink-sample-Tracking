import type { SampleDetail } from '@shared/types';
import { formatTime } from '@/lib/format';

export default function RequestAccessSummary({
  sample,
  timezone,
}: {
  sample: SampleDetail;
  timezone?: string;
}) {
  return (
    <section
      aria-labelledby="request-access-heading"
      className="rounded-xl border border-card-border bg-card p-5 panel-shadow"
    >
      <h2 id="request-access-heading" className="font-semibold">
        Contacts and result access
      </h2>
      <p className="mt-3 text-sm font-medium">
        {sample.requestKind === 'self'
          ? 'Patient self-request'
          : 'Clinician request'}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {sample.requestKind === 'self'
          ? 'The linked patient can view the result after laboratory release.'
          : sample.patientResultAccess
            ? 'The assigned clinician has enabled patient access to the released result.'
            : 'The assigned clinician controls patient access to the released result.'}{' '}
        Patient messages contain no result values.
      </p>
      {sample.requestKind === 'clinician' && (
        <p className="mt-3 text-xs text-muted-foreground">
          {sample.clinicalAcknowledgedAt
            ? `Clinician acknowledged ${formatTime(sample.clinicalAcknowledgedAt, timezone)}.`
            : 'Clinician acknowledgement has not been recorded.'}
        </p>
      )}
      {sample.lastClinicianReminderAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last patient reminder:{' '}
          {formatTime(sample.lastClinicianReminderAt, timezone)}
        </p>
      )}
      <dl className="mt-4 space-y-4">
        {(['patient', 'clinician', 'transporter'] as const).map((role) => {
          const contact = sample.contacts?.[role];
          return (
            <div key={role} className="border-t border-border pt-3">
              <dt className="text-xs font-semibold capitalize">{role}</dt>
              <dd className="mt-1 space-y-1 break-words text-xs text-muted-foreground">
                {contact ? (
                  <>
                    <p>{contact.name || 'Name not recorded'}</p>
                    {contact.email && (
                      <p className="break-all">{contact.email}</p>
                    )}
                    {contact.phone && <p>{contact.phone}</p>}
                    <p>
                      {contact.portalUserId
                        ? 'Portal account linked'
                        : 'No portal account linked'}
                    </p>
                    <p>
                      Messages:{' '}
                      {contact.channels.length
                        ? contact.channels
                            .map((channel) =>
                              channel === 'whatsapp'
                                ? 'WhatsApp'
                                : channel === 'sms'
                                  ? 'SMS'
                                  : 'Email',
                            )
                            .join(', ')
                        : 'No external channels selected'}
                    </p>
                  </>
                ) : (
                  'No contact recorded'
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
