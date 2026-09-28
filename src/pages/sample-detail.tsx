import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  FileCheck2,
  Loader2,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { SampleDetail } from '@shared/types';
import {
  ApiError,
  useAddNote,
  useSample,
  useSession,
  useTransitionSample,
} from '@/lib/api';
import { formatRelative, formatTime, parseSampleId } from '@/lib/format';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  statusTone,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import WorkflowDialog, {
  type WorkflowMode,
} from '@/features/samples/workflow-dialog';
import RequestAccessSummary from '@/features/samples/request-access-summary';
import {
  boundedTextError,
  errorMessage,
  Field,
  fieldClass,
  FormError,
} from '@/features/samples/form-fields';

function BackToSamples() {
  return (
    <Link
      href="/samples"
      className="mb-6 inline-flex items-center gap-2 rounded text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft size={16} />
      Back to samples
    </Link>
  );
}

function SampleTimeline({
  sample,
  timezone,
}: {
  sample: SampleDetail;
  timezone?: string;
}) {
  return (
    <section
      className="panel-shadow rounded-xl border border-card-border bg-card p-5"
      aria-labelledby="timeline-heading"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 id="timeline-heading" className="font-semibold">
            Chain of custody
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Recorded specimen events and their authors.
          </p>
        </div>
        <ShieldCheck size={19} className="text-primary" />
      </div>
      <ol className="mt-6">
        {sample.timeline.map((event, index) => (
          <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
            {index < sample.timeline.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-4 top-8 bottom-0 w-px bg-border"
              />
            )}
            <div
              aria-hidden="true"
              className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-primary"
            >
              <Check size={15} strokeWidth={3} />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{event.label}</h3>
                <time
                  dateTime={event.timestamp}
                  className="font-mono-ui text-[10px] text-muted-foreground"
                >
                  {formatTime(event.timestamp, timezone)}
                </time>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.actor} · {event.department}
              </p>
              {event.detail && (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {event.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!sample.timeline.length && (
        <p className="mt-4 text-sm text-muted-foreground">
          No custody events are available.
        </p>
      )}
    </section>
  );
}

function OperationalNotes({
  sample,
  timezone,
}: {
  sample: SampleDetail;
  timezone?: string;
}) {
  const addNote = useAddNote();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addNote.isPending) return;
    const validation = boundedTextError(text, 'An operational note', 2000);
    if (validation) {
      setError(validation);
      return;
    }
    const submittedText = text;
    setError('');
    setSaved(false);
    try {
      await addNote.mutateAsync({ id: sample.id, text: submittedText.trim() });
      // A user can draft the next note while this request is being saved.
      setText((current) => (current === submittedText ? '' : current));
      setSaved(true);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return (
    <section
      className="panel-shadow rounded-xl border border-card-border bg-card p-5"
      aria-labelledby="notes-heading"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 id="notes-heading" className="font-semibold">
            Operational notes
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Visible to the laboratory team and attributed to the signed-in user.
          </p>
        </div>
        <MessageSquareText size={18} className="text-muted-foreground" />
      </div>
      <div className="mt-5 space-y-3">
        {sample.notes.length ? (
          sample.notes.map((note) => (
            <article key={note.id} className="rounded-lg bg-muted/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold">{note.author}</h3>
                <time
                  dateTime={note.createdAt}
                  title={formatTime(note.createdAt, timezone)}
                  className="font-mono-ui text-[10px] text-muted-foreground"
                >
                  {formatRelative(note.createdAt)}
                </time>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                {note.text}
              </p>
            </article>
          ))
        ) : (
          <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            No notes have been added yet.
          </p>
        )}
      </div>
      <form
        onSubmit={submit}
        className="mt-5 space-y-3"
        noValidate
        aria-busy={addNote.isPending}
      >
        <Field
          id="operational-note"
          label="Add an operational note"
          hint="Up to 2,000 characters."
          error={error}
        >
          <textarea
            id="operational-note"
            rows={3}
            maxLength={2000}
            required
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError('');
              setSaved(false);
            }}
            className={fieldClass}
            aria-invalid={!!error}
            aria-describedby={`operational-note-hint${error ? ' operational-note-error' : ''}`}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-primary" role="status">
            {saved ? 'Note saved.' : ''}
          </p>
          <Button
            type="submit"
            disabled={addNote.isPending || !text.trim()}
            data-testid="button-save-note"
          >
            {addNote.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Plus />
            )}
            Add note
          </Button>
        </div>
      </form>
    </section>
  );
}

