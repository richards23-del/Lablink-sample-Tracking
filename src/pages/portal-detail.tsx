import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Check, Loader2, Mail, ShieldCheck } from 'lucide-react';
import {
  ApiError,
  useAcknowledgeResults,
  usePatientAccess,
  useRemindClinician,
  useSample,
  useSession,
} from '@/lib/api';
import { formatTime, parseSampleId } from '@/lib/format';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  statusTone,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { errorMessage, FormError } from '@/features/samples/form-fields';

export default function PortalDetailPage() {
  const { id: parameter } = useParams<{ id: string }>();
  const id = parseSampleId(parameter);
  const session = useSession();
  const query = useSample(id ?? 0);
  const grant = usePatientAccess();
  const acknowledge = useAcknowledgeResults();
  const remind = useRemindClinician();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sample = query.data;
  const role = session.data?.user?.role;
  const timezone = session.data?.user?.timezone;
  const transporter = role === 'transporter';
  const pending = grant.isPending || acknowledge.isPending || remind.isPending;
  const back = (
    <Link
      href="/"
      className="mb-6 inline-flex items-center gap-2 rounded text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft size={16} />
      Back to requests
    </Link>
  );

  async function act(action: 'grant' | 'acknowledge' | 'remind') {
    if (!sample || pending) return;
    setError('');
    setNotice('');
    const input = { id: sample.id, version: sample.version };
    try {
      if (action === 'grant') {
        await grant.mutateAsync({
          ...input,
          allowed: !sample.patientResultAccess,
        });
        setNotice(
          sample.patientResultAccess
            ? 'Patient result access withdrawn.'
            : 'Patient result access enabled.',
        );
      } else if (action === 'acknowledge') {
        await acknowledge.mutateAsync(input);
        setNotice('Your result acknowledgement has been recorded.');
      } else {
        await remind.mutateAsync(input);
        setNotice('Your reminder has been recorded for the clinician.');
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  if (
    id === null ||
    (query.error instanceof ApiError && [403, 404].includes(query.error.status))
  )
    return (
      <div>
        {back}
        <EmptyState
          title="Request not found"
          description="This request is unavailable to your account. Contact the laboratory if you expected access."
        />
      </div>
    );
  if (query.isLoading)
    return (
      <div>
        {back}
        <LoadingState />
      </div>
    );
  if (!sample)
    return (
      <div>
        {back}
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  const released = sample.status === 'completed';
  const nextReminder = sample.lastClinicianReminderAt
    ? new Date(new Date(sample.lastClinicianReminderAt).getTime() + 86_400_000)
    : null;
  const reminderCoolingDown =
    !!nextReminder && nextReminder.getTime() > Date.now();

  return (
    <div className="page-enter">
      {back}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono-ui text-sm font-semibold text-primary">
            {sample.sampleNumber}
          </span>
          <Badge tone={statusTone[sample.status]}>{sample.statusLabel}</Badge>
        </div>
        <h1 className="mt-3 break-words text-3xl font-bold tracking-tight">
          {transporter
            ? 'Specimen logistics'
            : role === 'clinician'
              ? sample.patientName
              : sample.testName}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {transporter
            ? sample.facility
            : role === 'clinician'
              ? sample.testName
              : sample.facility}
        </p>
      </div>
      <FormError message={error} />
      {notice && (
        <p role="status" className="mb-5 rounded-lg bg-secondary p-3 text-sm">
          {notice}
        </p>
      )}
      {query.isRefetchError && (
        <p role="alert" className="mb-5 text-sm text-destructive">
          The latest changes could not be loaded. Refresh this page before
          taking another action.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="min-w-0 space-y-5">
          {!transporter && (
            <section
              aria-labelledby="portal-result-heading"
              className="rounded-xl border border-card-border bg-card p-5 panel-shadow"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck size={19} className="text-primary" />
                <h2 id="portal-result-heading" className="font-semibold">
                  Result access
                </h2>
              </div>
              {sample.resultSummary ? (
                <>
                  <h3 className="mt-4 text-sm font-semibold">
                    Released result
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {sample.resultSummary}
                  </p>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Released {formatTime(sample.completedAt, timezone)}
                    {sample.releasedBy ? ` by ${sample.releasedBy}` : ''}.
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {released
                    ? 'The laboratory has released this result. Your assigned clinician manages when the result becomes visible to you.'
                    : 'The result will be available after processing and laboratory release. Status updates will appear here.'}
                </p>
              )}
              {role === 'patient' &&
                sample.requestKind === 'clinician' &&
                released && (
                  <div className="mt-5 border-t border-border pt-4">
                    {sample.clinicalAcknowledgedAt ? (
                      <p className="text-sm text-muted-foreground">
                        Your clinician acknowledged the result on{' '}
                        {formatTime(sample.clinicalAcknowledgedAt, timezone)}.
                        Contact your clinician for the next steps.
                      </p>
                    ) : (
                      <>
                        <p className="mb-3 text-sm text-muted-foreground">
                          Your clinician has not yet acknowledged this result.
                          You can send one reminder every 24 hours.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            pending ||
                            reminderCoolingDown ||
                            query.isRefetchError
                          }
                          onClick={() => act('remind')}
                        >
                          {remind.isPending ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Mail />
                          )}
                          Remind clinician
                        </Button>
                        {reminderCoolingDown && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Another reminder can be sent after{' '}
                            {formatTime(nextReminder!.toISOString(), timezone)}.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
            </section>
          )}
          {role === 'clinician' && released && (
            <section
              aria-labelledby="clinical-review-heading"
              className="rounded-xl border border-card-border bg-card p-5 panel-shadow"
            >
              <h2 id="clinical-review-heading" className="font-semibold">
                Clinical review
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Acknowledge the released result after reviewing it. Patient
                access is a separate decision for clinician requests.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {sample.clinicalAcknowledgedAt ? (
                  <p className="text-sm text-primary">
                    Acknowledged{' '}
                    {formatTime(sample.clinicalAcknowledgedAt, timezone)}
                  </p>
                ) : (
                  <Button
                    type="button"
                    disabled={pending || query.isRefetchError}
                    onClick={() => act('acknowledge')}
                  >
                    {acknowledge.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Check />
                    )}
                    Acknowledge results
                  </Button>
                )}
                {sample.requestKind === 'clinician' && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || query.isRefetchError}
                    onClick={() => act('grant')}
                  >
                    {grant.isPending && <Loader2 className="animate-spin" />}
                    {sample.patientResultAccess
                      ? 'Withdraw patient result access'
                      : 'Allow patient to view result'}
                  </Button>
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {sample.requestKind === 'self'
                  ? 'This is a self-request. The linked patient can view the released result.'
                  : sample.patientResultAccess
                    ? 'The linked patient may currently view the released result.'
                    : 'The result is currently hidden from the linked patient.'}
              </p>
            </section>
          )}
          {sample.status === 'recollection' && (
            <section
              aria-labelledby="portal-recollection-heading"
              className="rounded-xl border border-orange-200 bg-orange-50 p-5"
            >
              <h2
                id="portal-recollection-heading"
                className="font-semibold text-orange-950"
              >
                New specimen required
              </h2>
              <p className="mt-2 text-sm text-orange-950">
                {role === 'patient' && sample.requestKind === 'clinician'
                  ? 'Please visit your healthcare provider to arrange the replacement specimen.'
                  : transporter
                    ? 'Coordinate the replacement collection with the laboratory.'
                    : 'Contact the laboratory or collection team to arrange the replacement specimen.'}
              </p>
              {role === 'clinician' && sample.recollectionReason && (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-orange-950">
                  <span className="font-semibold">Rejection reason: </span>
                  {sample.recollectionReason}
                </p>
              )}
              {!transporter && sample.recollectionInstructions && (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-orange-950">
                  {sample.recollectionInstructions}
                </p>
              )}
            </section>
          )}
          {(sample.parentSampleId || sample.replacementSampleId) && (
            <section
              aria-label="Related specimens"
              className="flex flex-wrap gap-3 rounded-xl border border-card-border bg-card p-5"
            >
              {sample.parentSampleId && (
                <Button asChild variant="outline">
                  <Link href={`/samples/${sample.parentSampleId}`}>
                    View original specimen
                  </Link>
                </Button>
              )}
              {sample.replacementSampleId && (
                <Button asChild variant="outline">
                  <Link href={`/samples/${sample.replacementSampleId}`}>
                    View replacement specimen
                  </Link>
                </Button>
              )}
            </section>
          )}
        </div>
        <section
          aria-labelledby="portal-request-heading"
          className="h-fit rounded-xl border border-card-border bg-card p-5 panel-shadow"
        >
          <h2 id="portal-request-heading" className="font-semibold">
            {transporter ? 'Collection and delivery' : 'Request details'}
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ['Request number', sample.requestNumber],
              ['Facility', sample.facility],
              ['Specimen type', sample.sampleType],
              ['Priority', sample.priority],
              ...(!transporter
                ? [
                    [
                      'Request origin',
                      sample.requestKind === 'self'
                        ? 'Patient self-request'
                        : 'Clinician request',
                    ],
                    ['Referring clinician', sample.referringDoctor],
                  ]
                : []),
              ['Collected', formatTime(sample.collectedAt, timezone)],
              ['Received', formatTime(sample.receivedAt, timezone)],
              ['Last update', formatTime(sample.updatedAt, timezone)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-4 border-b border-border pb-3 last:border-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words text-right font-medium">
                  {value || 'Not recorded'}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}
