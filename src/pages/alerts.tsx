import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'wouter';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import type { Alert } from '@shared/types';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeading,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useAcknowledgeAlert,
  useAlerts,
  useResolveAlert,
  useSession,
} from '@/lib/api';
import { formatRelative, formatTime, parseSampleId } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';

type AlertState = 'active' | 'open' | 'acknowledged' | 'resolved' | 'all';
type Severity = 'all' | Alert['severity'];

function matchesState(alert: Alert, state: AlertState) {
  if (state === 'active') return !alert.resolved;
  if (state === 'open') return !alert.resolved && !alert.acknowledged;
  if (state === 'acknowledged') return !alert.resolved && alert.acknowledged;
  if (state === 'resolved') return alert.resolved;
  return true;
}

const tones = {
  critical: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-100 text-amber-900',
  info: 'bg-sky-100 text-sky-800',
};

export default function AlertsPage() {
  const query = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const [severity, setSeverity] = useState<Severity>('all');
  const [state, setState] = useState<AlertState>('active');
  const all = query.data ?? [];
  const sampleFilter = searchParams.get('sampleId');
  const sampleId = parseSampleId(sampleFilter ?? undefined);
  const hasSampleFilter = sampleFilter !== null;
  const sampleAlerts = hasSampleFilter
    ? all.filter((alert) => alert.sampleId === sampleId)
    : all;
  const sampleNumber = sampleAlerts[0]?.sampleNumber;
  const visible = sampleAlerts.filter(
    (alert) =>
      matchesState(alert, state) &&
      (severity === 'all' || alert.severity === severity),
  );
  const activeCount = sampleAlerts.filter((alert) => !alert.resolved).length;

  function clearSampleFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete('sampleId');
    setSearchParams(next);
    document.getElementById('alert-state')?.focus();
  }

  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="Risk monitor"
        title="Alerts"
        description="Acknowledge an exception to record that it has been seen. Resolve it after the underlying issue has been addressed."
        action={
          <Button
            variant="outline"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              aria-hidden="true"
              className={query.isFetching ? 'animate-spin' : ''}
            />
            Refresh alerts
          </Button>
        }
      />
      {hasSampleFilter && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-sm" role={sampleId ? 'status' : 'alert'}>
            {sampleId ? (
              <>
                Showing alerts for{' '}
                <span className="font-semibold">
                  {sampleNumber ?? `sample #${sampleId}`}
                </span>
                .
              </>
            ) : (
              'The sample filter is invalid. Clear it to view alerts.'
            )}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={clearSampleFilter}
          >
            Clear sample filter
          </Button>
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-end gap-4 rounded-xl border border-card-border bg-card p-4 panel-shadow">
        <fieldset className="min-w-0 flex-1">
          <legend className="mb-2 text-xs font-semibold">
            Severity{' '}
            <span className="font-normal text-muted-foreground">
              (active alerts)
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {(['all', 'critical', 'warning', 'info'] as const).map((value) => {
              const count = sampleAlerts.filter(
                (alert) =>
                  !alert.resolved &&
                  (value === 'all' || alert.severity === value),
              ).length;
              return (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={severity === value ? 'default' : 'outline'}
                  aria-pressed={severity === value}
                  onClick={() => setSeverity(value)}
                  className="capitalize"
                >
                  {value}
                  {query.isSuccess ? ` · ${count}` : ''}
                </Button>
              );
            })}
          </div>
        </fieldset>
        <div className="w-full sm:w-48">
          <Label htmlFor="alert-state" className="mb-2 block text-xs">
            Status
          </Label>
          <select
            id="alert-state"
            value={state}
            onChange={(event) => setState(event.target.value as AlertState)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <option value="active">All active</option>
            <option value="open">Needs acknowledgement</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="all">All statuses</option>
          </select>
        </div>
      </div>
      {query.isLoading ? (
        <LoadingState rows={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <section
          id="alerts-results"
          aria-label="Alert results"
          tabIndex={-1}
          className="focus:outline-none"
        >
          <p className="mb-3 text-xs text-muted-foreground" role="status">
            {visible.length} {visible.length === 1 ? 'alert' : 'alerts'} shown ·{' '}
            {activeCount} active across all severities
            {hasSampleFilter ? ' for this sample' : ''}
          </p>
          {visible.length ? (
            <div className="space-y-3">
              {visible.map((alert) => (
                <AlertCard key={alert.id} alert={alert} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-card-border bg-card panel-shadow">
              <EmptyState
                title={
                  all.length === 0 && !hasSampleFilter
                    ? 'No alerts recorded'
                    : 'No alerts match these filters'
                }
                description={
                  all.length === 0 && !hasSampleFilter
                    ? 'Operational exceptions will appear here as samples move through the laboratory.'
                    : hasSampleFilter
                      ? 'Change the filters or clear the sample filter to review other alerts.'
                      : 'Choose a different severity or status to review other alerts.'
                }
                icon={CheckCircle2}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();
  const session = useSession();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState('');
  const canResolve =
    session.data?.user?.role === 'admin' ||
    session.data?.user?.role === 'reviewer';
  const stateLabel = alert.resolved
    ? 'Resolved'
    : alert.acknowledged
      ? 'Acknowledged'
      : 'Needs acknowledgement';

  async function acknowledgeAlert() {
    setError('');
    try {
      await acknowledge.mutateAsync(alert.id);
      document.getElementById('alerts-results')?.focus();
      toast({
        title: 'Alert acknowledged',
        description: 'The alert remains active until the issue is resolved.',
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not acknowledge this alert. Please try again.',
      );
    }
  }

  async function resolveAlert(event: FormEvent) {
    event.preventDefault();
    if (!resolution.trim() || resolve.isPending) return;
    setError('');
    try {
      await resolve.mutateAsync({
        id: alert.id,
        resolution: resolution.trim(),
      });
      setOpen(false);
      setResolution('');
      document.getElementById('alerts-results')?.focus();
      toast({
        title: 'Alert resolved',
        description: 'Your resolution has been saved to the sample record.',
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not resolve this alert. Please try again.',
      );
    }
  }

  return (
    <article
      className={`panel-shadow rounded-xl border bg-card p-5 ${alert.severity === 'critical' && !alert.resolved ? 'border-destructive/30' : 'border-card-border'}`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl sm:grid ${tones[alert.severity]}`}
        >
          <AlertCircle size={19} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tones[alert.severity]}>{alert.severity}</Badge>
            <Badge>{stateLabel}</Badge>
            <time
              dateTime={alert.createdAt}
              title={formatTime(alert.createdAt, session.data?.user?.timezone)}
              className="text-xs text-muted-foreground"
            >
              {formatRelative(alert.createdAt)}
            </time>
          </div>
          <h2 className="mt-3 text-sm font-bold">{alert.title}</h2>
          <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
            {alert.description}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {alert.patientName} · {alert.action}
          </p>
          {alert.acknowledged && (
            <p className="mt-3 text-xs text-muted-foreground">
              {alert.acknowledgedBy
                ? `Acknowledged by ${alert.acknowledgedBy}`
                : 'Acknowledgement recorded'}
              {alert.acknowledgedAt
                ? ` · ${formatTime(alert.acknowledgedAt, session.data?.user?.timezone)}`
                : ''}
            </p>
          )}
          {alert.resolved && (
            <div className="mt-3 rounded-lg bg-secondary/60 p-3 text-sm">
              <span className="font-semibold">Resolution: </span>
              <span className="whitespace-pre-wrap break-words">
                {alert.resolution}
              </span>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Link
              href={`/samples/${alert.sampleId}`}
              className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              View {alert.sampleNumber}
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
            {!alert.resolved && (
              <div className="flex flex-wrap gap-2">
                {!alert.acknowledged && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={acknowledgeAlert}
                    disabled={acknowledge.isPending || resolve.isPending}
                  >
                    <Check aria-hidden="true" />
                    {acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge'}
                  </Button>
                )}
                {canResolve && (
                  <Dialog
                    open={open}
                    onOpenChange={(value) => {
                      if (!resolve.isPending) {
                        setOpen(value);
                        setError('');
                        if (!value) setResolution('');
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={acknowledge.isPending}
                      >
                        <CheckCircle2 aria-hidden="true" />
                        Resolve
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Resolve alert</DialogTitle>
                        <DialogDescription>
                          Record how the issue affecting {alert.sampleNumber}{' '}
                          was addressed. Resolving the alert does not advance
                          the sample.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={resolveAlert} className="space-y-4">
                        <p className="rounded-lg bg-muted p-3 text-sm font-medium">
                          {alert.title}
                        </p>
                        <div>
                          <Label htmlFor={`resolution-${alert.id}`}>
                            Resolution details
                          </Label>
                          <Textarea
                            id={`resolution-${alert.id}`}
                            value={resolution}
                            onChange={(event) =>
                              setResolution(event.target.value)
                            }
                            required
                            minLength={1}
                            maxLength={2000}
                            rows={4}
                            className="mt-2"
                            placeholder="Describe the action taken and the outcome."
                            disabled={resolve.isPending}
                          />
                        </div>
                        {error && (
                          <p role="alert" className="text-sm text-destructive">
                            {error}
                          </p>
                        )}
                        <DialogFooter>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOpen(false)}
                            disabled={resolve.isPending}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={!resolution.trim() || resolve.isPending}
                          >
                            {resolve.isPending
                              ? 'Saving resolution…'
                              : 'Save resolution'}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            )}
          </div>
          {error && !open && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
