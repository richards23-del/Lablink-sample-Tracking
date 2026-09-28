import { useState } from 'react';
import { Link } from 'wouter';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Check,
  FileCheck2,
  RefreshCw,
} from 'lucide-react';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeading,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  useMarkNotificationRead,
  useNotifications,
  useSession,
} from '@/lib/api';
import { formatRelative, formatTime } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import { isStaff } from '@/lib/roles';

export default function NotificationsPage() {
  const query = useNotifications();
  const session = useSession();
  const markRead = useMarkNotificationRead();
  const { toast } = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState('');
  const all = query.data ?? [];
  const unread = all.filter((notification) => !notification.read).length;
  const visible = unreadOnly
    ? all.filter((notification) => !notification.read)
    : all;

  async function mark(id: number) {
    setError('');
    try {
      await markRead.mutateAsync(id);
      document.getElementById('notification-results')?.focus();
      toast({ title: 'Notification marked as read' });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not mark the notification as read. Please try again.',
      );
    }
  }

  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="Your inbox"
        title="Notifications"
        description="Sample movement and quality events delivered to your account. Read status is saved for you."
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
            Refresh
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={unreadOnly ? 'outline' : 'default'}
            aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={unreadOnly ? 'default' : 'outline'}
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}
          >
            Unread{query.isSuccess ? ` · ${unread}` : ''}
          </Button>
        </div>
        <Link
          href="/settings"
          className="rounded text-xs font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {isStaff(session.data?.user?.role)
            ? 'Notification preferences'
            : 'Account settings'}
        </Link>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <section
        id="notification-results"
        aria-label="Notification results"
        tabIndex={-1}
        className="overflow-hidden rounded-xl border border-card-border bg-card panel-shadow focus:outline-none"
      >
        {query.isLoading ? (
          <div className="p-5">
            <LoadingState rows={5} />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : visible.length ? (
          <ul className="divide-y divide-border">
            {visible.map((item) => (
              <li
                key={item.id}
                className={`flex gap-3 p-4 sm:gap-4 sm:p-5 ${item.read ? 'bg-card' : 'bg-primary/[.035]'}`}
              >
                <div
                  className={`mt-0.5 hidden h-9 w-9 shrink-0 place-items-center rounded-lg sm:grid ${item.read ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}
                >
                  {item.kind === 'alert' ? (
                    <AlertCircle size={16} aria-hidden="true" />
                  ) : item.kind === 'verification' ? (
                    <FileCheck2 size={16} aria-hidden="true" />
                  ) : (
                    <Bell size={16} aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold">{item.title}</h2>
                      {!item.read && (
                        <Badge tone="bg-primary/10 text-primary">Unread</Badge>
                      )}
                    </div>
                    <time
                      dateTime={item.createdAt}
                      title={formatTime(
                        item.createdAt,
                        session.data?.user?.timezone,
                      )}
                      className="text-xs text-muted-foreground"
                    >
                      {formatRelative(item.createdAt)}
                    </time>
                  </div>
                  <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
                    {item.message}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    {item.sampleId ? (
                      <Link
                        href={`/samples/${item.sampleId}`}
                        className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        View {item.sampleNumber ?? 'sample'}
                        <ArrowRight size={13} aria-hidden="true" />
                      </Link>
                    ) : (
                      <span />
                    )}
                    {!item.read && (
                      <Button
                        onClick={() => mark(item.id)}
                        variant="outline"
                        size="sm"
                        disabled={markRead.isPending}
                        aria-label={`Mark ${item.title} as read`}
                      >
                        <Check aria-hidden="true" />
                        {markRead.isPending && markRead.variables === item.id
                          ? 'Saving…'
                          : 'Mark as read'}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={
              unreadOnly ? 'No unread notifications' : 'No notifications yet'
            }
            description={
              unreadOnly
                ? 'Your other notifications remain available in the All view.'
                : 'New updates will appear here according to your notification preferences.'
            }
            icon={Bell}
          />
        )}
      </section>
    </div>
  );
}
