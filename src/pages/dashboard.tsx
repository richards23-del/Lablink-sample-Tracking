import { useState, type ElementType } from 'react';
import { Link } from 'wouter';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  RefreshCw,
  TestTube2,
} from 'lucide-react';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  SampleRow,
  SectionHeading,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { syncWorkspace, useDashboard, useSamples, useSession } from '@/lib/api';
import { barPercentage, formatTime } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'bg-primary/10 text-primary',
}: {
  label: string;
  value: number;
  detail: string;
  icon: ElementType;
  tone?: string;
}) {
  return (
    <div className="panel-shadow rounded-xl border border-card-border bg-card p-4">
      <div className={`grid h-9 w-9 place-items-center rounded-lg ${tone}`}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight">{value}</p>
      <h2 className="mt-1 text-sm font-semibold">{label}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function Dashboard() {
  const session = useSession();
  const query = useDashboard();
  const samples = useSamples({ page: 1, pageSize: 6 });
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();
  const summary = query.data;
  const user = session.data?.user;
  const maximumVolume = Math.max(
    0,
    ...(summary?.weeklyVolume.flatMap((day) => [day.received, day.completed]) ??
      []),
  );
  const totalStates =
    summary?.statusBreakdown.reduce((sum, item) => sum + item.count, 0) ?? 0;
  async function synchronize() {
    setSyncing(true);
    try {
      await syncWorkspace();
      toast({
        title: 'Workspace refreshed',
        description: 'The current views now reflect the latest saved records.',
      });
    } catch (error) {
      toast({
        title: 'Refresh incomplete',
        description:
          error instanceof Error
            ? error.message
            : 'One or more views could not be refreshed.',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="Operational overview"
        title="Command center"
        description={`The current picture for ${user?.workspaceName ?? 'your laboratory'}.`}
        action={
          <Button variant="outline" onClick={synchronize} disabled={syncing}>
            <RefreshCw className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Refreshing…' : 'Sync workspace'}
          </Button>
        }
      />
      {query.isLoading ? (
        <LoadingState rows={3} />
      ) : query.isError || !summary ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>
              Daily totals use {user?.timezone}. Queue counts reflect the
              current workload.
            </p>
            <p>
              Updated{' '}
              {formatTime(
                new Date(query.dataUpdatedAt).toISOString(),
                user?.timezone,
              )}{' '}
              · refreshes every 30 seconds
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="Received today"
              value={summary.receivedToday}
              detail="Since laboratory midnight"
              icon={TestTube2}
            />
            <StatCard
              label="Processing"
              value={summary.processing}
              detail="Currently in the lab"
              icon={Activity}
              tone="bg-amber-100 text-amber-900"
            />
            <StatCard
              label="Overdue"
              value={summary.delayed}
              detail="Past the turnaround target"
              icon={Clock3}
              tone="bg-rose-100 text-rose-900"
            />
            <StatCard
              label="Awaiting verification"
              value={summary.awaitingVerification}
              detail="Ready for authorized review"
              icon={FileCheck2}
              tone="bg-violet-100 text-violet-900"
            />
            <StatCard
              label="Completed today"
              value={summary.completedToday}
              detail={
                summary.completedToday
                  ? `${summary.turnaroundRate}% within target today`
                  : 'No results released today'
              }
              icon={CheckCircle2}
              tone="bg-emerald-100 text-emerald-900"
            />
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
            <section
              className="panel-shadow rounded-xl border border-card-border bg-card p-5"
              aria-labelledby="volume-heading"
            >
              <h2 id="volume-heading" className="font-semibold">
                Volume pulse
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Received and completed samples · last 7 days
              </p>
              <div
                className="mt-6 flex h-48 items-end gap-2 sm:gap-5"
                aria-hidden="true"
              >
                {summary.weeklyVolume.map((day) => (
                  <div
                    key={day.date}
                    className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2"
                  >
                    <div className="flex h-full items-end justify-center gap-1.5">
                      <div
                        className="w-3 rounded-t-sm bg-primary/80 sm:w-4"
                        style={{
                          height: `${barPercentage(day.received, maximumVolume)}%`,
                        }}
                      />
                      <div
                        className="w-3 rounded-t-sm bg-accent sm:w-4"
                        style={{
                          height: `${barPercentage(day.completed, maximumVolume)}%`,
                        }}
                      />
                    </div>
                    <span className="text-center font-mono-ui text-[10px] text-muted-foreground">
                      {day.day}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-5 border-t border-border pt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <i className="h-2 w-2 rounded-full bg-primary" />
                  Received
                </span>
                <span className="flex items-center gap-2">
                  <i className="h-2 w-2 rounded-full bg-accent" />
                  Completed
                </span>
              </div>
              {maximumVolume === 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  No sample activity recorded in this period.
                </p>
              )}
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-medium text-primary">
                  View volume data
                </summary>
                <table className="mt-3 w-full text-left text-xs">
                  <caption className="sr-only">
                    Daily received and completed sample counts
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-2">
                        Date
                      </th>
                      <th scope="col">Received</th>
                      <th scope="col">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.weeklyVolume.map((day) => (
                      <tr key={day.date} className="border-t border-border">
                        <th scope="row" className="py-2 font-normal">
                          {day.date}
                        </th>
                        <td>{day.received}</td>
                        <td>{day.completed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>
            <section
              className="panel-shadow rounded-xl border border-card-border bg-card p-5"
              aria-labelledby="composition-heading"
            >
              <h2 id="composition-heading" className="font-semibold">
                Sample states
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Distribution of registered specimens
              </p>
              <div className="mt-6 space-y-4">
                {summary.statusBreakdown.map((status) => (
                  <div key={status.status}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span>{status.label}</span>
                      <span className="font-mono-ui">{status.count}</span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-muted"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${barPercentage(status.count, totalStates)}%`,
                          backgroundColor: status.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <Badge>
                  {summary.recollections} awaiting replacement collection
                </Badge>
              </div>
            </section>
          </div>
        </>
      )}
      <section
        className="mt-5 overflow-hidden rounded-xl border border-card-border bg-card panel-shadow"
        aria-labelledby="recent-heading"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="recent-heading" className="font-semibold">
              Latest in the queue
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The records most recently updated by your team
            </p>
          </div>
          <Link
            href="/samples"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            View all <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {samples.isLoading ? (
          <div className="p-5">
            <LoadingState rows={3} />
          </div>
        ) : samples.isError ? (
          <ErrorState error={samples.error} onRetry={() => samples.refetch()} />
        ) : samples.data?.items.length ? (
          <div className="divide-y divide-border">
            {samples.data.items.map((sample) => (
              <SampleRow key={sample.id} sample={sample} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No samples registered"
            description="Register the first specimen from the sample queue to begin tracking its progress."
            icon={TestTube2}
          />
        )}
      </section>
    </div>
  );
}
