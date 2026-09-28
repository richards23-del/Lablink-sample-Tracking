import { useState } from 'react';
import { Link } from 'wouter';
import { RefreshCw } from 'lucide-react';
import {
  useCommunications,
  useRetryCommunication,
  useSession,
  type OutboxMessage,
  type OutboxStatus,
} from '@/lib/api';
import { formatTime } from '@/lib/format';
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
} from '@/components/ui/dialog';
import {
  errorMessage,
  fieldClass,
  FormError,
} from '@/features/samples/form-fields';

const statusLabels: Record<OutboxStatus, string> = {
  queued: 'Queued',
  processing: 'Processing',
  retry: 'Retry scheduled',
  blocked: 'Configuration required',
  failed: 'Failed',
  preview: 'Preview only',
  accepted: 'Provider accepted',
  uncertain: 'Delivery outcome uncertain',
};
const events: Record<OutboxMessage['event'], string> = {
  received: 'Specimen received',
  rejected: 'Recollection required',
  delayed: 'Specimen delayed',
  results_available: 'Results available',
  clinician_reminder: 'Result follow-up reminder',
};

export default function CommunicationsPage() {
  const query = useCommunications();
  const session = useSession();
  const retry = useRetryCommunication();
  const [filter, setFilter] = useState<OutboxStatus | ''>('');
  const [confirm, setConfirm] = useState<OutboxMessage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const visible = (query.data?.messages ?? []).filter(
    (message) => !filter || message.status === filter,
  );
  async function retryMessage(message: OutboxMessage) {
    if (retry.isPending) return;
    setError('');
    setNotice('');
    try {
      await retry.mutateAsync(message.id);
      setConfirm(null);
      setNotice('The message has been queued for another delivery attempt.');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="Administrator tools"
        title="Communications"
        description="Review recipient messages, provider configuration and delivery attempts."
        action={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
        }
      />
      <FormError message={error} />
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-secondary p-3 text-sm">
          {notice}
        </p>
      )}
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <section
            aria-label="Delivery configuration"
            className="mb-5 rounded-xl border border-card-border bg-card p-5 panel-shadow"
          >
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">Delivery mode</h2>
              <Badge>
                {query.data.status.mode === 'preview'
                  ? 'Preview only'
                  : 'Live delivery'}
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {query.data.status.mode === 'preview'
                ? 'Messages are recorded for inspection. No SMS, email or WhatsApp messages are sent in preview mode. Existing previews are never automatically sent when live delivery is enabled.'
                : 'Configured providers process queued messages. Provider acceptance confirms receipt by the provider; it does not confirm delivery to the recipient.'}
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              {(['email', 'sms', 'whatsapp'] as const).map((channel) => (
                <div key={channel} className="rounded-lg bg-muted/50 p-3">
                  <dt className="text-xs font-semibold">
                    {channel === 'email'
                      ? 'Email'
                      : channel === 'sms'
                        ? 'SMS'
                        : 'WhatsApp'}
                  </dt>
                  <dd className="mt-1 text-xs text-muted-foreground">
                    {query.data!.status.providers[channel].configured
                      ? 'Provider configured'
                      : 'Provider not configured'}
                  </dd>
                  {channel === 'whatsapp' && (
                    <dd className="mt-2 text-xs text-muted-foreground">
                      Templates:{' '}
                      {Object.entries(
                        query.data!.status.providers.whatsapp.templates,
                      )
                        .filter(([, ready]) => ready)
                        .map(([recipient]) => recipient)
                        .join(', ') || 'None configured'}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Provider credentials, approved WhatsApp templates and delivery
              mode are configured on the server by the administrator.
            </p>
          </section>
          <div className="mb-4 max-w-sm">
            <label
              htmlFor="communication-status"
              className="mb-2 block text-xs font-semibold"
            >
              Message status
            </label>
            <select
              id="communication-status"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as OutboxStatus | '')
              }
              className={fieldClass}
            >
              <option value="">All messages</option>
              {Object.entries(statusLabels).map(([status, label]) => (
                <option key={status} value={status}>
                  {label} (
                  {query.data!.status.counts[status as OutboxStatus] ?? 0})
                </option>
              ))}
            </select>
          </div>
          <section
            aria-label="Communication history"
            className="overflow-hidden rounded-xl border border-card-border bg-card panel-shadow"
          >
            {visible.length ? (
              <ul className="divide-y divide-border">
                {visible.map((message) => (
                  <li key={message.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold">
                            {events[message.event]}
                          </h2>
                          <Badge
                            tone={
                              ['failed', 'blocked', 'uncertain'].includes(
                                message.status,
                              )
                                ? 'bg-amber-100 text-amber-900'
                                : undefined
                            }
                          >
                            {statusLabels[message.status]}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground capitalize">
                          {message.recipient} ·{' '}
                          {message.channel === 'whatsapp'
                            ? 'WhatsApp'
                            : message.channel.toUpperCase()}{' '}
                          · {message.destination}
                        </p>
                      </div>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={message.createdAt}
                      >
                        {formatTime(
                          message.createdAt,
                          session.data?.user?.timezone,
                        )}
                      </time>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm">
                      {message.message}
                    </p>
                    {message.lastError && (
                      <p className="mt-3 break-words text-xs text-destructive">
                        Last attempt: {message.lastError}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <Link
                        className="text-xs font-semibold text-primary hover:underline"
                        href={`/samples/${message.sampleId}`}
                      >
                        View {message.sampleNumber}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {message.attempts} attempt
                        {message.attempts === 1 ? '' : 's'}
                        {message.nextAttemptAt
                          ? ` · Next attempt ${formatTime(message.nextAttemptAt, session.data?.user?.timezone)}`
                          : ''}
                      </span>
                      {['blocked', 'failed', 'retry', 'uncertain'].includes(
                        message.status,
                      ) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={retry.isPending}
                          onClick={() =>
                            message.status === 'uncertain'
                              ? setConfirm(message)
                              : void retryMessage(message)
                          }
                        >
                          Retry message
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={
                  filter
                    ? 'No messages with this status'
                    : 'No external messages yet'
                }
                description="Messages appear here when specimen events have recipients with selected communication channels."
              />
            )}
          </section>
        </>
      )}
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !retry.isPending) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retry an uncertain delivery</DialogTitle>
            <DialogDescription>
              Check the provider console before retrying to avoid sending a
              duplicate message. The previous attempt may have been accepted
              despite the missing response.
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={retry.isPending}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={retry.isPending}
              onClick={() => confirm && void retryMessage(confirm)}
            >
              I checked the provider; retry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