function nextAction(sample: SampleDetail) {
  if (sample.status === 'completed')
    return 'This specimen is complete. The released result and custody history are retained below.';
  if (sample.status === 'recollection')
    return sample.replacementSampleId
      ? 'A replacement specimen is linked to this record. Continue its workflow using the replacement link.'
      : 'The original specimen is closed for recollection. Register the replacement when a new specimen is received.';
  if (sample.hasAlert)
    return 'Review the active specimen alerts and follow their required actions. Blocking alerts must be resolved before advancement.';
  if (sample.status === 'verification')
    return 'An authorized reviewer must review the recorded result and quality confirmation before release.';
  if (sample.status === 'received')
    return 'Start processing once the specimen is ready for the laboratory team.';
  return 'Complete processing and record the result summary and quality checks before submitting for verification.';
}

export default function SampleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseSampleId(params.id);
  const [, navigate] = useLocation();
  const session = useSession();
  const query = useSample(id ?? 0);
  const transition = useTransitionSample();
  const [actionError, setActionError] = useState('');
  const [dialog, setDialog] = useState<{
    mode: WorkflowMode;
    sample: SampleDetail;
  } | null>(null);
  const sample = query.data;
  const timezone = session.data?.user?.timezone;

  useEffect(() => {
    setDialog(null);
    setActionError('');
  }, [id]);

  async function startProcessing() {
    if (!sample || transition.isPending) return;
    setActionError('');
    try {
      await transition.mutateAsync({
        id: sample.id,
        version: sample.version,
        action: 'start_processing',
      });
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  if (
    id === null ||
    (query.error instanceof ApiError && query.error.status === 404)
  )
    return (
      <div className="page-enter">
        <BackToSamples />
        <div className="rounded-xl border border-card-border bg-card">
          <EmptyState
            title="Sample not found"
            description="This sample identifier is invalid or the record is unavailable. Return to the queue to find a specimen."
          />
        </div>
      </div>
    );
  if (query.isLoading)
    return (
      <div className="page-enter">
        <BackToSamples />
        <LoadingState rows={5} />
      </div>
    );
  if (!sample)
    return (
      <div className="page-enter">
        <BackToSamples />
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </div>
    );

  const can = (action: SampleDetail['allowedActions'][number]) =>
    sample.allowedActions.includes(action);
  const open = (mode: WorkflowMode) => {
    setActionError('');
    setDialog({ mode, sample });
  };
  const record = [
    ['Request number', sample.requestNumber],
    ['Patient identifier', sample.patientId],
    ['Facility', sample.facility],
    ['Referring doctor', sample.referringDoctor],
    ['Department', sample.department],
    ['Collected', formatTime(sample.collectedAt, timezone)],
    ['Received', formatTime(sample.receivedAt, timezone)],
    ['Due', formatTime(sample.dueAt, timezone)],
    ...(sample.completedAt
      ? [['Completed', formatTime(sample.completedAt, timezone)]]
      : []),
  ];

  return (
    <div className="page-enter">
      <BackToSamples />
      {query.isRefetchError && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm"
        >
          <p>
            The latest changes could not be loaded. This record may be out of
            date.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw />
            Retry refresh
          </Button>
        </div>
      )}
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono-ui text-sm font-bold text-primary">
              {sample.sampleNumber}
            </span>
            <Badge tone={statusTone[sample.status]}>{sample.statusLabel}</Badge>
            <Badge
              tone={
                sample.priority === 'urgent'
                  ? 'bg-rose-100 text-rose-800'
                  : sample.priority === 'high'
                    ? 'bg-amber-100 text-amber-800'
                    : undefined
              }
            >
              {sample.priority} priority
            </Badge>
          </div>
          <h1 className="mt-2 break-words text-[28px] font-bold tracking-[-.04em]">
            {sample.patientName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sample.testName} · {sample.sampleType} · {sample.patientId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('start_processing') && (
            <Button
              type="button"
              onClick={startProcessing}
              disabled={transition.isPending}
            >
              {transition.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play />
              )}
              Start processing
            </Button>
          )}
          {can('submit_verification') && (
            <Button
              type="button"
              onClick={() => open('verification')}
              variant="secondary"
              disabled={transition.isPending}
            >
              <FileCheck2 />
              Submit for verification
            </Button>
          )}
          {can('release') && (
            <Button
              type="button"
              onClick={() => open('release')}
              disabled={transition.isPending}
            >
              <Check />
              Review and release
            </Button>
          )}
          {can('request_recollection') && (
            <Button
              type="button"
              onClick={() => open('recollection')}
              variant="outline"
              disabled={transition.isPending}
            >
              <RefreshCw />
              Request recollection
            </Button>
          )}
          {can('register_replacement') && (
            <Button type="button" onClick={() => open('replacement')}>
              <Plus />
              Register replacement
            </Button>
          )}
        </div>
      </div>
      {actionError && (
        <div className="mb-5">
          <FormError message={actionError} />
        </div>
      )}
      {sample.hasAlert && (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm"
        >
          <AlertCircle size={18} className="shrink-0 text-destructive" />
          <p className="flex-1">
            This specimen has unresolved alerts. Review their required actions.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/alerts?sampleId=${sample.id}`}>
              Review sample alerts
            </Link>
          </Button>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
        <div className="min-w-0 space-y-5">
          {(sample.resultSummary ||
            sample.status === 'verification' ||
            sample.status === 'completed') && (
            <section
              className="panel-shadow rounded-xl border border-card-border bg-card p-5"
              aria-labelledby="result-heading"
            >
              <h2 id="result-heading" className="font-semibold">
                {sample.status === 'completed'
                  ? 'Released result'
                  : 'Recorded result'}
              </h2>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                {sample.resultSummary || 'No result summary recorded.'}
              </p>
              <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Quality checks
                  </dt>
                  <dd className="mt-1 font-medium">
                    {sample.qualityChecked ? 'Confirmed' : 'Not confirmed'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Entered by</dt>
                  <dd className="mt-1 font-medium">
                    {sample.resultEnteredBy || 'Not recorded'}
                  </dd>
                </div>
                {sample.releasedBy && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Released by
                    </dt>
                    <dd className="mt-1 font-medium">{sample.releasedBy}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
          <SampleTimeline sample={sample} timezone={timezone} />
          <OperationalNotes
            key={sample.id}
            sample={sample}
            timezone={timezone}
          />
        </div>
        <div className="min-w-0 space-y-5">
          <RequestAccessSummary sample={sample} timezone={timezone} />
          <section
            className="panel-shadow rounded-xl border border-card-border bg-card p-5"
            aria-labelledby="record-heading"
          >
            <h2 id="record-heading" className="font-semibold">
              Sample record
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              {record.map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <dt className="shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words text-right font-medium">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Times shown in {timezone || 'this device’s local time zone'}.
            </p>
          </section>
          {(sample.parentSampleId ||
            sample.replacementSampleId ||
            sample.recollectionReason) && (
            <section
              className="panel-shadow rounded-xl border border-card-border bg-card p-5"
              aria-labelledby="related-heading"
            >
              <h2 id="related-heading" className="font-semibold">
                Recollection record
              </h2>
              {sample.recollectionReason && (
                <>
                  <h3 className="mt-4 text-xs font-semibold">Reason</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {sample.recollectionReason}
                  </p>
                  <h3 className="mt-4 text-xs font-semibold">
                    Collection instructions
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {sample.recollectionInstructions}
                  </p>
                </>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {sample.parentSampleId && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/samples/${sample.parentSampleId}`}>
                      View original specimen
                    </Link>
                  </Button>
                )}
                {sample.replacementSampleId && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/samples/${sample.replacementSampleId}`}>
                      View replacement specimen
                    </Link>
                  </Button>
                )}
              </div>
            </section>
          )}
          <section
            className="rounded-xl border border-primary/15 bg-primary/[.045] p-5"
            aria-labelledby="next-heading"
          >
            <h2 id="next-heading" className="text-sm font-semibold">
              Next action
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {nextAction(sample)}
            </p>
          </section>
        </div>
      </div>
      {dialog && (
        <WorkflowDialog
          mode={dialog.mode}
          sample={dialog.sample}
          onClose={() => setDialog(null)}
          onReplacement={(replacementId) => {
            setDialog(null);
            navigate(`/samples/${replacementId}`);
          }}
        />
      )}
    </div>
  );
}
