import { RefreshCw } from 'lucide-react';
import { useFollowups } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SampleRow,
  SectionHeading,
} from '@/components/domain';
import { Button } from '@/components/ui/button';

export default function FollowupsPage() {
  const query = useFollowups();
  const awaitingReview =
    query.data?.filter((sample) => sample.status === 'completed') ?? [];
  const recollections =
    query.data?.filter((sample) => sample.status === 'recollection') ?? [];
  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="Continuity of care"
        title="Follow-ups"
        description="Released clinician requests awaiting acknowledgement and specimens awaiting recollection."
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
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="space-y-5">
          {[
            {
              title: 'Awaiting clinician acknowledgement',
              samples: awaitingReview,
              empty:
                'No released requests are awaiting clinician acknowledgement.',
            },
            {
              title: 'Awaiting replacement specimen',
              samples: recollections,
              empty: 'No recollections are awaiting a replacement specimen.',
            },
          ].map((group) => (
            <section
              key={group.title}
              className="overflow-hidden rounded-xl border border-card-border bg-card panel-shadow"
            >
              <h2 className="border-b border-border p-5 font-semibold">
                {group.title}{' '}
                <span className="text-muted-foreground">
                  ({group.samples.length})
                </span>
              </h2>
              {group.samples.length ? (
                <div className="divide-y divide-border">
                  {group.samples.map((sample) => (
                    <SampleRow key={sample.id} sample={sample} />
                  ))}
                </div>
              ) : (
                <EmptyState title="Up to date" description={group.empty} />
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
